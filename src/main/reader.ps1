$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$once = ($env:ISLET_ONCE -eq '1')
$initErr = ''

# Fullscreen detection: is the foreground window a borderless window covering a whole monitor?
$cs = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class IsletWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int index);
  public static bool IsFullscreen() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero || !IsWindowVisible(h)) return false;
    StringBuilder sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    string c = sb.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return false;
    int style = GetWindowLong(h, -16);
    if ((style & 0x00C00000) != 0) return false; // has a title bar: normal or maximised window
    RECT r;
    if (!GetWindowRect(h, out r)) return false;
    IntPtr m = MonitorFromWindow(h, 2);
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(m, ref mi)) return false;
    return r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
  }
}
'@
try { Add-Type -TypeDefinition $cs -Language CSharp } catch { $initErr = 'addtype: ' + $_.Exception.Message }

# Windows media session (the thing behind the volume flyout): Spotify, browsers, Apple Music...
$mgr = $null
$asTask = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
} catch { $initErr += ' winrt: ' + $_.Exception.Message }

function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$task.Wait(5000)
  if ($task.IsCompleted) { $task.Result } else { $null }
}

try {
  $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch { $initErr += ' manager: ' + $_.Exception.Message }

while ($true) {
  $o = [ordered]@{ status = 'none'; title = ''; artist = ''; album = ''; pos = 0.0; end = 0.0; app = ''; fs = $false; err = $initErr }
  try { $o.fs = [bool][IsletWin]::IsFullscreen() } catch { }
  if ($mgr -ne $null) {
    try {
      $cur = $null
      foreach ($s in $mgr.GetSessions()) {
        if ([string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { $cur = $s; break }
      }
      if ($cur -eq $null) { $cur = $mgr.GetCurrentSession() }
      if ($cur -ne $null) {
        $p = Await ($cur.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $tl = $cur.GetTimelineProperties()
        $o.status = ([string]$cur.GetPlaybackInfo().PlaybackStatus).ToLower()
        if ($p -ne $null) { $o.title = [string]$p.Title; $o.artist = [string]$p.Artist; $o.album = [string]$p.AlbumTitle }
        $o.pos = [math]::Round($tl.Position.TotalSeconds - $tl.StartTime.TotalSeconds, 2)
        $o.end = [math]::Round($tl.EndTime.TotalSeconds - $tl.StartTime.TotalSeconds, 2)
        $o.app = [string]$cur.SourceAppUserModelId
      }
    } catch { $o.err = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  if ($once) { break }
  Start-Sleep -Milliseconds 500
}

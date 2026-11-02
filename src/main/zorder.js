'use strict';

// Puts a window "on the desktop": above the wallpaper and the desktop icons, but underneath every
// app window, so widgets look like part of the desktop and get covered when you open something.
// Electron has no API for this, so a one-shot PowerShell call does it with SetWindowPos.
//
// Plain HWND_BOTTOM isn't enough because that can drop the window *under* the desktop itself. So we
// find the window that hosts the desktop icons (class SHELLDLL_DefView) and slot in right above it.

const { spawn } = require('child_process');

/** Electron hands back the HWND as little-endian bytes. Returns a decimal string or null. */
function hwndFromBuffer(buf) {
  if (!buf || buf.length < 4) return null;
  const n = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  return n > 0n ? n.toString() : null;
}

// Kept to C# 5 (what Windows PowerShell 5.1 compiles): no ?., no $"" strings.
const CSHARP = `
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class IsletZ {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);

  const uint FLAGS = 0x0001 | 0x0002 | 0x0010 | 0x0200; // NOSIZE | NOMOVE | NOACTIVATE | NOOWNERZORDER

  static IntPtr ShellHost() {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static string Cls(IntPtr h) {
    StringBuilder sb = new StringBuilder(128);
    GetClassName(h, sb, 128);
    return sb.ToString();
  }

  public static string Pin(IntPtr me) {
    IntPtr host = ShellHost();
    if (host == IntPtr.Zero) {
      SetWindowPos(me, (IntPtr)1, 0, 0, 0, 0, FLAGS); // HWND_BOTTOM
      return "bottom (no desktop shell found)";
    }
    IntPtr above = GetWindow(host, 3); // GW_HWNDPREV: the window just above the desktop
    if (above == me) return "kept (already just above the desktop)";
    bool topmost = above != IntPtr.Zero && (GetWindowLong(above, -20) & 0x8) != 0; // WS_EX_TOPMOST
    if (above == IntPtr.Zero || topmost) {
      // only always-on-top windows are above the desktop, so the top of the normal stack is right here
      SetWindowPos(me, IntPtr.Zero, 0, 0, 0, 0, FLAGS); // HWND_TOP
      return "top of the normal windows (nothing else open)";
    }
    SetWindowPos(me, above, 0, 0, 0, 0, FLAGS); // directly behind 'above', directly in front of the desktop
    return "above the desktop";
  }

  /** Top-to-bottom list of visible windows by class name, with ours marked. For diagnostics only. */
  public static string Describe(IntPtr me) {
    List<string> rows = new List<string>();
    IntPtr host = ShellHost();
    int i = 0;
    for (IntPtr h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = GetWindow(h, 2)) {
      i++;
      string tag = null;
      if (h == me) tag = "ISLET-WIDGETS";
      else if (h == host) tag = "DESKTOP(" + Cls(h) + ")";
      else if (IsWindowVisible(h) && rows.Count < 14) tag = Cls(h);
      else if (Cls(h) == "Progman" || Cls(h) == "WorkerW") tag = Cls(h);
      if (tag != null) rows.Add(i + ":" + tag);
    }
    return string.Join(" > ", rows.ToArray());
  }
}
`;

/** The helper: compiles the C# once, then answers "PIN <hwnd> <debug 0|1>" lines from stdin. */
function buildHelperScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    "$cs = @'",
    CSHARP,
    "'@",
    'Add-Type -TypeDefinition $cs -Language CSharp',
    "[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()",
    'while ($true) {',
    '  $line = [Console]::In.ReadLine()',
    '  if ($null -eq $line) { break }',
    "  $p = $line.Trim().Split(' ')",
    "  if ($p[0] -eq 'PIN' -and $p.Length -ge 2 -and $p[1] -match '^\\d{1,20}$') {",
    '    try {',
    '      $h = [IntPtr][long]$p[1]',
    "      [Console]::Out.WriteLine('PIN ' + [IsletZ]::Pin($h))",
    "      if ($p.Length -ge 3 -and $p[2] -eq '1') { [Console]::Out.WriteLine('Z ' + [IsletZ]::Describe($h)) }",
    '    } catch {',
    "      [Console]::Out.WriteLine('ERR ' + ($_.Exception.Message -replace '[\\r\\n]+', ' '))",
    '    }',
    "    [Console]::Out.WriteLine('END'); [Console]::Out.Flush()",
    '  }',
    '}',
  ].join('\n');
}

/** One line for the helper. The handle goes straight into a command, so it must be nothing but digits. */
function buildCommand(hwnd, debug = false) {
  if (!/^\d{1,20}$/.test(String(hwnd))) throw new Error('bad window handle');
  return `PIN ${hwnd} ${debug ? 1 : 0}\n`;
}

function parseOutput(out) {
  const lines = String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pin = lines.find((l) => l.startsWith('PIN '));
  const z = lines.find((l) => l.startsWith('Z '));
  if (!pin) {
    const err = lines.find((l) => l.startsWith('ERR '));
    return { ok: false, detail: err ? err.slice(4) : lines.slice(0, 3).join(' | ') || 'no output', z: '' };
  }
  return { ok: true, detail: pin.slice(4), z: z ? z.slice(2) : '' };
}

const IDLE_MS = 2 * 60 * 1000;
const FIRST_TIMEOUT_MS = 40000; // the first call also compiles the C#

/**
 * Owns one hidden PowerShell process that is started on demand and shut down again after a couple of
 * idle minutes, so it costs nothing while the widgets just sit there.
 */
class Pinner {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.buf = '';
    this.queue = [];
    this.current = null;
    this.idleTimer = null;
  }

  /** Resolves { ok, detail, z }. Never rejects. */
  pin(win, { debug = false } = {}) {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve({ ok: true, detail: 'skipped (not Windows)', z: '' });
      let command;
      try {
        const hwnd = hwndFromBuffer(win.getNativeWindowHandle());
        if (!hwnd) return resolve({ ok: false, detail: 'no window handle', z: '' });
        command = buildCommand(hwnd, debug);
      } catch (e) {
        return resolve({ ok: false, detail: String(e.message || e), z: '' });
      }
      this.queue.push({ command, resolve, lines: [] });
      this._pump();
    });
  }

  stop() {
    clearTimeout(this.idleTimer);
    this._fail('stopped');
    this._kill();
  }

  _spawn() {
    const encoded = Buffer.from(buildHelperScript(), 'utf16le').toString('base64');
    const proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.proc = proc;
    this.ready = false;
    this.buf = '';
    let errText = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/^﻿/, '').trim();
        this.buf = this.buf.slice(i + 1);
        if (line) this._onLine(line);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => (errText += d));
    proc.stdin.on('error', () => {
      /* the process died; 'exit' handles it */
    });
    proc.on('error', (e) => {
      if (this.proc === proc) this._failAndReset(`spawn failed: ${e.message}`);
    });
    proc.on('exit', () => {
      if (this.proc === proc) this._failAndReset(errText.trim().split(/\r?\n/)[0] || 'helper exited');
    });
  }

  _onLine(line) {
    if (line === 'READY') {
      this.ready = true;
      this._pump();
      return;
    }
    const cur = this.current;
    if (!cur) return;
    if (line === 'END') {
      clearTimeout(cur.timer);
      this.current = null;
      cur.resolve(parseOutput(cur.lines.join('\n')));
      this._armIdle();
      this._pump();
    } else {
      cur.lines.push(line);
    }
  }

  _pump() {
    if (this.current || !this.queue.length) return;
    if (!this.proc) this._spawn();
    if (!this.ready) return; // 'READY' will call us again
    const job = this.queue.shift();
    this.current = job;
    clearTimeout(this.idleTimer);
    job.timer = setTimeout(() => this._failAndReset('timed out'), FIRST_TIMEOUT_MS);
    try {
      this.proc.stdin.write(job.command);
    } catch (e) {
      this._failAndReset(`write failed: ${e.message}`);
    }
  }

  _armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.current && !this.queue.length) this._kill();
    }, IDLE_MS);
  }

  _fail(detail) {
    const jobs = [this.current, ...this.queue].filter(Boolean);
    this.current = null;
    this.queue = [];
    for (const j of jobs) {
      clearTimeout(j.timer);
      j.resolve({ ok: false, detail, z: '' });
    }
  }

  _failAndReset(detail) {
    this._fail(detail);
    this._kill();
  }

  _kill() {
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    if (proc) {
      try {
        proc.kill();
      } catch (e) {
        /* already gone */
      }
    }
  }
}

module.exports = { hwndFromBuffer, buildHelperScript, buildCommand, parseOutput, Pinner };

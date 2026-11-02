(() => {
  'use strict';
  const api = window.islet;
  let settings = null;

  const fmt = {
    pct: (v) => `${Math.round(Number(v) * 100)}%`,
    px: (v) => `${Math.round(Number(v))} px`,
    sec: (v) => `${(Number(v) / 1000 >= 0 ? '+' : '')}${(Number(v) / 1000).toFixed(1)} s`,
  };

  const set = (patch) => api.setSettings(patch);

  /* ----- generic controls: anything with data-key ----- */
  function bindControls() {
    document.querySelectorAll('[data-key]').forEach((node) => {
      const key = node.dataset.key;
      if (node.classList.contains('seg')) {
        node.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => set({ [key]: b.dataset.value })));
      } else if (node.type === 'range') {
        node.addEventListener('input', () => {
          const out = node.parentElement.querySelector('output');
          if (out) out.textContent = fmt[node.dataset.fmt](node.value);
          set({ [key]: Number(node.value) });
        });
      } else if (node.type === 'checkbox') {
        node.addEventListener('change', () => set({ [key]: node.checked }));
      } else if (node.tagName === 'SELECT') {
        node.addEventListener('change', () => set({ [key]: node.value }));
      } else if (node.type === 'text') {
        const commit = () => set({ [key]: node.value });
        node.addEventListener('change', commit);
        node.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') node.blur();
        });
      }
    });
  }

  function render(s) {
    settings = s;
    document.querySelectorAll('[data-key]').forEach((node) => {
      const key = node.dataset.key;
      const value = s[key];
      if (node.classList.contains('seg')) {
        node.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
      } else if (node.type === 'range') {
        if (document.activeElement !== node) node.value = value;
        const out = node.parentElement.querySelector('output');
        if (out) out.textContent = fmt[node.dataset.fmt](value);
      } else if (node.type === 'checkbox') {
        node.checked = Boolean(value);
      } else if (node.tagName === 'SELECT') {
        node.value = String(value);
      } else if (node.type === 'text') {
        if (document.activeElement !== node) node.value = value;
      }
    });
    // corner radius: "Auto" means the shape decides
    const auto = s.radius === null;
    const slider = document.getElementById('radius');
    document.getElementById('radiusAuto').checked = auto;
    slider.disabled = auto;
    if (document.activeElement !== slider) slider.value = auto ? 18 : s.radius;
    document.getElementById('radiusOut').textContent = auto ? 'auto' : `${s.radius} px`;
  }

  /* ----- corner radius ----- */
  document.getElementById('radiusAuto').addEventListener('change', (e) => {
    set({ radius: e.target.checked ? null : Number(document.getElementById('radius').value) });
  });
  document.getElementById('radius').addEventListener('input', (e) => {
    set({ radius: Number(e.target.value) });
  });

  /* ----- buttons ----- */
  let movingNow = false;
  document.getElementById('moveBtn').addEventListener('click', () => api.setMoveMode(!movingNow));
  document.getElementById('centerBtn').addEventListener('click', () => set({ x: 0 }));
  document.getElementById('resetBtn').addEventListener('click', () => api.resetSettings());
  document.getElementById('quitBtn').addEventListener('click', () => api.quit());
  api.onMoveMode((on) => {
    movingNow = on;
    document.getElementById('moveBtn').textContent = on ? 'Done moving' : 'Drag it into place';
  });

  let arranging = false;
  const arrangeBtn = document.getElementById('arrangeBtn');
  arrangeBtn.addEventListener('click', () => api.setEditMode(!arranging));
  document.getElementById('resetLayoutBtn').addEventListener('click', () => api.resetWidgetLayout());
  api.onEditMode((on) => {
    arranging = on;
    arrangeBtn.textContent = on ? 'Done arranging' : 'Arrange widgets';
  });

  /* ----- monitors ----- */
  async function loadDisplays() {
    const select = document.getElementById('monitor');
    const displays = await api.getDisplays();
    select.innerHTML = '';
    const add = (value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      select.appendChild(o);
    };
    add('primary', 'Main screen');
    add('cursor', 'Follow my mouse');
    displays.forEach((d) => add(String(d.index), `Screen ${d.index + 1}${d.primary ? ' (main)' : ''} · ${d.width}×${d.height}`));
    if (settings) select.value = String(settings.monitor);

    // widgets: one fixed screen (no "follow my mouse" for a desktop layer)
    const wsel = document.getElementById('widgetsMonitor');
    wsel.innerHTML = '';
    const addW = (value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      wsel.appendChild(o);
    };
    addW('primary', 'Main screen');
    displays.forEach((d) => addW(String(d.index), `Screen ${d.index + 1}${d.primary ? ' (main)' : ''} · ${d.width}×${d.height}`));
    if (settings) wsel.value = String(settings.widgetsMonitor);
  }

  bindControls();
  api.onSettings(render);
  api.getSettings().then(async (s) => {
    settings = s;
    await loadDisplays();
    render(s);
  });
})();

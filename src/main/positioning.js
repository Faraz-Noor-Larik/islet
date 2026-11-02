'use strict';

// Biggest the island ever gets (its "expanded" state), before scaling.
const MAX_ISLAND = { w: 560, h: 160 };
// Transparent room around the island inside the window, so the shadow isn't clipped.
const PAD = 24;
const SNAP = 12; // px: dragging within this distance of centre snaps to dead centre

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function windowSize(scale) {
  const pad = Math.ceil(PAD * scale);
  return {
    width: Math.ceil(MAX_ISLAND.w * scale) + pad * 2,
    height: Math.ceil(MAX_ISLAND.h * scale) + pad,
  };
}

/** Window bounds so the island sits top-centre of `display` plus the user's x / y offsets. */
function computeBounds(display, settings) {
  const { width, height } = windowSize(settings.scale);
  let x = Math.round(display.x + display.width / 2 - width / 2 + settings.x);
  let y = Math.round(display.y + settings.y);
  const maxX = display.x + display.width - width;
  const maxY = display.y + display.height - height;
  x = maxX < display.x ? Math.round(display.x + (display.width - width) / 2) : clamp(x, display.x, maxX);
  y = maxY < display.y ? display.y : clamp(y, display.y, maxY);
  return { x, y, width, height };
}

/** Inverse of computeBounds: the x / y offsets that would put the window at `win`. */
function offsetsFromBounds(display, win) {
  let x = Math.round(win.x + win.width / 2 - (display.x + display.width / 2));
  const y = Math.max(0, Math.round(win.y - display.y));
  if (Math.abs(x) <= SNAP) x = 0;
  return { x, y };
}

/** Pick the monitor named by the `monitor` setting. */
function resolveDisplay(ctx, setting) {
  const { displays, primary, cursorDisplay } = ctx;
  if (setting === 'cursor' && cursorDisplay) return cursorDisplay;
  if (/^\d+$/.test(String(setting))) {
    const d = displays[Number(setting)];
    if (d) return d;
  }
  return primary;
}

module.exports = { MAX_ISLAND, PAD, SNAP, windowSize, computeBounds, offsetsFromBounds, resolveDisplay };

'use strict';

const { cleanTrack } = require('./lyrics');

/**
 * Turns the raw once-every-500ms samples into something the UI can animate from.
 *
 * Many players only report their position when it changes (a seek, play or pause) and don't tick
 * while playing, so we remember WHEN we saw each position and extrapolate. The UI gets a
 * { pos, at } pair and keeps counting by itself; we only send an update when something changed
 * (track, play/pause, a seek, or drift of more than a second).
 */
class Timeline {
  constructor() {
    this.key = null;
    this.status = 'none';
    this.base = { pos: 0, at: 0 };
    this.lastReported = null;
    this.sent = null;
  }

  update(sample, now = Date.now()) {
    const raw = String(sample.status || 'none').toLowerCase();
    const playerStatus = raw === 'playing' ? 'playing' : raw === 'paused' ? 'paused' : 'none';
    const hasTrack = playerStatus !== 'none' && Boolean(sample.title);
    const status = hasTrack ? playerStatus : 'none';
    const key = hasTrack ? [sample.artist, sample.title, sample.album].join('\u0001') : null;
    const reported = Number(sample.pos) || 0;
    const duration = Number(sample.end) > 0 ? Number(sample.end) : 0;

    const trackChanged = key !== this.key;
    const fresh = trackChanged || reported !== this.lastReported;
    if (fresh) {
      this.base = { pos: reported, at: now };
    } else if (this.status === 'playing' && status !== 'playing') {
      // just paused and the player didn't report where: freeze at the extrapolated spot
      this.base = { pos: this.base.pos + (now - this.base.at) / 1000, at: now };
    } else if (this.status !== 'playing' && status === 'playing') {
      this.base = { pos: this.base.pos, at: now };
    }

    let pos = status === 'playing' ? this.base.pos + (now - this.base.at) / 1000 : this.base.pos;
    if (duration) pos = Math.min(pos, duration);
    pos = Math.max(0, pos);

    this.key = key;
    this.status = status;
    this.lastReported = reported;

    let track = null;
    if (hasTrack) {
      const { display } = cleanTrack(sample.title, sample.artist);
      track = {
        key,
        title: display.title,
        artist: display.artist,
        album: String(sample.album || ''),
        app: String(sample.app || ''),
        rawTitle: String(sample.title),
        rawArtist: String(sample.artist || ''),
      };
    }
    const state = { status, track, pos, at: now, duration };

    const sent = this.sent;
    const sentExpected = sent ? (sent.status === 'playing' ? sent.pos + (now - sent.at) / 1000 : sent.pos) : 0;
    const send =
      !sent ||
      trackChanged ||
      status !== sent.status ||
      duration !== sent.duration ||
      Math.abs(pos - sentExpected) > 1.0;
    if (send) this.sent = state;
    return { send, trackChanged, hasTrack, state };
  }
}

module.exports = { Timeline };

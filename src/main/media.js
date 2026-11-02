'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Keeps one hidden PowerShell process alive that prints the current media session
 * (title, artist, position, playing/paused, fullscreen flag) as a JSON line every 500 ms.
 * Emits 'sample' (object), 'log' (string) and 'unsupported'.
 */
class MediaReader extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.stopped = true;
    this.retries = 0;
    this.timer = null;
  }

  start() {
    if (process.platform !== 'win32') {
      this.emit('unsupported');
      return;
    }
    this.stopped = false;
    this._spawn();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.proc) {
      try {
        this.proc.kill();
      } catch (e) {
        /* already gone */
      }
    }
  }

  _spawn() {
    let encoded;
    try {
      const script = fs.readFileSync(path.join(__dirname, 'reader.ps1'), 'utf8');
      encoded = Buffer.from(script, 'utf16le').toString('base64');
    } catch (e) {
      this.emit('log', `cannot read reader.ps1: ${e.message}`);
      return;
    }

    const proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.proc = proc;

    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).replace(/^﻿/, '').trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        try {
          const sample = JSON.parse(line);
          this.retries = 0;
          this.emit('sample', sample);
        } catch (e) {
          this.emit('log', `unparsable line: ${line.slice(0, 120)}`);
        }
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => this.emit('log', `stderr: ${String(d).trim().slice(0, 300)}`));
    proc.on('error', (e) => this.emit('log', `spawn error: ${e.message}`));
    proc.on('exit', (code) => {
      this.proc = null;
      if (this.stopped) return;
      this.emit('log', `reader exited (${code}), restarting`);
      const delay = Math.min(15000, 1500 * 2 ** this.retries++);
      this.timer = setTimeout(() => this._spawn(), delay);
    });
  }
}

module.exports = { MediaReader };

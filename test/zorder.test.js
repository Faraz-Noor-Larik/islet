'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hwndFromBuffer, buildHelperScript, buildCommand, parseOutput } = require('../src/main/zorder');

test('hwndFromBuffer reads 8-byte and 4-byte little-endian handles', () => {
  const b8 = Buffer.alloc(8);
  b8.writeBigUInt64LE(0x1234abcdn);
  assert.equal(hwndFromBuffer(b8), String(0x1234abcd));
  const b4 = Buffer.alloc(4);
  b4.writeUInt32LE(777);
  assert.equal(hwndFromBuffer(b4), '777');
  assert.equal(hwndFromBuffer(Buffer.alloc(8)), null);
  assert.equal(hwndFromBuffer(null), null);
});

test('buildCommand is a single line with a numeric handle', () => {
  assert.equal(buildCommand('123456'), 'PIN 123456 0\n');
  assert.equal(buildCommand('123456', true), 'PIN 123456 1\n');
});

test('buildCommand refuses anything that is not plain digits', () => {
  for (const bad of ['1; calc', '12 34', '', '-5', '1e9', '0x10', '1\n2', 'abc']) {
    assert.throws(() => buildCommand(bad), /bad window handle/, JSON.stringify(bad));
  }
});

test('the helper looks for the desktop instead of blindly going to the bottom', () => {
  const s = buildHelperScript();
  assert.match(s, /SHELLDLL_DefView/);
  assert.match(s, /\[IsletZ\]::Pin\(\$h\)/);
  assert.match(s, /\[IsletZ\]::Describe\(\$h\)/);
  assert.match(s, /READY/);
});

test('the PowerShell here-string is well formed (closing marker alone at the start of a line)', () => {
  const lines = buildHelperScript().split('\n');
  assert.equal(lines.filter((l) => l === "'@").length, 1);
  assert.equal(lines.filter((l) => l === "$cs = @'").length, 1);
});

test('parseOutput reads the pin result and the diagnostic line', () => {
  assert.deepEqual(parseOutput('PIN above the desktop\r\nZ 1:Chrome > 4:ISLET-WIDGETS\r\n'), {
    ok: true,
    detail: 'above the desktop',
    z: '1:Chrome > 4:ISLET-WIDGETS',
  });
  assert.equal(parseOutput('PIN kept').z, '');
  const bad = parseOutput('Add-Type : error CS1002\r\nsomething');
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /CS1002/);
  assert.equal(parseOutput('ERR boom\nEND').detail, 'boom');
  assert.equal(parseOutput('').ok, false);
});

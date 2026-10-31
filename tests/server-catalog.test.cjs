'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');

test('server sponsor buttons use a plural selector and cannot call forEach on one element', () => {
  assert.match(app, /\$\$\('\[data-server-plan\]',e\)\.forEach/);
  assert.doesNotMatch(app, /(?<!\$)\$\('\[data-server-plan\]',e\)\.forEach/);
  assert.match(app, /\$\$\('\[data-server-remove\]',owner\)\.forEach/);
  assert.doesNotMatch(app, /(?<!\$)\$\('\[data-server-remove\]',owner\)\.forEach/);
});

test('server catalog RPC responses are normalized before rendering', () => {
  assert.match(app, /Array\.isArray\(response\)\?response:Array\.isArray\(response\?\.items\)\?response\.items:Array\.isArray\(response\?\.servers\)\?response\.servers:\[\]/);
});

test('OptiFine action points to the official catalog and warns for non-Forge instances', () => {
  assert.match(app, /https:\/\/optifine\.net\/downloads/);
  assert.match(app, /if\(i\.loader!=='forge'\)throw new Error\('Для этой сборки OptiFine не подходит/);
});

test('OptiFine can be discovered and downloaded from the official catalog', () => {
  const optifine = fs.readFileSync(path.join(root, 'core/optifine.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(optifine, /https:\/\/optifine\.net\/downloads/);
  assert.match(optifine, /pathname !== '\/adloadx'/);
  assert.match(optifine, /pathname === '\/downloadx'/);
  assert.match(optifine, /module\.exports = \{ detectVersion, inspect, findOfficialRelease, downloadOfficial, install \}/);
  assert.match(main, /async downloadAndInstallOptiFine\(id\)/);
  assert.match(app, /downloadAndInstallOptiFine/);
});

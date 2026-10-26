'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('official mod catalog is backed by a dedicated GitHub Release', () => {
  const core = read('core/official-mods.js');
  const main = read('main.js');
  const renderer = read('renderer/app.js');
  assert.match(core, /fox-official-mods/);
  assert.match(core, /uploads\.github\.com/);
  assert.match(core, /MAX_BYTES = 100 \* 1024 \* 1024/);
  assert.match(core, /sha256:/);
  assert.match(core, /path\.join\(gameDir, 'mods'\)/);
  assert.match(main, /adminOfficialModUpload/);
  assert.match(main, /adminOfficialModDelete/);
  assert.match(main, /officialModInstall/);
  assert.match(renderer, /Официальные моды Fox Launcher/);
  assert.match(renderer, /setInterval\(\(\)=>\{if\(S\.page==='mods'\)refreshOfficialMods\(\)/);
});

test('official mod uploads are gated by local admin and optional Fox owner checks', () => {
  const main = read('main.js');
  assert.match(main, /async adminOfficialModUpload\(token, metadata = \{\}\)\s*\{\s*admin\.require\(token\)/);
  assert.match(main, /async adminOfficialModDelete\(token, assetId\)\s*\{\s*admin\.require\(token\)/);
  assert.match(main, /await cloud\.isAdmin\(\)/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('global launcher modes are server-authoritative and admin-gated', () => {
  const sql = read('backend/migrate-2.6-launcher-modes.sql');
  for (const mode of ['alarm', 'ceremony', 'maintenance', 'warning', 'celebration', 'info']) {
    assert.ok(sql.includes("'" + mode + "'"), 'migration supports mode ' + mode);
  }
  assert.match(sql, /exists\s*\(select 1 from public\.fox_admins where id=u\)/i);
  assert.match(sql, /if not adm then raise exception/i);
  assert.match(sql, /ends_at\s*<=\s*now\(\)/i);
  assert.match(sql, /'blocked',\s*\(r\.mode='maintenance' and not adm\)/i);
  assert.match(sql, /grant execute on function public\.fox_launcher_mode\(text,jsonb\) to anon, authenticated/i);
});

test('launcher UI uses server modes and maintenance launch gate', () => {
  const main = read('main.js');
  const cloud = read('core/cloud.js');
  const renderer = read('renderer/app.js');
  const html = read('renderer/index.html');
  assert.match(main, /'launcher_mode','presence'/);
  assert.match(cloud, /rpc\/fox_launcher_mode/);
  assert.match(renderer, /refreshLauncherMode/);
  assert.match(renderer, /if\(mode\.blocked\)/);
  assert.match(renderer, /launcherModeAdminPanel/);
  assert.match(html, /id="launcherModeOverlay"/);
});

test('Windows autostart defaults on and user preference is preserved', () => {
  const main = read('main.js');
  const renderer = read('renderer/app.js');
  assert.match(main, /autoStart: true/);
  assert.match(main, /openAtLogin: st\.autoStart !== false/);
  assert.match(main, /async setAutoStart\(enabled\)/);
  assert.match(renderer, /\['autoStart','Запускать Fox Launcher вместе с Windows'/);
  assert.match(renderer, /call\('setAutoStart',autoStart\)/);
});

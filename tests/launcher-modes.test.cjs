'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('global launcher modes are server-authoritative and admin-gated', () => {
  const sql = read('backend/migrate-2.6-launcher-modes.sql');
  const scheduled = read('backend/migrate-2.7-launcher-schedule.sql');
  for (const mode of ['alarm', 'ceremony', 'maintenance', 'warning', 'celebration', 'info']) {
    assert.ok(sql.includes("'" + mode + "'"), 'migration supports mode ' + mode);
  }
  assert.match(sql, /exists\s*\(select 1 from public\.fox_admins where id=u\)/i);
  assert.match(sql, /if not adm then raise exception/i);
  assert.match(sql, /ends_at\s*<=\s*now\(\)/i);
  assert.match(sql, /'blocked',\s*\(r\.mode='maintenance' and not adm\)/i);
  assert.match(scheduled, /p_data->>'starts_at'/i);
  assert.match(scheduled, /p_data->>'ends_at'/i);
  assert.match(scheduled, /'active'/i);
  assert.match(scheduled, /ВНИМАНИЕ, РЕЖИМ ТРЕВОГИ/i);
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


test('scheduled modes expose exact dates and alarm is non-dismissible', () => {
  const renderer = read('renderer/app.js');
  const startup = read('renderer/startup.js');
  const html = read('renderer/index.html');
  assert.match(renderer, /id="launcherModeStarts" type="datetime-local"/);
  assert.match(renderer, /id="launcherModeEnds" type="datetime-local"/);
  assert.match(renderer, /mode==='alarm'\|\|!!state\.blocked/);
  assert.match(renderer, /setTimeout\(\(\)=>\{stopAlarmTimers\(\);call\('winClose'\)/);
  assert.match(startup, /6000\)/);
  assert.match(html, /id="startupCinematic"/);
});


test('owner balance migration provides server-side self/admin balance operations', () => {
  const sql = read('backend/migrate-2.8-owner-ruble-balance.sql');
  assert.match(sql, /fox_owner_set_rubles/);
  assert.match(sql, /fox_owner_grant_rubles/);
  assert.match(sql, /not exists\s*\(select 1 from public\.fox_admins where id=actor\)/i);
  assert.match(sql, /round\(p_amount \* 100\)/i);
  assert.match(sql, /insert into public\.fox_ledger/i);
  assert.match(sql, /grant execute on function public\.fox_owner_set_rubles/i);
});


test('updated sound brief is wired, test popup removed, and ten achievement icons exist', () => {
  const renderer = read('renderer/app.js');
  const css = read('renderer/styles.css');
  const html = read('renderer/index.html');
  assert.doesNotMatch(renderer, /ownerTestPopup/);
  assert.match(renderer, /achievement:'fc31ca320b0edd3\.mp3'/);
  assert.match(renderer, /reward:'3923cb8ada7ca47\.mp3'/);
  assert.match(renderer, /sound\('reward'\)/);
  assert.match(css, /\.launcher-mode-card\{width:100%;height:100%/);
  assert.match(html, /id="launcherModeOverlay"/);
  for (const id of ['firstLaunch','threeHours','fiftyHours','marathon','worlds5','worlds10','xp1000','xp5000','achievements5','achievements10']) {
    assert.match(renderer, new RegExp(id));
    assert.ok(require('fs').existsSync(path.join(root, 'assets', 'achievements', id + '.svg')), 'missing icon for ' + id);
  }
});

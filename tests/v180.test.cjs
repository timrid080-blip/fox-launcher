const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('1.8 migration secures owner self-balance, ruble grants and global announcements', () => {
  const sql = fs.readFileSync(path.join(root, 'backend/migrate-1.8.sql'), 'utf8');
  assert.match(sql, /fox_owner_set_rubles/);
  assert.match(sql, /fox_owner_grant_rubles/);
  assert.match(sql, /fox_owner_broadcast/);
  assert.match(sql, /from public\.fox_admins where id=actor/);
  assert.match(sql, /insert into public\.fox_notifications/);
  assert.match(sql, /fox_staff_audit/);
});
test('achievement image badges exist for all currently displayed achievements', () => {
  for (const id of ['gamer','addict','first30','explorer3','veteran25','quests10','quests30'])
    assert.ok(fs.existsSync(path.join(root, 'assets/achievements', `${id}.svg`)), `missing ${id}.svg`);
});

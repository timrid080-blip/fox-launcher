'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('owner badge is based on the viewed profile roles, not the current viewer', () => {
  const app = read('renderer/app.js');
  const start = app.indexOf('function roleTags(roles)');
  const end = app.indexOf('\n  function syncRoleNav', start);
  assert.ok(start >= 0 && end > start);
  const roleTags = app.slice(start, end);
  assert.match(roleTags, /list\.includes\('owner'\)/);
  assert.doesNotMatch(roleTags, /S\.cloud\?\.is_admin/);
});

test('toasts stay at the bottom-right on desktop and mobile and are not cleared by opening a modal', () => {
  const css = read('renderer/styles.css');
  const app = read('renderer/app.js');
  assert.match(css, /\.toasts\{position:fixed;right:20px;top:auto;bottom:20px/);
  assert.doesNotMatch(css, /\.toasts\{[^}]*top:64px;bottom:auto/);
  assert.doesNotMatch(app, /\$\('#toasts'\)\.replaceChildren\(\)/);
});

test('owner-issued rubles use the existing paid_kopeks balance in 100-kopeck units', () => {
  const cloud = read('core/cloud.js');
  const sql = read('backend/migrate-2.7-paid-kopeks-admin.sql');
  assert.match(cloud, /fox_owner_grant_paid_rubles/);
  assert.match(cloud, /fox_owner_admin_users/);
  assert.match(sql, /set paid_kopeks=new_kopeks/);
  assert.match(sql, /values\(p_user,actor,'paid_kopeks',p_rubles\*100/);
  assert.match(sql, /set paid_kopeks=new_kopeks where id=p_user/);
  assert.match(sql, /create or replace function public\.fox_owner_set_rubles/);
});

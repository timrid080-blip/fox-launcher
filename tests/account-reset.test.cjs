'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('account reset is exposed in profile and routed through authenticated RPC', () => {
  const app = read('renderer/app.js');
  const cloud = read('core/cloud.js');
  const main = read('main.js');
  assert.match(app, /id="resetFoxAccount"/);
  assert.match(app, /account_reset/);
  assert.match(app, /Нельзя отменить|нельзя отменить/i);
  assert.match(cloud, /fox_reset_account/);
  assert.match(main, /cloudAction/);
});

test('account reset RPC requires the current user and preserves paid assets', () => {
  const sql = read('backend/migrate-5.0.0-consolidated.sql');
  const start = sql.lastIndexOf('create or replace function public.fox_reset_account()');
  assert.notEqual(start, -1, 'consolidated migration must define reset RPC');
  const fn = sql.slice(start);
  assert.match(fn, /auth\.uid\(\)/);
  assert.match(fn, /from public\.fox_profiles where id=u/);
  assert.match(fn, /update public\.fox_wallets set foxes=0, pumpkins=0 where id=u/);
  assert.match(fn, /delete from public\.fox_progress where user_id=u/);
  assert.match(fn, /delete from public\.fox_achievements where user_id=u/);
  assert.match(fn, /delete from public\.fox_daily_rewards where user_id=u/);
  assert.match(fn, /delete from public\.fox_daily_play where user_id=u/);
  assert.match(fn, /delete from public\.fox_quest_claims where user_id=u/);
  assert.doesNotMatch(fn, /delete from public\.fox_purchases|delete from public\.fox_payment_orders|paid_kopeks\s*=\s*0/i);
  assert.match(fn, /revoke all on function public\.fox_reset_account\(\) from public, anon/);
  assert.match(fn, /grant execute on function public\.fox_reset_account\(\) to authenticated/);
});

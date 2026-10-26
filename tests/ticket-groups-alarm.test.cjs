'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('alarm overlay shows the TempoSMP warning and uses the Fox ID auth visual system', () => {
  const app = read('renderer/app.js');
  const html = read('renderer/index.html');
  const css = read('renderer/styles.css');
  assert.match(app, /ЛАУНЧЕР ПОД УГРОЗОЙ/);
  assert.match(app, /до объявления отбоя в Telegram-канале @TempoSMP/);
  assert.match(html, /href="https:\/\/t\.me\/TempoSMP"/);
  assert.match(css, /\.launcher-mode-overlay\[data-mode="alarm"\].*background:/);
  assert.match(app, /btn\.hidden=!!state\.blocked\|\|\(mode==='alarm'&&!state\.is_admin\)/);
});

test('support archive and cleanup retain tickets through the appeal window and allow owner-only deletion', () => {
  const sql = read('backend/migrate-2.8-ticket-archive-cleanup.sql');
  const app = read('renderer/app.js');
  const cloud = read('core/cloud.js');
  assert.match(sql, /created_at\+interval '2 days'/);
  assert.match(sql, /appeal_until=created_at\+interval '3 days'/);
  assert.match(sql, /closed_at\+interval '1 minute'/);
  assert.match(sql, /created_at<=now\(\)-interval '3 days'/);
  assert.match(sql, /fox_friend_messages where created_at<=now\(\)-interval '3 days'/);
  assert.match(sql, /not exists\(select 1 from public\.fox_admins where id=u\)/);
  assert.match(app, /support_archive_list/);
  assert.match(app, /support_delete/);
  assert.match(cloud, /fox_support_archive_list/);
  assert.match(cloud, /fox_support_delete/);
});

test('friend groups support member management, chat and multi-party WebRTC signaling', () => {
  const sql = read('backend/migrate-2.9-group-chat.sql');
  const callSql = read('backend/migrate-3.0-group-calls.sql');
  const app = read('renderer/app.js');
  const cloud = read('core/cloud.js');
  assert.match(sql, /create table if not exists public\.fox_chat_groups/);
  assert.match(sql, /create table if not exists public\.fox_chat_group_messages/);
  assert.match(sql, /public\.fox_are_friends\(u,target\)/);
  assert.match(callSql, /create table if not exists public\.fox_group_call_signals/);
  assert.match(callSql, /if \(select count\(\*\) from public\.fox_group_call_participants where call_id=cid\)>=6/);
  assert.match(app, /async function createFriendGroup/);
  assert.match(app, /async function groupVoiceCall/);
  assert.match(app, /Групповой звонок/);
  assert.match(cloud, /fox_group_call_signal/);
  assert.match(cloud, /fox_group_chat/);
});

test('test notification action is available from the notification bell dialog', () => {
  const app = read('renderer/app.js');
  assert.match(app, /Тест уведомления/);
  assert.match(app, /bind\('#notificationBell'/);
});

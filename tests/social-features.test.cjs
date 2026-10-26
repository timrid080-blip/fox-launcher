'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('tutorial renders without calling foxHero with a string and has working navigation', () => {
  const app = read('renderer/app.js');
  assert.equal(app.includes("foxHero('Обучение Fox Launcher'"), false);
  assert.match(app, /data-tutorial-go="friends"/);
  assert.match(app, /\[data-tutorial-go\]/);
});

test('friends expose chat and call actions, and renderer RPCs are allowed', () => {
  const app = read('renderer/app.js');
  const main = read('main.js');
  const cloud = read('core/cloud.js');
  assert.match(app, /data-friend-chat=/);
  assert.match(app, /data-friend-call=/);
  assert.match(app, /async function friendChatDialog/);
  assert.match(main, /'friend_chat','call_signal'/);
  assert.match(cloud, /fox_friend_chat/);
  assert.match(cloud, /fox_call_signal/);
});

test('friends can send a game-build invitation through the existing private chat', () => {
  const app = read('renderer/app.js');
  assert.match(app, /data-friend-invite=/);
  assert.match(app, /async function inviteFriendToGame/);
  assert.match(app, /Minecraft: '\+instance\.mc/);
  assert.match(app, /cloudAction','friend_chat',\{op:'send',payload:\{friend:friend\.public_key,body\}\}/);
  assert.match(app, /Сначала создай сборку для приглашения/);
});

test('achievement and quest cards display icons and reward symbols', () => {
  const app = read('renderer/app.js');
  const css = read('renderer/styles.css');
  assert.match(app, /achievement-card-icon/);
  assert.match(app, /achievement-reward/);
  assert.match(app, /quest-reward/);
  assert.match(app, /instance-loader-icon/);
  assert.match(css, /\.achievement-card-icon/);
  assert.match(css, /\.instance-loader-icon/);
});

test('chat and call SQL migrations are included in the Windows artifact', () => {
  const workflow = read('.github/workflows/windows.yml');
  assert.match(workflow, /backend\/migrate-2\.0\.sql/);
  assert.match(workflow, /backend\/migrate-2\.2\.sql/);
  assert.match(read('backend/migrate-2.0.sql'), /fox_friend_chat/);
  assert.match(read('backend/migrate-2.2.sql'), /fox_call_signal/);
});

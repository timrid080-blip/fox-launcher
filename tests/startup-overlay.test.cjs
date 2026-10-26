const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('startup watchdog is loaded before app.js and owns a hard timeout', () => {
  const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
  assert.ok(html.indexOf('src="startup.js"') < html.indexOf('src="app.js"'));
  const startup = fs.readFileSync(path.join(root, 'renderer/startup.js'), 'utf8');
  assert.match(startup, /setTimeout\(\(\) => \{ clearInterval\(ticker\); removeOverlay\('', true\); \}, 6000\)/);
  assert.match(startup, /setTimeout\(\(\) => overlay\.remove\(\), 1000\)/);
});

test('app startup completion delegates to independent watchdog', () => {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(app, /window\.__foxFinishStartup\(message\|\|''\)/);
});

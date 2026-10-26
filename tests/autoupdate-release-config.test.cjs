'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('4.0.3 has GitHub publish metadata for the Fox Launcher updater', () => {
  assert.equal(pkg.version, '4.0.3');
  assert.equal(pkg.repository.url, 'https://github.com/timrid080-blip/fox-launcher.git');
  assert.ok(Array.isArray(pkg.build.publish));
  assert.ok(pkg.build.publish.some(p => p.provider === 'github' && p.owner === 'timrid080-blip' && p.repo === 'fox-launcher' && p.releaseType === 'release'));
  assert.equal(pkg.build.win.target.includes('nsis'), true);
  assert.equal(pkg.dependencies['electron-updater'] !== undefined, true);
});

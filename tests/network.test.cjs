'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { radminAddresses, networkArgs, launchNetwork } = require('../core/network');

const ipv4 = (address, extra = {}) => ({ address, family: 'IPv4', internal: false, ...extra });

test('Radmin detection requires Windows, adapter name and valid external 26/8 IPv4', () => {
  const interfaces = {
    'Radmin VPN': [ipv4('26.10.20.30'), ipv4('26.10.20.30'), ipv4('10.0.0.1'),
      ipv4('26.0.0.999'), ipv4('26.1.1.1', { internal: true }),
      { address: 'fe80::1', family: 'IPv6', internal: false }],
    Ethernet: [ipv4('26.2.2.2')],
    'RADMIN VPN 2': [ipv4('26.3.3.3', { family: 4 })],
    'Radmin VPN disconnected': [],
  };
  assert.deepEqual(radminAddresses(interfaces, 'win32'), [
    { name: 'Radmin VPN', address: '26.10.20.30' },
    { name: 'RADMIN VPN 2', address: '26.3.3.3' },
  ]);
  assert.deepEqual(radminAddresses(interfaces, 'linux'), []);
  assert.deepEqual(radminAddresses(interfaces, 'darwin'), []);
  assert.deepEqual(radminAddresses({}, 'win32'), []);
  assert.deepEqual(radminAddresses(null, 'win32'), []);
});

test('network arguments are unchanged without Radmin and never mutate their input', () => {
  const args = ['-Xmx2048M', '-Djava.net.preferIPv4Stack=false'];
  const result = networkArgs(args, []);
  assert.deepEqual(result, args);
  assert.notEqual(result, args);
});

test('Radmin overrides conflicting IPv4 preferences without changing classpath or other properties', () => {
  const args = ['-Xmx2048M', '-Djava.net.preferIPv4Stack=false', '-cp', 'C:\\Game Files\\client.jar',
    '-Djava.net.preferIPv6Addresses=system', '-Djava.net.preferIPv4Stack=false', '-DignoreList=client.jar'];
  const original = [...args];
  const result = networkArgs(args, [{ address: '26.1.2.3' }]);
  assert.deepEqual(result, ['-Xmx2048M', '-cp', 'C:\\Game Files\\client.jar', '-DignoreList=client.jar',
    '-Djava.net.preferIPv4Stack=true', '-Djava.net.preferIPv6Addresses=false']);
  assert.deepEqual(args, original);
  assert.deepEqual(networkArgs(result, [{ address: '26.1.2.3' }]), result);
  assert.ok(!result.some(arg => /online-mode|authserver|sessionserver|server-ip/.test(arg)));
});

test('offline launch explains session failures without claiming to disable authentication', t => {
  t.mock.method(os, 'networkInterfaces', () => ({}));
  const logs = [];
  assert.deepEqual(launchNetwork(text => logs.push(text), 'offline'), []);
  assert.match(logs.join(''), /online-mode=true/);
  assert.match(logs.join(''), /Перезапуск лаунчера.*не исправляют/);
  assert.match(logs.join(''), /JVM-флага.*нет/);
  logs.length = 0;
  launchNetwork(text => logs.push(text), 'microsoft');
  assert.deepEqual(logs, []);
});

test('interface enumeration failure does not prevent launching Minecraft', t => {
  t.mock.method(os, 'networkInterfaces', () => { throw new Error('network unavailable'); });
  const logs = [];
  assert.deepEqual(launchNetwork(text => logs.push(text), 'offline'), []);
  assert.match(logs.join(''), /network unavailable/);
  assert.match(logs.join(''), /Офлайн-аккаунт/);
});

'use strict';
const os = require('os');
const { isIPv4 } = require('net');

function radminAddresses(interfaces, platform = process.platform) {
  if (platform !== 'win32') return [];
  const out = [];
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    // 26/8 alone is not proof of Radmin: only use a named Radmin adapter.
    if (!/radmin/i.test(name)) continue;
    for (const entry of addresses || []) {
      if (!entry || entry.internal || !['IPv4', 4].includes(entry.family)) continue;
      if (!isIPv4(entry.address) || !entry.address.startsWith('26.')) continue;
      if (!out.some(a => a.address === entry.address)) out.push({ name, address: entry.address });
    }
  }
  return out;
}

function networkArgs(args, adapters) {
  if (!adapters.length) return [...args];
  const properties = ['-Djava.net.preferIPv4Stack=', '-Djava.net.preferIPv6Addresses='];
  // Applied after custom and version arguments so an earlier flag cannot win.
  return [
    ...args.filter(arg => !properties.some(prefix => arg.startsWith(prefix))),
    '-Djava.net.preferIPv4Stack=true',
    '-Djava.net.preferIPv6Addresses=false',
  ];
}

function launchNetwork(onLog, accountType) {
  let adapters = [];
  try { adapters = radminAddresses(os.networkInterfaces()); }
  catch (e) { onLog(`[Fox] Не удалось получить сетевые интерфейсы: ${e.message}\n`); }
  if (adapters.length) {
    onLog(`[Fox] Radmin VPN: ${adapters.map(a => `${a.name}: ${a.address}`).join(', ')}. Для Java включён IPv4.\n`);
    onLog('[Fox] Друг подключается напрямую к вашему адресу 26.x.x.x и порту из «Открыть для сети». Автопоиск LAN через VPN может не работать.\n');
    onLog('[Fox] IPv4 не привязывает сокеты к адаптеру: маршрут выбирает Windows. Наличие адреса не подтверждает доступность друга; проверьте VPN и разрешение Java в брандмауэре.\n');
  }
  if (accountType === 'offline') {
    onLog('[Fox] Офлайн-аккаунт: сервер с online-mode=true отклонит проверку сессии. Перезапуск лаунчера и Radmin VPN это не исправляют.\n');
    onLog('[Fox] Для своей доверенной игры нужен сервер с online-mode=false либо совместимый LAN-мод на стороне хоста. JVM-флага для отключения проверки во встроенном vanilla LAN-сервере нет.\n');
  }
  return adapters;
}

module.exports = { radminAddresses, networkArgs, launchNetwork };

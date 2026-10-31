'use strict';
const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const { download } = require('./util');

function detectVersion(file) {
  const n = path.basename(file);
  const m = n.match(/(?:OptiFine[_-])?(1\\.\\d+(?:\\.\\d+)?)/i);
  return m?.[1] || null;
}
function inspect(file, mc, loader) {
  const version = detectVersion(file);
  if (!version) throw new Error('Не удалось определить версию Minecraft из имени OptiFine JAR');
  if (version !== mc) throw new Error(`Этот OptiFine предназначен для Minecraft ${version}, а сборка — ${mc}`);
  if (!['forge'].includes(String(loader).toLowerCase())) throw new Error('Установка OptiFine как мода доступна только для сборок Forge. Для других загрузчиков совместимость не гарантируется.');
  const zip = new AdmZip(file), entries = zip.getEntries();
  if (entries.length > 50000) throw new Error('Архив OptiFine выглядит некорректно');
  const names = entries.map(e => e.entryName);
  if (!names.some(n => /^(?:optifine\\/|net\\/optifine\\/|Config\\.class$)/i.test(n)) && !names.some(n => /optifine/i.test(n))) throw new Error('В выбранном JAR не найдены признаки OptiFine');
  if (names.some(n => n.startsWith('/') || n.split('/').includes('..'))) throw new Error('Небезопасные пути в архиве');
  return { version, bytes: require('fs').statSync(file).size };
}

async function findOfficialRelease(mc) {
  if (!/^1\\.\\d+(?:\\.\\d+)?$/.test(String(mc))) throw new Error('Некорректная версия Minecraft');
  const response = await fetch('https://optifine.net/downloads', { headers: { 'User-Agent': 'FoxLauncher/5.0.0' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Не удалось получить каталог OptiFine (HTTP ${response.status})`);
  const html = await response.text();
  const anchors = [...html.matchAll(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi)];
  let release = null;
  for (const match of anchors) {
    const href = match[1].replace(/&amp;/g, '&');
    let u;
    try { u = new URL(href, 'https://optifine.net/'); } catch { continue; }
    const fileName = u.searchParams.get('f');
    if (u.hostname !== 'optifine.net' || u.pathname !== '/adloadx' || !fileName || !fileName.startsWith(`OptiFine_${mc}_`) || !fileName.endsWith('.jar')) continue;
    release = { fileName, landingUrl: u.href };
    break;
  }
  if (!release) throw new Error(`На официальном сайте пока нет OptiFine для Minecraft ${mc}`);
  const landing = await fetch(release.landingUrl, { headers: { 'User-Agent': 'FoxLauncher/5.0.0' }, signal: AbortSignal.timeout(20000) });
  if (!landing.ok) throw new Error('Не удалось открыть страницу загрузки OptiFine');
  const landingHtml = await landing.text();
  const direct = [...landingHtml.matchAll(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi)]
    .map(m => m[1].replace(/&amp;/g, '&'))
    .map(href => { try { return new URL(href, 'https://optifine.net/'); } catch { return null; } })
    .find(u => u && u.hostname === 'optifine.net' && u.pathname === '/downloadx' && u.searchParams.get('f') === release.fileName);
  if (!direct) throw new Error('Официальный сервер не предоставил прямую ссылку. Открой каталог OptiFine и попробуй позже.');
  return { ...release, downloadUrl: direct.href };
}

async function downloadOfficial(release, cacheDir) {
  if (!release || !/^OptiFine_1\\.\\d+(?:\\.\\d+)?_[A-Za-z0-9_.-]+\\.jar$/.test(release.fileName) ||
      !/^https:\\/\\/optifine\\.net\\/downloadx\\?/.test(release.downloadUrl)) throw new Error('Некорректная официальная ссылка OptiFine');
  await fs.mkdir(cacheDir, { recursive: true });
  const dest = path.join(cacheDir, path.basename(release.fileName));
  try {
    await fs.access(dest);
    return dest;
  } catch {}
  await download(release.downloadUrl, dest, { retries: 2 });
  try {
    const version = detectVersion(dest);
    if (!version) throw new Error('Скачанный файл не похож на OptiFine JAR');
    const zip = new AdmZip(dest);
    if (!zip.getEntries().some(e => /optifine/i.test(e.entryName))) throw new Error('Сервер вернул файл, который не содержит OptiFine');
  } catch (e) {
    try { await fs.unlink(dest); } catch {}
    throw e;
  }
  return dest;
}

async function install(file, modsDir, mc, loader) {
  const info = inspect(file, mc, loader);
  await fs.mkdir(modsDir, { recursive: true });
  const dest = path.join(modsDir, path.basename(file));
  if (path.resolve(file) === path.resolve(dest)) return { ...info, path: dest };
  try {
    await fs.access(dest);
    throw new Error('В папке mods уже есть файл с таким именем');
  } catch (e) { if (e.message === 'В папке mods уже есть файл с таким именем') throw e; }
  await fs.copyFile(file, dest);
  return { ...info, path: dest };
}
module.exports = { detectVersion, inspect, findOfficialRelease, downloadOfficial, install };

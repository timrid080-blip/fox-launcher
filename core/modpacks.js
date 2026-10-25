'use strict';
const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');
const { validName } = require('./packs');
const { download, fetchJson } = require('./util');
const { versions } = require('./modrinth');
const API = 'https://api.modrinth.com/v2';
const LIMIT = 1024 * 1024 * 1024;
const ROOTS = new Set(['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'kubejs', 'scripts', 'saves', 'datapacks']);
const HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']);
function safePath(name) {
  if (typeof name !== 'string' || name.length > 500 || name.split('/').some(p => !validName(p))) throw new Error('Небезопасный путь в сборке');
  const bits = name.split('/');
  if (!ROOTS.has(bits[0]) && !(bits.length === 1 && ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat'].includes(name))) throw new Error('Недопустимый файл сборки: ' + name);
  return name;
}
function safeDownload(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || u.username || u.password || (u.port && u.port !== '443')) throw new Error('Неподдерживаемый источник файла сборки');
  return u.href;
}
function inspect(file) {
  const zip = new AdmZip(file), entries = zip.getEntries();
  if (entries.length > 20000) throw new Error('В сборке слишком много файлов');
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry || entry.header.size > 4 * 1024 * 1024) throw new Error('Нет корректного описания сборки');
  const m = JSON.parse(entry.getData().toString('utf8'));
  if (m.formatVersion !== 1 || m.game !== 'minecraft' || !Array.isArray(m.files) || m.files.length > 20000) throw new Error('Неподдерживаемый формат сборки');
  const deps = m.dependencies || {}, mc = deps.minecraft;
  if (!/^[\w.+-]+$/.test(mc || '') || mc.includes('..')) throw new Error('Не указана версия Minecraft');
  const loaders = Object.keys(deps).filter(k => k !== 'minecraft');
  if (loaders.length > 1 || loaders.some(k => !['fabric-loader', 'quilt-loader', 'forge', 'neoforge'].includes(k))) throw new Error('Эта сборка требует неподдерживаемый загрузчик. Выбери Fabric, Quilt, Forge или NeoForge.');
  const key = loaders[0], loaderVersion = key ? deps[key] : null;
  if (key && !/^[\w.+-]+$/.test(loaderVersion || '')) throw new Error('Некорректная версия загрузчика');
  const instance = { name: String(m.name || 'Новая сборка').slice(0, 80), mc, loader: ({ 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' })[key] || 'vanilla', loaderVersion, color: '#ff7a1a' };
  let total = 0;
  const seen = new Set(), files = [], overrides = new Map();
  for (const f of m.files) {
    const name = safePath(f.path), lower = name.toLowerCase();
    if (seen.has(lower)) throw new Error('Повторяющийся файл сборки');
    seen.add(lower);
    if (f.env?.client === 'unsupported' || f.env?.client === 'optional') continue;
    if (!Number.isSafeInteger(f.fileSize) || f.fileSize < 0 || !/^[a-f\d]{40}$/i.test(f.hashes?.sha1 || '') || !Array.isArray(f.downloads) || !f.downloads.length) throw new Error('Файл сборки не имеет размера или контрольной суммы');
    total += f.fileSize;
    files.push({ path: name, size: f.fileSize, sha1: f.hashes.sha1, url: safeDownload(f.downloads[0]) });
  }
  for (const e of entries) {
    if (e.isDirectory) continue;
    const prefix = e.entryName.startsWith('client-overrides/') ? 'client-overrides/' : e.entryName.startsWith('overrides/') ? 'overrides/' : null;
    if (!prefix) continue;
    const name = safePath(e.entryName.slice(prefix.length));
    if (((e.attr >>> 16) & 0xf000) === 0xa000) throw new Error('Ссылки в сборке не разрешены');
    total += e.header.size;
    const previous = overrides.get(name.toLowerCase());
    if (previous?.prefix === prefix) throw new Error('Повторяющийся файл настроек');
    if (!previous || prefix === 'client-overrides/') overrides.set(name.toLowerCase(), { path: name, entry: e, prefix });
  }
  if (total > LIMIT) throw new Error('Сборка больше 1 ГБ в распакованном виде');
  return { instance, files, overrides: [...overrides.values()], total };
}
async function prepare(root, projectId, versionId) {
  if (!/^[\w-]+$/.test(projectId || '') || !/^[\w-]+$/.test(versionId || '')) throw new Error('Некорректная сборка');
  const project = await fetchJson(`${API}/project/${projectId}`);
  if (project.project_type !== 'modpack') throw new Error('Выбранный проект не является сборкой');
  const ver = await fetchJson(`${API}/version/${versionId}`);
  if (ver.project_id !== project.id) throw new Error('Версия сборки не найдена');
  const f = ver.files.find(f => f.primary && f.filename.endsWith('.mrpack')) || ver.files.find(f => f.filename.endsWith('.mrpack'));
  if (!f || !/^[a-f\d]{40}$/i.test(f.hashes?.sha1 || '') || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > 256 * 1024 * 1024 || !/^[\w-]+$/.test(ver.id)) throw new Error('Нет подходящего архива сборки');
  const cache = path.join(root, 'cache', 'modpacks', ver.id + '.mrpack');
  await download(safeDownload(f.url), cache, { sha1: f.hashes.sha1, size: f.size });
  return inspect(cache);
}
async function install(info, dir, onProgress = () => {}) {
  let done = 0;
  for (const f of info.files) {
    onProgress({ stage: 'modpack', text: `Сборка: ${++done}/${info.files.length} · ${path.basename(f.path)}`, done, total: info.files.length });
    await download(f.url, path.join(dir, f.path), { sha1: f.sha1, size: f.size });
  }
  for (const f of info.overrides) {
    const target = path.join(dir, f.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, f.entry.getData());
  }
}
module.exports = { safePath, safeDownload, inspect, prepare, install };

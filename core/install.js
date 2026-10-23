'use strict';
const path = require('path');
const fsp = require('fs').promises;
const AdmZip = require('adm-zip');
const { OS, ARCH, download, pool, rulesAllow, mavenPath, fetchJson, readJson, writeJson, exists } = require('./util');
const { resolveVersion } = require('./versions');

function nativeClassifier(lib) {
  if (!lib.natives || !lib.natives[OS]) return null;
  return lib.natives[OS].replace('${arch}', ARCH.includes('64') ? '64' : '32');
}

/** Собирает список библиотек: {path, url, sha1, size, native, exclude} */
function collectLibraries(version) {
  const out = [];
  const seen = new Set();
  for (const lib of version.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const parts = lib.name.split(':');
    const key = parts[0] + ':' + parts[1] + (parts[3] ? ':' + parts[3] : '');
    const cls = nativeClassifier(lib);
    if (lib.downloads && lib.downloads.artifact) {
      const a = lib.downloads.artifact;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ path: a.path || mavenPath(lib.name), url: a.url, sha1: a.sha1, size: a.size, classpath: true,
          native: /:natives-/.test(lib.name), exclude: (lib.extract || {}).exclude });
      }
    } else if (!lib.downloads && !cls) {
      if (!seen.has(key)) {
        seen.add(key);
        const p = mavenPath(lib.name);
        const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
        out.push({ path: p, url: base + p, sha1: lib.sha1, size: lib.size, classpath: true });
      }
    }
    if (cls) {
      const c = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[cls];
      if (c) out.push({ path: c.path, url: c.url, sha1: c.sha1, size: c.size, classpath: false, native: true, exclude: (lib.extract || {}).exclude });
      else {
        const p = mavenPath(lib.name + ':' + cls);
        out.push({ path: p, url: (lib.url || 'https://libraries.minecraft.net/') + p, classpath: false, native: true, exclude: (lib.extract || {}).exclude });
      }
    }
  }
  return out;
}

async function extractNatives(root, version, libs) {
  const dir = path.join(root, 'versions', version.id, 'natives');
  await fsp.mkdir(dir, { recursive: true });
  for (const l of libs.filter(l => l.native)) {
    const file = path.join(root, 'libraries', l.path);
    if (!(await exists(file))) continue;
    try {
      const zip = new AdmZip(file);
      for (const e of zip.getEntries()) {
        if (e.isDirectory) continue;
        const n = e.entryName;
        if (n.startsWith('META-INF')) continue;
        if ((l.exclude || []).some(x => n.startsWith(x))) continue;
        if (!/\.(dll|so|dylib|jnilib)$/i.test(n)) continue;
        const target = path.join(dir, path.basename(n));
        if (await exists(target)) continue;
        await fsp.writeFile(target, e.getData());
      }
    } catch (e) { /* поврежденный архив — пропускаем */ }
  }
  return dir;
}

/** Полная установка/проверка версии. onProgress({stage, done, total, text}) */
async function installVersion(root, id, onProgress = () => {}) {
  onProgress({ stage: 'meta', text: 'Получение информации о версии…', done: 0, total: 1 });
  const version = await resolveVersion(root, id);
  const tasks = [];

  // client jar
  const jarId = version._jarId;
  const client = version.downloads && version.downloads.client;
  const jarPath = path.join(root, 'versions', jarId, jarId + '.jar');
  if (client) tasks.push({ url: client.url, dest: jarPath, sha1: client.sha1, size: client.size });

  // libraries
  const libs = collectLibraries(version);
  for (const l of libs) if (l.url) tasks.push({ url: l.url, dest: path.join(root, 'libraries', l.path), sha1: l.sha1, size: l.size });

  // logging config
  let logConfig = null;
  if (version.logging && version.logging.client && version.logging.client.file) {
    const f = version.logging.client.file;
    logConfig = { path: path.join(root, 'assets', 'log_configs', f.id), argument: version.logging.client.argument };
    tasks.push({ url: f.url, dest: logConfig.path, sha1: f.sha1, size: f.size });
  }

  // assets
  let assetIndex = null;
  if (version.assetIndex) {
    const ai = version.assetIndex;
    const idxPath = path.join(root, 'assets', 'indexes', ai.id + '.json');
    await download(ai.url, idxPath, { sha1: ai.sha1, size: ai.size });
    assetIndex = await readJson(idxPath, { objects: {} });
    for (const [name, o] of Object.entries(assetIndex.objects)) {
      const sub = o.hash.slice(0, 2);
      tasks.push({ url: `https://resources.download.minecraft.net/${sub}/${o.hash}`, dest: path.join(root, 'assets', 'objects', sub, o.hash), sha1: o.hash, size: o.size, asset: name });
    }
  }

  let done = 0;
  const total = tasks.length;
  let last = 0;
  const report = (force) => {
    const now = Date.now();
    if (force || now - last > 120) { last = now; onProgress({ stage: 'download', text: `Загрузка файлов игры: ${done}/${total}`, done, total }); }
  };
  await pool(tasks, 16, async t => { await download(t.url, t.dest, { sha1: t.sha1, size: t.size }); done++; report(); });
  report(true);

  onProgress({ stage: 'natives', text: 'Распаковка нативных библиотек…', done: total, total });
  const nativesDir = await extractNatives(root, version, libs);

  // legacy / virtual assets
  if (assetIndex && (assetIndex.virtual || assetIndex.map_to_resources)) {
    const vdir = path.join(root, 'assets', 'virtual', version.assetIndex.id);
    for (const [name, o] of Object.entries(assetIndex.objects)) {
      const target = path.join(vdir, name);
      if (await exists(target)) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash), target).catch(() => {});
    }
  }
  onProgress({ stage: 'done', text: 'Готово', done: total, total });
  return { version, libs, jarPath, nativesDir, logConfig, assetIndex };
}

module.exports = { installVersion, collectLibraries };

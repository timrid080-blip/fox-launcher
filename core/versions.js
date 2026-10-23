'use strict';
const path = require('path');
const fsp = require('fs').promises;
const { fetchJson, readJson, writeJson, exists } = require('./util');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
let manifestCache = null;

async function getManifest(root, force = false) {
  if (manifestCache && !force) return manifestCache;
  const cachePath = path.join(root, 'cache', 'version_manifest_v2.json');
  try {
    manifestCache = await fetchJson(MANIFEST);
    await writeJson(cachePath, manifestCache);
  } catch (e) {
    manifestCache = await readJson(cachePath, null);
    if (!manifestCache) throw new Error('Нет интернета и нет кэша списка версий');
  }
  return manifestCache;
}

/** Список версий: Mojang + локально установленные (Fabric/Quilt и т.д.) */
async function listVersions(root) {
  const m = await getManifest(root);
  const installed = await listInstalled(root);
  return {
    latest: m.latest,
    versions: m.versions.map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, installed: installed.includes(v.id) })),
    installed,
  };
}

async function listInstalled(root) {
  const dir = path.join(root, 'versions');
  try {
    const names = await fsp.readdir(dir);
    const out = [];
    for (const n of names) if (await exists(path.join(dir, n, n + '.json'))) out.push(n);
    return out;
  } catch { return []; }
}

/** Загружает json версии (локально или из манифеста) */
async function getRawVersion(root, id) {
  const p = path.join(root, 'versions', id, id + '.json');
  let json = await readJson(p, null);
  if (json) return json;
  const m = await getManifest(root);
  const entry = m.versions.find(v => v.id === id);
  if (!entry) throw new Error('Версия не найдена: ' + id);
  json = await fetchJson(entry.url);
  await writeJson(p, json);
  return json;
}

/** Разворачивает inheritsFrom (Fabric/Quilt поверх ванили) */
async function resolveVersion(root, id) {
  const json = await getRawVersion(root, id);
  if (!json.inheritsFrom) return { ...json, _jarId: json.jar || json.id, _chain: [json.id] };
  const parent = await resolveVersion(root, json.inheritsFrom);
  const merged = { ...parent, ...json };
  merged.libraries = [...(json.libraries || []), ...(parent.libraries || [])];
  if (parent.arguments || json.arguments) {
    merged.arguments = {
      game: [...((parent.arguments || {}).game || []), ...((json.arguments || {}).game || [])],
      jvm: [...((parent.arguments || {}).jvm || []), ...((json.arguments || {}).jvm || [])],
    };
  }
  merged.minecraftArguments = json.minecraftArguments || parent.minecraftArguments;
  merged.downloads = parent.downloads;
  merged.assetIndex = parent.assetIndex;
  merged.assets = parent.assets;
  merged.javaVersion = json.javaVersion || parent.javaVersion;
  merged.logging = parent.logging;
  merged._jarId = parent._jarId;
  merged._chain = [json.id, ...parent._chain];
  merged.id = json.id;
  return merged;
}

module.exports = { getManifest, listVersions, listInstalled, getRawVersion, resolveVersion };

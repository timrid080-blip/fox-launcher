'use strict';
const path = require('path');
const { fetchJson, writeJson } = require('./util');

const META = {
  fabric: 'https://meta.fabricmc.net/v2/versions/loader',
  quilt: 'https://meta.quiltmc.org/v3/versions/loader',
};

async function loaderVersions(type, mc) {
  if (type === 'neoforge') return require('./neoforge').versions(mc);
  if (!META[type]) return [];
  const list = await fetchJson(`${META[type]}/${encodeURIComponent(mc)}`);
  return list.map(x => ({ version: x.loader.version, stable: x.loader.stable !== false && !/beta|pre/i.test(x.loader.version) }));
}

/** Ставит профиль загрузчика, возвращает id версии вида fabric-loader-X-mc */
async function installLoader(root, type, mc, loaderVersion, opts = {}) {
  if (type === 'vanilla' || !type) return mc;
  if (type === 'neoforge') { if (!loaderVersion) { const list = await loaderVersions(type,mc); loaderVersion=(list.find(v=>v.stable)||list[0])?.version; } if(!loaderVersion) throw new Error('Нет NeoForge для Minecraft '+mc); return require('./neoforge').install(root,mc,loaderVersion,opts); }
  if (!META[type]) throw new Error('Загрузчик пока не поддерживается: ' + type);
  if (!loaderVersion) {
    const vs = await loaderVersions(type, mc);
    if (!vs.length) throw new Error(`${type} не поддерживает версию ${mc}`);
    loaderVersion = (vs.find(v => v.stable) || vs[0]).version;
  }
  const profile = await fetchJson(`${META[type]}/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`);
  await writeJson(path.join(root, 'versions', profile.id, profile.id + '.json'), profile);
  return profile.id;
}

module.exports = { loaderVersions, installLoader };

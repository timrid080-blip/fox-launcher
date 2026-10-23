'use strict';
const path = require('path');
const fs = require('fs').promises;
const { validName } = require('./packs');
const { fetchJson, download, readJson, writeJson } = require('./util');
const API = 'https://api.modrinth.com/v2';

const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };

async function search({ query = '', type = 'mod', gameVersion, loader, offset = 0, limit = 20, sort = 'relevance' }) {
  const facets = [[`project_type:${type}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader && type === 'mod') facets.push([`categories:${loader}`]);
  const q = new URLSearchParams({ query, facets: JSON.stringify(facets), offset, limit, index: sort });
  return fetchJson(`${API}/search?${q}`);
}

async function project(id) { return fetchJson(`${API}/project/${id}`); }

async function versions(id, { gameVersion, loader, type } = {}) {
  const q = new URLSearchParams();
  if (gameVersion) q.set('game_versions', JSON.stringify([gameVersion]));
  if (loader && type === 'mod') q.set('loaders', JSON.stringify([loader]));
  return fetchJson(`${API}/project/${id}/version?${q}`);
}

/** Ставит проект (и обязательные зависимости) в папку сборки */
async function install(gameDir, projectId, { gameVersion, loader, type = 'mod', versionId, onProgress } = {}, seen = new Set()) {
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  let ver;
  if (versionId) ver = await fetchJson(`${API}/version/${versionId}`);
  else {
    const list = await versions(projectId, { gameVersion, loader, type });
    ver = list.find(v => v.version_type === 'release') || list[0];
  }
  if (!ver) throw new Error('Нет подходящей версии для ' + (gameVersion || '') + ' ' + (loader || ''));
  if(gameVersion && !ver.game_versions.includes(gameVersion)) throw new Error('Версия мода не подходит для этой сборки');
  if(loader && type==='mod' && !ver.loaders.includes(loader)) throw new Error('Мод не подходит для загрузчика '+loader);
  const file = ver.files.find(f => f.primary) || ver.files[0];
  if(!file || !validName(file.filename)) throw new Error('Некорректное имя файла мода');
  const folder = FOLDERS[type] || 'mods';
  const dest = path.join(gameDir, folder, file.filename);
  onProgress && onProgress({ text: 'Скачивание ' + file.filename });
  await download(file.url, dest, { sha1: file.hashes && file.hashes.sha1, size: file.size });
  const installed = [file.filename];
  for (const d of ver.dependencies || []) {
    if (d.dependency_type !== 'required' || !d.project_id) continue;
    installed.push(...await install(gameDir, d.project_id, { gameVersion, loader, type, versionId: d.version_id, onProgress }, seen));
  }
  const trackPath=path.join(gameDir,'.fox-mods.json');
  const track=await readJson(trackPath,{}), old=track[projectId];
  if(old && old.file!==file.filename && old.folder===folder && validName(old.file)) { await fs.unlink(path.join(gameDir,folder,old.file)).catch(()=>{}); await fs.unlink(path.join(gameDir,folder,old.file+'.disabled')).catch(()=>{}); }
  track[projectId]={file:file.filename,folder,version:ver.id}; await writeJson(trackPath,track);
  return installed;
}

module.exports = { search, project, versions, install, FOLDERS };

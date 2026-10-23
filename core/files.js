'use strict';
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { validName } = require('./packs');

function safe(base, rel) {
  const p = path.resolve(base, rel || '.');
  if (p !== path.resolve(base) && !p.startsWith(path.resolve(base) + path.sep)) throw new Error('Путь вне папки сборки');
  let near=p;
  while(!fs.existsSync(near) && near!==path.dirname(near)) near=path.dirname(near);
  if(fs.existsSync(base)){ const realBase=fs.realpathSync(base),realNear=fs.realpathSync(near); if(realNear!==realBase&&!realNear.startsWith(realBase+path.sep)) throw new Error('Ссылка вне папки сборки'); }
  return p;
}

async function dirSize(p, depth = 0) {
  if (depth > 6) return 0;
  let total = 0;
  try {
    for (const d of await fsp.readdir(p, { withFileTypes: true })) {
      const f = path.join(p, d.name);
      if (d.isDirectory()) total += await dirSize(f, depth + 1);
      else total += (await fsp.stat(f)).size;
    }
  } catch {}
  return total;
}

async function list(base, rel) {
  const dir = safe(base, rel);
  await fsp.mkdir(dir, { recursive: true });
  const items = [];
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    if(d.isSymbolicLink()) continue;
    const full = path.join(dir, d.name);
    let st; try { st = await fsp.stat(full); } catch { continue; }
    items.push({ name: d.name, dir: d.isDirectory(), size: d.isDirectory() ? null : st.size, mtime: st.mtimeMs,
      disabled: d.name.endsWith('.disabled') });
  }
  items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  return { path: path.relative(base, dir).split(path.sep).filter(Boolean), items };
}

async function rename(base, rel, newName) {
  if (!validName(newName)) throw new Error('Недопустимое имя');
  const from = safe(base, rel);
  const to=safe(base,path.relative(base,path.join(path.dirname(from),newName)));
  if(fs.existsSync(to)) throw new Error('Файл с таким именем уже существует');
  await fsp.rename(from, to);
}
async function mkdir(base, rel, name) { if(!validName(name)) throw new Error('Недопустимое имя папки'); await fsp.mkdir(safe(base, path.join(rel || '', name)), { recursive: true }); }
async function toggle(base, rel) {
  const p = safe(base, rel);
  await fsp.rename(p, p.endsWith('.disabled') ? p.slice(0, -9) : p + '.disabled');
}
async function importFiles(base, rel, sources) {
  const dir = safe(base, rel);
  await fsp.mkdir(dir,{recursive:true});
  for(const s of sources) { const target=safe(base,path.relative(base,path.join(dir,path.basename(s)))); if(fs.existsSync(target)) throw new Error('Файл уже существует: '+path.basename(s)); if((await fsp.lstat(s)).isSymbolicLink()) throw new Error('Импорт ссылок запрещён'); }
  for (const s of sources) await fsp.cp(s, path.join(dir, path.basename(s)), { recursive: true });
}
async function readText(base, rel) {
  const p = safe(base, rel);
  const st = await fsp.stat(p);
  if (st.size > 2 * 1024 * 1024) throw new Error('Файл слишком большой для просмотра');
  return fsp.readFile(p, 'utf8');
}
async function writeText(base, rel, text) { await fsp.writeFile(safe(base, rel), text, 'utf8'); }

module.exports = { safe, list, rename, mkdir, toggle, importFiles, readText, writeText, dirSize };

'use strict';
const fs = require('fs'), fsp = fs.promises, path = require('path');
const AdmZip = require('adm-zip');
const DIRS = new Set(['mods','config','defaultconfigs','resourcepacks','shaderpacks','kubejs','scripts','saves']);
const FILES = new Set(['options.txt','optionsof.txt','optionsshaders.txt','servers.dat']);
const LIMIT = 1024*1024*1024;
function validName(n) { return typeof n === 'string' && n.length > 0 && n.length < 240 && !/[\\/:*?"<>|\x00-\x1f]/.test(n) && !/[. ]$/.test(n) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(n) && n!=='.' && n!=='..'; }
function manifest(m) {
  if (m?.format !== 'foxpack' || m.version !== 1 || !m.instance || !/^[\w.\-+]+$/.test(m.instance.mc || '')) throw new Error('Это не сборка Fox Launcher');
  const i=m.instance;
  if (!['vanilla','fabric','quilt','neoforge'].includes(i.loader)) throw new Error('Этот загрузчик не поддерживается');
  if (i.loaderVersion && !/^[\w.\-+]+$/.test(i.loaderVersion)) throw new Error('Некорректная версия загрузчика');
  return { name:String(i.name || i.mc).slice(0,80), mc:i.mc, type:['release','snapshot','old_beta','old_alpha'].includes(i.type)?i.type:'release',
    loader:i.loader, loaderVersion:i.loaderVersion || null, color:/^#[a-f0-9]{6}$/i.test(i.color)?i.color:'#ff7a1a' };
}
function inspect(file) {
  if (fs.statSync(file).size > 512*1024*1024) throw new Error('Архив больше 512 МБ. Уменьшите сборку.');
  const zip=new AdmZip(file), entries=zip.getEntries();
  if(entries.length>20000) throw new Error('В архиве слишком много файлов');
  const meta=zip.getEntry('foxpack.json'); if(!meta || meta.header.size>100000) throw new Error('Нет foxpack.json');
  const instance=manifest(JSON.parse(meta.getData().toString('utf8')));
  let total=0; const seen=new Set();
  for(const e of entries) {
    const n=e.entryName.replace(/\/$/,'');
    if(!n || n.split('/').some(p=>!validName(p))) throw new Error('Небезопасный путь в архиве');
    if(seen.has(n.toLowerCase())) throw new Error('Повторяющийся путь в архиве'); seen.add(n.toLowerCase());
    if(((e.attr >>> 16)&0xf000)===0xa000) throw new Error('Ссылки в сборке не разрешены');
    if(n==='foxpack.json'||n==='fox-news.json') { if(e.header.size>4*1024*1024) throw new Error('Слишком большой файл метаданных'); continue; }
    if(!n.startsWith('files/')) throw new Error('Неизвестный раздел архива');
    const bits=n.slice(6).split('/');
    if(!DIRS.has(bits[0]) && !(bits.length===1 && FILES.has(bits[0]))) throw new Error('Недопустимый файл сборки');
    total+=e.header.size; if(total>LIMIT) throw new Error('Распакованная сборка больше 1 ГБ');
  }
  return { zip, instance, entries, total, hasNews:!!zip.getEntry('fox-news.json') };
}
async function extract(info, dest) {
  await fsp.mkdir(dest,{recursive:true});
  for(const e of info.entries) {
    if(!e.entryName.startsWith('files/') || e.isDirectory) continue;
    const p=path.join(dest,e.entryName.slice(6)); await fsp.mkdir(path.dirname(p),{recursive:true}); await fsp.writeFile(p,e.getData());
  }
}
async function exportPack(dir, instance, dest, { worlds=false, news=null }={}) {
  const zip=new AdmZip(); let size=0, count=0;
  zip.addFile('foxpack.json',Buffer.from(JSON.stringify({ format:'foxpack',version:1,instance:manifest({format:'foxpack',version:1,instance}) },null,2)));
  if(news) zip.addFile('fox-news.json',Buffer.from(JSON.stringify(news)));
  async function walk(folder,rel) {
    for(const e of await fsp.readdir(folder,{withFileTypes:true})) {
      if(!validName(e.name) || e.isSymbolicLink()) continue;
      const r=rel?rel+'/'+e.name:e.name, p=path.join(folder,e.name);
      if(e.isDirectory()) await walk(p,r);
      else if(e.isFile()) { const st=await fsp.stat(p);size+=st.size;if(size>LIMIT || ++count>19990) throw new Error('Сборка слишком большая: лимит 1 ГБ и 19990 файлов');zip.addFile('files/'+r,await fsp.readFile(p)); }
    }
  }
  for(const e of await fsp.readdir(dir,{withFileTypes:true})) {
    if(e.isSymbolicLink()) continue;
    if(e.isDirectory() && DIRS.has(e.name) && (e.name!=='saves'||worlds)) await walk(path.join(dir,e.name),e.name);
    else if(e.isFile() && FILES.has(e.name)) zip.addFile('files/'+e.name,await fsp.readFile(path.join(dir,e.name)));
  }
  const buffer=await zip.toBufferPromise();
  if(buffer.length>512*1024*1024) throw new Error('Сжатая сборка больше 512 МБ');
  await fsp.writeFile(dest,buffer); return { count, bytes:buffer.length };
}
module.exports={ inspect,extract,exportPack,validName };

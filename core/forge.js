'use strict';
const fs=require('fs').promises,path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const {download,writeJson,readJson,exists}=require('./util');
const {installVersion}=require('./install');
const {ensureJava}=require('./java');
const BASE='https://maven.minecraftforge.net/net/minecraftforge/forge';
let cache=null;
function mcOf(v){const m=/^(\d+\.\d+(?:\.\d+)?)-(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)$/.exec(v);return m?m[1]:null;}
async function versions(mc){
 if(!/^1\.\d+(?:\.\d+)?$/.test(mc))return [];
 const now=Date.now();if(!cache||now-cache.at>3600000){
  const r=await fetch('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',{signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('Не удалось получить список Forge: HTTP '+r.status);
  const xml=await r.text();cache={at:now,list:[...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(x=>x[1]).filter(v=>/^[\d.]+-[\d.]+$/.test(v))};
 }
 const list=cache.list.filter(v=>v.startsWith(mc+'-')).map(version=>({version:version.slice(mc.length+1),stable:true}));
 return list.reverse();
}
async function install(root,mc,v,opts={}){
 if(!(await versions(mc)).some(x=>x.version===v))throw new Error(`Forge ${v} не подтверждён для Minecraft ${mc}`);
 const onProgress=opts.onProgress||(()=>{}),onLog=opts.onLog||(()=>{});
 onProgress({stage:'loader',text:'Подготовка Minecraft для Forge…'});
 const version=await require('./versions').resolveVersion(root,mc),java=await ensureJava(root,version,{customPath:opts.javaPath,onProgress});
 await installVersion(root,mc,onProgress);
 const coordinate=`${mc}-${v}`,url=`${BASE}/${coordinate}/forge-${coordinate}-installer.jar`,jar=path.join(root,'cache',`forge-${coordinate}-installer.jar`);
 let sha=null;try{const r=await fetch(url+'.sha1',{signal:AbortSignal.timeout(15000)});if(r.ok){const t=(await r.text()).trim().split(/\s/)[0];if(/^[a-f0-9]{40}$/i.test(t))sha=t.toLowerCase();}}catch{}
 await download(url,jar,{onProgress,sha1:sha,strict:!!sha});
 if(sha&&crypto.createHash('sha1').update(await fs.readFile(jar)).digest('hex')!==sha){await fs.rm(jar,{force:true});throw new Error('Контрольная сумма Forge не совпала');}
 if(!await exists(path.join(root,'launcher_profiles.json')))await writeJson(path.join(root,'launcher_profiles.json'),{profiles:{},version:3});
 onProgress({stage:'loader',text:'Установка Forge: загрузка библиотек…'});
 const executable=java.path.replace(/javaw\.exe$/i,'java.exe');
 await new Promise((resolve,reject)=>{const p=spawn(executable,['-Djava.awt.headless=true','-jar',jar,'--installClient',root],{cwd:root,windowsHide:true});const timer=setTimeout(()=>{p.kill();reject(new Error('Установка Forge превысила 20 минут'));},1200000);p.stdout.on('data',b=>onLog('[Forge] '+b));p.stderr.on('data',b=>onLog('[Forge] '+b));p.once('error',e=>{clearTimeout(timer);reject(e);});p.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Установщик Forge завершился с кодом '+code));});});
 const entries=await fs.readdir(path.join(root,'versions')).catch(()=>[]);
 const candidates=entries.filter(id=>id.startsWith(mc+'-forge-')||id.startsWith(`${mc}-`)).sort().reverse();
 for(const id of candidates){const data=await readJson(path.join(root,'versions',id,id+'.json'),null);if(data&&(data.inheritsFrom===mc||id.includes('forge')))return id;}
 throw new Error('Forge завершил установку, но профиль версии не найден');
}
module.exports={versions,install};

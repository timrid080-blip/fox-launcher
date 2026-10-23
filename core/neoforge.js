'use strict';
const fs=require('fs').promises,path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const {download,writeJson,readJson,exists}=require('./util');
const {installVersion}=require('./install');
const {ensureJava}=require('./java');
const BASE='https://maven.neoforged.net/releases/net/neoforged/neoforge';
let metadata=null;
async function versions(mc){
 if(!metadata||Date.now()-metadata.at>3600000){const r=await fetch(BASE+'/maven-metadata.xml',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('NeoForge HTTP '+r.status);metadata={at:Date.now(),list:[...(await r.text()).matchAll(/<version>([^<]+)<\/version>/g)].map(x=>x[1])};}
 // NeoForge's pre-26 numbering encodes the Minecraft minor/patch (21.1.x => 1.21.1).
 let prefix;const m=/^1\.(\d+)\.(\d+)$/.exec(mc);if(m&&+m[1]>=20)prefix=`${m[1]}.${m[2]}.`;else if(/^1\.\d+$/.test(mc))prefix=mc.slice(2)+'.0.';else if(/^26\.\d+(?:\.\d+)?$/.test(mc))prefix=mc+'.';else return [];
 return metadata.list.filter(v=>v.startsWith(prefix)&&/^[\d.a-z+-]+$/i.test(v)).reverse().map(version=>({version,stable:!/[a-z]/i.test(version)}));
}
async function install(root,mc,v,opts={}){
 if(!(await versions(mc)).some(x=>x.version===v))throw new Error('Эта версия NeoForge не подходит к Minecraft '+mc);
 const onProgress=opts.onProgress||(()=>{}),onLog=opts.onLog||(()=>{});
 onProgress({stage:'loader',text:'Подготовка Minecraft для NeoForge…'});
 const version=await require('./versions').resolveVersion(root,mc);
 const java=await ensureJava(root,version,{customPath:opts.javaPath,onProgress});
 await installVersion(root,mc,onProgress);
 const url=`${BASE}/${v}/neoforge-${v}-installer.jar`,jar=path.join(root,'cache',`neoforge-${v}-installer.jar`);
 const r=await fetch(url+'.sha256',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Не удалось получить контрольную сумму установщика');
 const expected=(await r.text()).trim().split(/\s/)[0];if(!/^[a-f0-9]{64}$/i.test(expected))throw new Error('Неверная SHA256 NeoForge');
 await download(url,jar,{onProgress});const actual=crypto.createHash('sha256').update(await fs.readFile(jar)).digest('hex');if(actual!==expected.toLowerCase()){await fs.rm(jar,{force:true});throw new Error('Не совпала SHA256 установщика NeoForge');}
 if(!await exists(path.join(root,'launcher_profiles.json')))await writeJson(path.join(root,'launcher_profiles.json'),{profiles:{},version:3});
 const AdmZip=require('adm-zip'),zip=new AdmZip(jar),profile=JSON.parse(zip.readAsText('install_profile.json')),vj=JSON.parse(zip.readAsText(profile.json.replace(/^\//,'')));
 if(profile.minecraft!==mc||!/^[-\w.+]+$/.test(vj.id)||vj.inheritsFrom!==mc)throw new Error('Неожиданный профиль установщика NeoForge');
 onProgress({stage:'loader',text:'NeoForge: обработка библиотек (может занять несколько минут)…'});
 const executable=java.path.replace(/javaw\.exe$/i,'java.exe');
 await new Promise((resolve,reject)=>{const p=spawn(executable,['-Djava.awt.headless=true','-jar',jar,'--installClient',root],{cwd:root,windowsHide:true});const timer=setTimeout(()=>{p.kill();reject(new Error('Установка NeoForge превысила 20 минут'));},1200000);p.stdout.on('data',b=>onLog('[NeoForge] '+b));p.stderr.on('data',b=>onLog('[NeoForge] '+b));p.once('error',e=>{clearTimeout(timer);reject(e);});p.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Установщик NeoForge завершился с кодом '+code+' — проверьте консоль'));});});
 const output=await readJson(path.join(root,'versions',vj.id,vj.id+'.json'),null);if(!output)throw new Error('NeoForge не создал профиль версии');
 return vj.id;
}
module.exports={versions,install};

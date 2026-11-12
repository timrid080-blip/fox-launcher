'use strict';
const fs=require('fs').promises,path=require('path');
const AdmZip=require('adm-zip');
const KNOWN_CONFLICTS=[
 [['optifine'],['sodium'],'OptiFine обычно несовместим с Sodium. Удали один из них.'],
 [['optifine'],['iris'],'OptiFine конфликтует с Iris в большинстве конфигураций. Используй один шейдерный стек.'],
 [['optifine'],['indium'],'OptiFine и Indium несовместимы в типичных сборках Fabric.'],
 [['optifine'],['rubidium'],'OptiFine конфликтует с Rubidium.'],
 [['optifine'],['embeddium'],'OptiFine конфликтует с Embeddium.'],
 [['sodium'],['rubidium'],'Sodium и Rubidium — альтернативные рендереры; не устанавливай оба.'],
 [['sodium'],['embeddium'],'Sodium и Embeddium — альтернативные рендереры; не устанавливай оба.'],
 [['rubidium'],['embeddium'],'Rubidium и Embeddium — альтернативные рендереры; не устанавливай оба.'],
 [['iris'],['oculus'],'Iris и Oculus — альтернативные реализации шейдеров; не устанавливай оба.']
];
function modIdFromName(name){return path.basename(name).toLowerCase().replace(/\.jar$/,'').replace(/[-_+ ]\d.*$/,'').replace(/[^a-z0-9_-]/g,'');}
function readText(zip,name){try{const e=zip.getEntry(name);return e?e.getData().toString('utf8'):null;}catch{return null;}}
function versionParts(value){if(!/^\d+(?:\.\d+){0,3}$/.test(String(value||'')))return null;return String(value).split('.').map(Number);}
function compareVersions(a,b){const x=versionParts(a),y=versionParts(b);if(!x||!y)return null;for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d<0?-1:1;}return 0;}
function versionConstraintMatches(actual,constraint){
 const value=String(constraint||'').trim().replace(/^["']|["']$/g,'');if(!actual||!value)return null;
 const range=value.match(/^([[(])\s*([^,]*)\s*,\s*([^\])}]*)\s*([)\]])$/);
 if(range){const low=range[2].trim(),high=range[3].trim(),lo=low?compareVersions(actual,low):1,hi=high?compareVersions(actual,high):-1;if((low&&lo===null)||(high&&hi===null))return null;return (!low||lo>0||(lo===0&&range[1]==='['))&&(!high||hi<0||(hi===0&&range[4]===']'));}
 const cmp=value.match(/^(>=|>|<=|<|=)\s*(\d+(?:\.\d+){0,3})$/);if(cmp){const n=compareVersions(actual,cmp[2]);if(n===null)return null;return ({'>=':n>=0,'>':n>0,'<=':n<=0,'<':n<0,'=':n===0})[cmp[1]];}
 const wild=value.match(/^(\d+(?:\.\d+)*)(?:\.x|\.\*)$/i);if(wild)return String(actual).startsWith(wild[1]+'.')||String(actual)===wild[1];
 const exact=compareVersions(actual,value);return exact===null?null:exact===0;
}
function inspectJar(file){
 const info={file,id:modIdFromName(file),loader:'unknown',depends:[],minecraft:null,java:null,metadata:false};
 try{
  const zip=new AdmZip(file),fabric=readText(zip,'fabric.mod.json'),quilt=readText(zip,'quilt.mod.json'),neoforge=readText(zip,'META-INF/neoforge.mods.toml'),forge=readText(zip,'META-INF/mods.toml'),legacy=readText(zip,'mcmod.info');
  if(fabric){const j=JSON.parse(fabric);info.metadata=true;info.loader='fabric';info.id=j.id||info.id;info.depends=Object.entries(j.depends||{}).filter(([k])=>!['minecraft','java','fabricloader','forge','neoforge','quilt_loader','quilt-loader'].includes(k)).map(([id])=>id);if(j.depends?.minecraft)info.minecraft=String(j.depends.minecraft);if(j.depends?.java)info.java=String(j.depends.java);}
  else if(quilt){const j=JSON.parse(quilt);info.metadata=true;info.loader='quilt';info.id=j.quilt_loader?.id||j.id||info.id;const deps=j.quilt_loader?.depends||[];info.depends=deps.filter(x=>x?.id&&!['minecraft','java','fabricloader','forge','neoforge','quilt_loader','quilt-loader'].includes(x.id)).map(x=>x.id);const mc=deps.find(x=>x?.id==='minecraft'),java=deps.find(x=>x?.id==='java');if(mc?.versions)info.minecraft=String(mc.versions);if(java?.versions)info.java=String(java.versions);}
  else if(neoforge||forge){const toml=neoforge||forge;info.metadata=true;info.loader=neoforge?'neoforge':'forge';const id=toml.match(/modId\s*=\s*["']([^"']+)["']/i);if(id)info.id=id[1];const mcDeps=[...toml.matchAll(/\[\[dependencies\.[\w.-]+\]\]([\s\S]*?)(?=\[\[|$)/gi)];for(const d of mcDeps){const target=d[1].match(/modId\s*=\s*["']([^"']+)["']/i),mandatory=d[1].match(/mandatory\s*=\s*(true|false)/i),range=d[1].match(/versionRange\s*=\s*["']([^"']+)["']/i);if(target?.[1]==='minecraft'&&range)info.minecraft=range[1];else if(target&&mandatory?.[1]==='true'&&target[1]!=='forge'&&target[1]!=='neoforge')info.depends.push(target[1]);}}
  else if(legacy){const j=JSON.parse(legacy);const row=Array.isArray(j)?j[0]:j;if(row?.modid){info.metadata=true;info.loader='forge-legacy';info.id=row.modid;}}
 }catch(e){info.metadataError='Не удалось прочитать метаданные JAR';}
 return info;
}
async function scanMods(instanceDir,{loader='vanilla',mc=null}={}){
 let names=[];try{names=(await fs.readdir(path.join(instanceDir,'mods'),{withFileTypes:true})).filter(x=>x.isFile()&&x.name.toLowerCase().endsWith('.jar')).map(x=>x.name);}catch{}
 const inspected=names.map(name=>inspectJar(path.join(instanceDir,'mods',name))),ids=inspected.map(x=>String(x.id||'').toLowerCase()),warnings=[];
 for(const [a,b,message] of KNOWN_CONFLICTS){if(ids.some(id=>a.some(x=>id===x||id.includes(x)))&&ids.some(id=>b.some(x=>id===x||id.includes(x))))warnings.push({severity:'error',mods:[...a,...b],message});}
 const available=new Set(ids),byId=new Map();for(const mod of inspected){if(!mod.metadata)continue;const id=String(mod.id||'').toLowerCase();if(!byId.has(id))byId.set(id,[]);byId.get(id).push(mod);}
 for(const [id,files] of byId)if(id&&files.length>1)warnings.push({severity:'error',mods:files.map(x=>x.file),message:'Обнаружены несколько JAR с одним mod ID «'+id+'». Оставь только одну версию.'});
 for(const mod of inspected){
  const fileName=path.basename(mod.file);
  if(mod.metadataError)warnings.push({severity:'warning',file:fileName,message:'Метаданные JAR не удалось прочитать. Проверь, что файл не повреждён.'});
  if(mod.loader==='fabric'&&!['fabric','quilt'].includes(loader))warnings.push({severity:'error',file:fileName,message:'Внутри JAR обнаружены метаданные Fabric, но сборка использует '+loader+'.'});
  if(mod.loader==='quilt'&&loader!=='quilt')warnings.push({severity:'warning',file:fileName,message:'Мод собран для Quilt. Совместимость с '+loader+' не гарантируется.'});
  if(mod.loader==='forge'&&loader!=='forge')warnings.push({severity:'warning',file:fileName,message:'Мод собран для Forge, а сборка использует '+loader+'. Совместимость не подтверждена.'});
  if(mod.loader==='neoforge'&&loader!=='neoforge')warnings.push({severity:'warning',file:fileName,message:'Мод собран для NeoForge, а сборка использует '+loader+'. Совместимость не подтверждена.'});
  if(mod.loader==='forge-legacy'&&loader!=='forge')warnings.push({severity:'warning',file:fileName,message:'Обнаружен старый Forge-мод, но сборка использует '+loader+'.'});
  if(mod.loader==='unknown'&&loader==='vanilla')warnings.push({severity:'warning',file:fileName,message:'В сборке без загрузчика обнаружен JAR. Назначение файла не удалось подтвердить по метаданным.'});
  for(const dep of mod.depends)if(!available.has(String(dep).toLowerCase()))warnings.push({severity:'error',file:fileName,message:'Не найдена обязательная зависимость «'+dep+'» из метаданных мода.'});
  if(mc&&mod.minecraft){const match=versionConstraintMatches(mc,mod.minecraft);if(match===false)warnings.push({severity:'warning',file:fileName,message:'Метаданные требуют Minecraft '+mod.minecraft+', но сборка использует '+mc+'. Проверь совместимость версии.'});}
 }
 const optifine=names.find(n=>/optifine/i.test(n));if(optifine){const match=optifine.match(/(?:OptiFine[_-])?(1\.\d+(?:\.\d+)?)/i);if(mc&&match&&match[1]!==mc)warnings.push({severity:'error',file:optifine,message:'OptiFine по имени файла похож на версию Minecraft '+match[1]+', а сборка использует '+mc+'. Совместимость не подтверждена.'});if(['fabric','quilt','neoforge'].includes(loader))warnings.push({severity:'warning',file:optifine,message:'OptiFine обычно рассчитан на vanilla/Forge и не является универсальным модом для выбранного загрузчика.'});}
 return {count:names.length,warnings,mods:names,metadata:inspected.map(({file,id,loader,depends,minecraft,java,metadata,metadataError})=>({file:path.basename(file),id,loader,depends,minecraft,java,metadata,metadataError})),confidence:'metadata-assisted'};
}
module.exports={scanMods,modIdFromName,KNOWN_CONFLICTS,inspectJar,versionConstraintMatches};

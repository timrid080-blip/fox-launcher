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
function inspectJar(file){
 const info={file,id:modIdFromName(file),loader:'unknown',depends:[],minecraft:null,metadata:false};
 try{
  const zip=new AdmZip(file),fabric=readText(zip,'fabric.mod.json'),quilt=readText(zip,'quilt.mod.json'),neoforge=readText(zip,'META-INF/neoforge.mods.toml'),forge=readText(zip,'META-INF/mods.toml'),legacy=readText(zip,'mcmod.info');
  if(fabric){const j=JSON.parse(fabric);info.metadata=true;info.loader='fabric';info.id=j.id||info.id;info.depends=Object.entries(j.depends||{}).filter(([k])=>k!=='minecraft'&&k!=='java').map(([id])=>id);if(typeof j.depends?.minecraft==='string')info.minecraft=j.depends.minecraft;}
  else if(quilt){const j=JSON.parse(quilt);info.metadata=true;info.loader='quilt';info.id=j.quilt_loader?.id||j.id||info.id;const deps=j.quilt_loader?.depends||[];info.depends=deps.filter(x=>x?.id&&x.id!=='minecraft'&&x.id!=='java').map(x=>x.id);const mc=deps.find(x=>x?.id==='minecraft');if(mc?.versions)info.minecraft=String(mc.versions);}
  else if(neoforge||forge){const toml=neoforge||forge;info.metadata=true;info.loader=neoforge?'neoforge':'forge';const id=toml.match(/modId\s*=\s*["']([^"']+)["']/i);if(id)info.id=id[1];const mc=toml.match(/modLoader\s*=\s*["']([^"']+)["']/i);if(mc)info.forgeLoader=mc[1];const deps=[...toml.matchAll(/\[\[dependencies\.([\w.-]+)\]\]([\s\S]*?)(?=\[\[|$)/gi)];for(const d of deps){const target=d[2].match(/modId\s*=\s*["']([^"']+)["']/i),mandatory=d[2].match(/mandatory\s*=\s*(true|false)/i);if(target&&mandatory?.[1]==='true'&&target[1]!=='minecraft'&&target[1]!=='forge')info.depends.push(target[1]);}}
  else if(legacy){const j=JSON.parse(legacy);const row=Array.isArray(j)?j[0]:j;if(row?.modid){info.metadata=true;info.loader='forge-legacy';info.id=row.modid;}}
 }catch(e){info.metadataError='Не удалось прочитать метаданные JAR';}
 return info;
}
async function scanMods(instanceDir,{loader='vanilla',mc=null}={}){
 let names=[];try{names=(await fs.readdir(path.join(instanceDir,'mods'),{withFileTypes:true})).filter(x=>x.isFile()&&x.name.toLowerCase().endsWith('.jar')).map(x=>x.name);}catch{}
 const inspected=names.map(name=>inspectJar(path.join(instanceDir,'mods',name))),ids=inspected.map(x=>String(x.id||'').toLowerCase()),warnings=[];
 for(const [a,b,message] of KNOWN_CONFLICTS){if(ids.some(id=>a.some(x=>id===x||id.includes(x)))&&ids.some(id=>b.some(x=>id===x||id.includes(x))))warnings.push({severity:'error',mods:[...a,...b],message});}
 const available=new Set(ids);
 for(const mod of inspected){
  if(mod.loader==='fabric'&&['forge','neoforge'].includes(loader))warnings.push({severity:'error',file:mod.file,message:'Внутри JAR обнаружены метаданные Fabric, но сборка использует '+loader+'.'});
  if(mod.loader==='quilt'&&loader!=='quilt'&&loader!=='fabric')warnings.push({severity:'error',file:mod.file,message:'Внутри JAR обнаружены метаданные Quilt, но сборка использует '+loader+'.'});
  if(['forge','neoforge'].includes(mod.loader)&&['fabric','quilt'].includes(loader))warnings.push({severity:'error',file:mod.file,message:'Внутри JAR обнаружены метаданные Forge, но сборка использует '+loader+'.'});
  if(mod.loader==='unknown'&&loader==='vanilla')warnings.push({severity:'warning',file:mod.file,message:'В сборке без загрузчика обнаружен JAR. Назначение файла не удалось подтвердить по метаданным.'});
  for(const dep of mod.depends)if(!available.has(String(dep).toLowerCase()))warnings.push({severity:'warning',file:mod.file,message:'В метаданных указан обязательный мод-зависимость «'+dep+'», но он не найден в папке mods.'});
  if(mc&&mod.minecraft&&/^\d+\.\d+(?:\.\d+)?$/.test(mod.minecraft)&&mod.minecraft!==mc)warnings.push({severity:'warning',file:mod.file,message:'В метаданных указана Minecraft '+mod.minecraft+', а сборка использует '+mc+'. Проверь диапазон совместимости вручную.'});
 }
 const optifine=names.find(n=>/optifine/i.test(n));if(optifine){const match=optifine.match(/(?:OptiFine[_-])?(1\.\d+(?:\.\d+)?)/i);if(mc&&match&&match[1]!==mc)warnings.push({severity:'error',file:optifine,message:`OptiFine по имени файла похож на версию Minecraft ${match[1]}, а сборка использует ${mc}. Совместимость не подтверждена.`});if(['fabric','quilt','neoforge'].includes(loader))warnings.push({severity:'warning',file:optifine,message:'OptiFine обычно рассчитан на vanilla/Forge и не является универсальным модом для выбранного загрузчика.'});}
 return {count:names.length,warnings,mods:names,metadata:inspected.map(({file,id,loader,depends,minecraft,metadata})=>({file,id,loader,depends,minecraft,metadata})),confidence:'metadata-assisted'};
}
module.exports={scanMods,modIdFromName,KNOWN_CONFLICTS,inspectJar};

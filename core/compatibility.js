'use strict';
const fs=require('fs').promises,path=require('path');
const KNOWN_CONFLICTS=[
 [['optifine'],['sodium'],'OptiFine обычно несовместим с Sodium. Удали один из них.'],
 [['optifine'],['iris'],'OptiFine конфликтует с Iris в большинстве конфигураций. Используй один шейдерный стек.'],
 [['optifine'],['indium'],'OptiFine и Indium несовместимы в типичных сборках Fabric.'],
 [['optifine'],['rubidium'],'OptiFine конфликтует с Rubidium.'],
 [['optifine'],['embeddium'],'OptiFine конфликтует с Embeddium.'],
 [['sodium'],['rubidium'],'Sodium и Rubidium — альтернативные рендереры; не устанавливай оба.'],
 [['sodium'],['embeddium'],'Sodium и Embeddium — альтернативные рендереры; не устанавливай оба.'],
 [['rubidium'],['embeddium'],'Rubidium и Embeddium — альтернативные рендереры; не устанавливай оба.'],
 [['iris'],['oculus'],'Iris и Oculus — альтернативные реализации шейдеров; не устанавливай оба.'],
 [['fabric-api'],['forge'],'Fabric API не предназначен для Forge. Проверь loader модов сборки.'],
 [['quilted-fabric-api'],['forge'],'Quilted Fabric API не предназначен для Forge.']
];
function modIdFromName(name){return path.basename(name).toLowerCase().replace(/\.jar$/,'').replace(/[-_+ ]\d.*$/,'').replace(/[^a-z0-9_-]/g,'');}
async function scanMods(instanceDir,{loader='vanilla',mc=null}={}){
 let names=[];try{names=(await fs.readdir(path.join(instanceDir,'mods'),{withFileTypes:true})).filter(x=>x.isFile()&&x.name.toLowerCase().endsWith('.jar')).map(x=>x.name);}catch{}
 const ids=names.map(modIdFromName);const warnings=[];
 for(const [a,b,message] of KNOWN_CONFLICTS){if(ids.some(id=>a.some(x=>id.includes(x)))&&ids.some(id=>b.some(x=>id.includes(x))))warnings.push({severity:'error',mods:[...a,...b],message});}
 for(const name of names){const id=modIdFromName(name);if(loader==='fabric'&&/(forge|neoforge)/.test(id))warnings.push({severity:'warning',file:name,message:'Имя файла похоже на мод Forge/NeoForge, который может не работать на Fabric.'});if(loader==='forge'&&/(fabric|quilt)/.test(id))warnings.push({severity:'warning',file:name,message:'Имя файла похоже на мод Fabric/Quilt, который может не работать на Forge.'});if(loader==='vanilla'&&names.length)warnings.push({severity:'warning',file:name,message:'В сборке без загрузчика обнаружены JAR-моды.'});}
 const optifine=names.find(n=>/optifine/i.test(n));if(optifine){const match=optifine.match(/(?:OptiFine[_-])?(1\.\d+(?:\.\d+)?)/i);if(mc&&match&&match[1]!==mc)warnings.push({severity:'error',file:optifine,message:`OptiFine по имени файла похож на версию Minecraft ${match[1]}, а сборка использует ${mc}. Совместимость не подтверждена.`});if(loader==='fabric'||loader==='quilt'||loader==='neoforge')warnings.push({severity:'warning',file:optifine,message:'OptiFine обычно рассчитан на vanilla/Forge и не является универсальным модом для выбранного загрузчика.'});}
 return {count:names.length,warnings,mods:names};
}
module.exports={scanMods,modIdFromName,KNOWN_CONFLICTS};

'use strict';
const fs=require('fs').promises,path=require('path');
const AdmZip=require('adm-zip');
function detectVersion(file){const n=path.basename(file);const m=n.match(/(?:OptiFine[_-])?(1\.\d+(?:\.\d+)?)/i);return m?.[1]||null;}
function inspect(file,mc,loader){
 const version=detectVersion(file);if(!version)throw new Error('Не удалось определить версию Minecraft из имени OptiFine JAR');
 if(version!==mc)throw new Error(`Этот OptiFine предназначен для Minecraft ${version}, а сборка — ${mc}`);
 if(!['forge'].includes(loader))throw new Error('Установка OptiFine как мода доступна только для сборок Forge. Для других загрузчиков совместимость не гарантируется.');
 const zip=new AdmZip(file),entries=zip.getEntries();if(entries.length>50000)throw new Error('Архив OptiFine выглядит некорректно');
 const names=entries.map(e=>e.entryName);if(!names.some(n=>/^(?:optifine\/|net\/optifine\/|Config\.class$)/i.test(n))&&!names.some(n=>/optifine/i.test(n)))throw new Error('В выбранном JAR не найдены признаки OptiFine');
 if(names.some(n=>n.startsWith('/')||n.split('/').includes('..')))throw new Error('Небезопасные пути в архиве');
 return {version,bytes:require('fs').statSync(file).size};
}
async function install(file,modsDir,mc,loader){const info=inspect(file,mc,loader);await fs.mkdir(modsDir,{recursive:true});const dest=path.join(modsDir,path.basename(file));if(path.resolve(file)===path.resolve(dest))return {...info,path:dest};try{await fs.access(dest);throw new Error('В папке mods уже есть файл с таким именем');}catch(e){if(e.message==='В папке mods уже есть файл с таким именем')throw e;}await fs.copyFile(file,dest);return {...info,path:dest};}
module.exports={detectVersion,inspect,install};

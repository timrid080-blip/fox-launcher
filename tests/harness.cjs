const fs = require('fs'), path = require('path'), Module=require('module');
function harness(root,onEvent=()=>{}){
 const dialogs={open:[],save:[],confirm:[]};
 const fake={app:{setName(){},setAppUserModelId(){},getPath(){return root;},getVersion(){return '1.0.0';},isPackaged:false,requestSingleInstanceLock(){return false;},quit(){},on(){}},
  ipcMain:{handle(){}},shell:{async openPath(){return '';},showItemInFolder(){},openExternal(){},async trashItem(p){await fs.promises.rm(p,{recursive:true,force:true});}},
  dialog:{async showOpenDialog(){return dialogs.open.shift()||{canceled:true,filePaths:[]};},async showSaveDialog(){return dialogs.save.shift()||{canceled:true};},async showMessageBox(){return dialogs.confirm.shift()||{response:0};}},
  safeStorage:{isEncryptionAvailable:()=>false},nativeImage:{createFromPath(){}},session:{fromPartition(){return {};}}};
 const original=Module._load;Module._load=function(name,...args){return name==='electron'?fake:original.call(this,name,...args);};
 const filename=path.resolve(__dirname,'../main.js'),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 try{mod._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports={api,setWin:w=>{win=w;}};',filename);}finally{Module._load=original;}
 mod.exports.setWin({webContents:{send:(channel,type,payload)=>onEvent(type,payload)},isDestroyed:()=>false,show(){},hide(){}});
 return {...mod.exports,dialogs,root:path.join(root,'.foxlauncher')};
}
module.exports={harness};

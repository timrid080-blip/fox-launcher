'use strict';
function newerVersion(remote,current){const parse=v=>/^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).replace(/^v/,''))?.slice(1).map(Number);const a=parse(remote),b=parse(current);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
class Updates{
 constructor(app,dialog,getConfig,isPlaying,emit){Object.assign(this,{app,dialog,getConfig,isPlaying,emit});this.updater=null;this.status={state:'unconfigured'};this.checking=false;}
 set(state,extra={}){this.status={state,...extra};this.emit('update',this.status);}
 async init(){const g=(await this.getConfig()).github;if(!g.owner||!g.repo){this.set('unconfigured');return;}
  this.github=g;this.manual=!this.app.isPackaged||!!process.env.PORTABLE_EXECUTABLE_FILE;
  if(!this.manual){const {autoUpdater}=require('electron-updater');this.updater=autoUpdater;autoUpdater.setFeedURL({provider:'github',owner:g.owner,repo:g.repo,private:false});autoUpdater.autoDownload=true;autoUpdater.autoInstallOnAppQuit=false;autoUpdater.allowPrerelease=false;autoUpdater.on('error',e=>this.set('error',{message:e.message}));autoUpdater.on('update-available',i=>this.set('downloading',{version:i.version}));autoUpdater.on('update-not-available',()=>this.set('current'));autoUpdater.on('download-progress',p=>this.set('downloading',{percent:p.percent}));autoUpdater.on('update-downloaded',i=>this.set('ready',{version:i.version}));}
  await this.check();this.timer=setInterval(()=>this.check().catch(()=>{}),3600000);this.timer.unref();
 }
 async check(){if(this.checking)return this.status;if(!this.github){const g=(await this.getConfig()).github;if(!g.owner||!g.repo)return this.status;return this.init().then(()=>this.status);}this.checking=true;
  try{this.set('checking');if(this.manual){const g=this.github,r=await fetch(`https://api.github.com/repos/${g.owner}/${g.repo}/releases/latest`,{headers:{Accept:'application/vnd.github+json','User-Agent':'FoxLauncher'},signal:AbortSignal.timeout(15000)});if(r.status===404){this.set('current',{reason:'В репозитории пока нет публичных релизов.'});return this.status;}if(!r.ok)throw new Error('GitHub: '+r.status);const release=await r.json(),version=String(release.tag_name||'').replace(/^v/,'');if(!release.draft&&!release.prerelease&&newerVersion(version,this.app.getVersion())){this.set('available',{version,url:`https://github.com/${g.owner}/${g.repo}/releases/tag/${encodeURIComponent(release.tag_name)}`,reason:'Portable: скачай новый EXE и замени старый после закрытия лаунчера. Сборки и аккаунты сохранятся.'});}else this.set('current');}else await this.updater.checkForUpdates();
  }catch(e){this.set('error',{message:e.message});}finally{this.checking=false;}return this.status;
 }
 async install(){if(this.status.state!=='ready')throw new Error('Обновление ещё не загружено');if(this.isPlaying())throw new Error('Сначала закройте Minecraft');const r=await this.dialog.showMessageBox({type:'question',message:'Установить обновление Fox Launcher?',detail:'Лаунчер закроется и запустит установщик. Сборки и аккаунты останутся в папке данных.',buttons:['Отмена','Установить'],defaultId:0,cancelId:0});if(r.response===1)this.updater.quitAndInstall(false,true);}
}
module.exports={Updates,newerVersion};

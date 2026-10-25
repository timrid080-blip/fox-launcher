'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, nativeImage, session, Tray, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');

const { readJson, writeJson, exists } = require('./core/util');
const versions = require('./core/versions');
const loaders = require('./core/loaders');
const java = require('./core/java');
const auth = require('./core/auth');
const modrinth = require('./core/modrinth');
const newsApi = require('./core/news');
const files = require('./core/files');
const { launch } = require('./core/launch');
const { Admin } = require('./core/admin');
const { CommunityNews } = require('./core/community-news');
const packs = require('./core/packs');
const modpacks = require('./core/modpacks');
const { Services } = require('./core/services');
const { Cloud } = require('./core/cloud');
const { Playtime } = require('./core/playtime');
const { Updates } = require('./core/updater');

app.setName('Fox Launcher');
if (process.platform === 'win32') app.setAppUserModelId('com.foxbro.foxlauncher');

const ROOT = path.join(app.getPath('appData'), '.foxlauncher');
const P = {
  settings: path.join(ROOT, 'settings.json'),
  instances: path.join(ROOT, 'instances.json'),
  accounts: path.join(ROOT, 'accounts.json'),
  skins: path.join(ROOT, 'skins'),
};
const safeId = id => { if (typeof id !== 'string' || !id || id.length > 160 || id === '.' || id === '..' || /[\\/\x00]/.test(id)) throw new Error('Некорректный идентификатор'); return id; };
const instDir = id => path.join(ROOT, 'instances', safeId(id));
const admin = new Admin(ROOT);
const sharedDir = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : __dirname);
const community = new CommunityNews(ROOT, sharedDir);
const services = new Services(ROOT, sharedDir, safeStorage);
const cloud = new Cloud(ROOT, safeStorage, () => services.get());
const playtime = new Playtime(ROOT, cloud, send);
const updates = new Updates(app, dialog, () => services.get(), () => running.size > 0 || launching.size > 0, send);
const launching = new Set();
const installingMods = new Set();
function idle(id) { if (running.has(id) || launching.has(id) || installingMods.has(id)) throw new Error('Сначала закройте игру и дождитесь окончания установки'); }
function validateInstance(data) {
  if (!data || !/^[\w.\-+]+$/.test(data.mc || '') || data.mc.includes('..')) throw new Error('Некорректная версия Minecraft');
  if (!['vanilla','fabric','quilt','neoforge'].includes(data.loader || 'vanilla')) throw new Error('Неподдерживаемый загрузчик');
  if(data.loaderVersion && !/^[\w.\-+]+$/.test(data.loaderVersion)) throw new Error('Некорректная версия загрузчика');
}


const DEFAULT_SETTINGS = {
  memory: Math.min(4096, Math.max(1024, Math.floor(os.totalmem() / 1048576 / 4 / 256) * 256)),
  javaPath: '', jvmArgs: '-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions', width: 0, height: 0,
  closeOnLaunch: false, showConsoleOnLaunch: false, selectedInstance: null, selectedAccount: null, newsFeedUrl: '', accent: '#ff7a1a', sounds: true, soundVolume: 0.25, eventTheme: true,
};

let win;
let tray = null;
let forceQuit = false;
let toastWindow = null;
const running = new Map(); // instanceId -> process

function showAchievementToast(payload = {}) {
  const names = { gamer: 'Геймер', addict: 'Игроман' };
  const title = 'Достижение разблокировано';
  const body = names[payload.code] || String(payload.code || 'Новое достижение');
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png'), silent: false });
      n.show();
    }
  } catch (e) { console.warn('Achievement notification failed:', e.message); }
  try {
    if (toastWindow && !toastWindow.isDestroyed()) toastWindow.close();
    toastWindow = new BrowserWindow({ width: 360, height: 104, x: Math.max(0, (require('electron').screen.getPrimaryDisplay().workArea.width - 380)), y: 40,
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const html = `<!doctype html><html><body style="margin:0;background:transparent;font-family:Segoe UI,Arial;color:#fff"><div style="box-sizing:border-box;height:94px;border:1px solid #ff9a45;border-radius:14px;background:rgba(22,20,20,.97);padding:15px 18px;box-shadow:0 8px 30px #0008"><div style="color:#ffad63;font-size:11px;font-weight:700;letter-spacing:1px">FOX LAUNCHER · ДОСТИЖЕНИЕ</div><div style="font-size:18px;font-weight:700;margin-top:7px">${body.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</div><div style="color:#c8c8c8;font-size:12px;margin-top:4px">Новое достижение разблокировано</div></div></body></html>`;
    toastWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    toastWindow.once('ready-to-show', () => { if (toastWindow && !toastWindow.isDestroyed()) toastWindow.showInactive(); });
    setTimeout(() => { if (toastWindow && !toastWindow.isDestroyed()) toastWindow.close(); toastWindow = null; }, 6500);
  } catch (e) { console.warn('Achievement toast failed:', e.message); }
}
function send(type, payload) {
  if (type === 'achievement') showAchievementToast(payload);
  if (win && !win.isDestroyed()) win.webContents.send('event', type, payload);
}

// ---------- хранилище ----------
const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await readJson(P.settings, {})) });
const saveSettings = async s => { const cur = await getSettings(); const n = { ...cur, ...s }; await writeJson(P.settings, n); return n; };
const getInstances = () => readJson(P.instances, []);
const saveInstances = list => writeJson(P.instances, list);

function enc(s) {
  if (!s) return s;
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64'); } catch {}
  return s;
}
function dec(s) {
  if (!s || !s.startsWith('enc:')) return s;
  try { return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch { return null; }
}
async function getAccounts() {
  const list = await readJson(P.accounts, []);
  return list.map(a => ({ ...a, refreshToken: dec(a.refreshToken), accessToken: dec(a.accessToken) }));
}
async function saveAccounts(list) {
  await writeJson(P.accounts, list.map(a => ({ ...a, refreshToken: enc(a.refreshToken), accessToken: enc(a.accessToken) })));
}
const publicAccount = a => ({ id: a.id, type: a.type, name: a.name, uuid: a.uuid, skinVariant: a.skinVariant || 'classic', hasSkin: !!a.hasSkin, skinUrl: a.skinUrl || null });

async function upsertAccount(acc) {
  const list = await getAccounts();
  const i = list.findIndex(a => a.id === acc.id);
  if (i >= 0) list[i] = { ...list[i], ...acc }; else list.push(acc);
  await saveAccounts(list);
  await saveSettings({ selectedAccount: acc.id });
  return publicAccount(acc);
}

// ---------- логи log4j (XML) -> текст ----------
function makeLogParser(onLine) {
  let buf = '';
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  return chunk => {
    buf += chunk;
    for (;;) {
      const start = buf.indexOf('<log4j:Event');
      if (start === -1) { if (!buf.includes('<log4j')) { if (buf) onLine(buf); buf = ''; } break; }
      if (start > 0) { onLine(buf.slice(0, start)); buf = buf.slice(start); continue; }
      const end = buf.indexOf('</log4j:Event>');
      if (end === -1) break;
      const ev = buf.slice(0, end + 14);
      buf = buf.slice(end + 14).replace(/^\s+/, '');
      const head = ev.match(/timestamp="(\d+)" level="(\w+)" thread="([^"]*)"/);
      const msg = (ev.match(/<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Message>/) || [, ''])[1];
      const thr = (ev.match(/<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]><\/log4j:Throwable>/) || [, ''])[1];
      if (head) {
        const t = new Date(+head[1]).toTimeString().slice(0, 8);
        onLine(`[${t}] [${head[3]}/${head[2]}]: ${unesc(msg)}\n${thr ? unesc(thr) + '\n' : ''}`);
      }
    }
  };
}

// ---------- API для интерфейса ----------
const api = {
  async createDesktopShortcut() {
    if (process.platform !== 'win32') throw new Error('Ярлык рабочего стола доступен в Windows');
    const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    const ok = shell.writeShortcutLink(path.join(app.getPath('desktop'), 'Fox Launcher.lnk'), 'create', {
      target, args: app.isPackaged ? '' : '"' + __dirname + '"', cwd: path.dirname(target), description: 'Fox Launcher', icon: target, iconIndex: 0,
    });
    if (!ok) throw new Error('Не удалось создать ярлык на рабочем столе');
    return true;
  },
  getPlaytime: () => playtime.state(),
  cloudState: () => cloud.state(),
  async cloudRegister(email,password,nickname) { return cloud.register(email,password,nickname); },
  async cloudLogin(email,password) { if(running.size)throw new Error('Сначала закройте Minecraft для смены Fox ID'); const state=await cloud.login(email,password); if(state.profile) { const acc=auth.offline(state.profile.nickname); await upsertAccount(acc); } return state; },
  cloudLogout: () => { if(running.size)throw new Error('Сначала закройте Minecraft для выхода из Fox ID'); return cloud.logout(); },
  async cloudAction(action,data) { if (!['notifications','notification_read','admin_moderate','moderation_users','profile_settings','friends','friend_request','friend_accept','friend_remove','admin_role','staff_users','support_create','support_list','support_get','support_reply','support_close','support_assign','admin_ruble_price','admin_payments','payment_status','players','player_profile','admin_discount','state','buy','daily_claim','quest_claim','leaderboard','profile_visibility','equip','admin_users','admin_grant','admin_set_rubles','admin_event','admin_codes','call_signal'].includes(action)) throw new Error('Операция не разрешена'); return cloud.action(action,data); },
  async createPayment(amount,requestId){if(!Number.isInteger(amount)||amount<100||amount>15000||typeof requestId!=='string')throw new Error('Сумма пополнения: 100–15000 рублей');const r=await cloud.payment({op:'create',amount,request_id:requestId});if(r.id){const uid=(await cloud.restore())?.user?.id;if(uid){const pending=await readJson(path.join(ROOT,'pending-payments.json'),{});pending[uid]={id:r.id};await writeJson(path.join(ROOT,'pending-payments.json'),pending);}}if(r.confirmation_url){const url=new URL(r.confirmation_url);if(url.protocol!=='https:')throw new Error('Небезопасная ссылка оплаты');await shell.openExternal(url.href);}return r;},
  async getPendingPayment(){const uid=(await cloud.restore())?.user?.id;return uid?(await readJson(path.join(ROOT,'pending-payments.json'),{}))[uid]||null:null;},
  async checkPayment(id){const result=await cloud.payment({op:'status',id});if(['succeeded','canceled'].includes(result.status)){const uid=(await cloud.restore())?.user?.id,pending=await readJson(path.join(ROOT,'pending-payments.json'),{});if(uid&&pending[uid]?.id===id){delete pending[uid];await writeJson(path.join(ROOT,'pending-payments.json'),pending);}}return result;},
  skinEntitled: () => cloud.entitled(1),
  getServices: () => services.get(),
  async adminSaveServices(token,config) { admin.require(token); const previous=await services.get(); if(previous.supabase.url)await cloud.isAdmin(); await cloud.logout(); return services.save(config); },
  async adminExportServices(token) { admin.require(token); const r=await dialog.showSaveDialog(win,{title:'Публичная конфигурация для друзей (без секретов)',defaultPath:'fox-services.json',filters:[{name:'JSON',extensions:['json']}]}); if(r.canceled)return false; await writeJson(r.filePath,await services.get());return true; },
  async adminGitHubToken(token,value) { admin.require(token); if((await services.get()).supabase.url)await cloud.isAdmin();return services.token(value); },
  async adminPublishNews(token) { admin.require(token); if((await services.get()).supabase.url)await cloud.isAdmin();return services.publish(await community.feed()); },
  updateStatus: () => updates.status,
  openUpdate: async () => { const url=updates.status.url;if(!url||!/^https:\/\/github\.com\//.test(url))throw new Error('Ссылка обновления недоступна');return shell.openExternal(url); },
  checkUpdates: () => updates.check(),
  installUpdate: () => updates.install(),
  // Редактор локальных новостей; не серверная админка.
  adminLogin: password => admin.login(password),
  adminLogout: () => admin.logout(),
  adminChangePassword: (token, current, password) => admin.change(token, current, password),
  adminPosts: token => { admin.require(token); return community.localPosts(); },
  adminSavePost: (token, post) => { admin.require(token); return community.save(post); },
  async adminDeletePost(token,id) {
    admin.require(token);const c=await services.get();
    if(c.supabase.url)await cloud.isAdmin();
    await community.remove(id);
    if(c.github.owner&&c.github.repo){try{await services.publish(await community.feed());return {published:true};}catch(e){return {published:false,error:e.message};}}
    return {published:false};
  },
  async adminExportNews(token) {
    admin.require(token);
    const r = await dialog.showSaveDialog(win, { title: 'Экспорт новостей для друзей', defaultPath: path.join(sharedDir, 'fox-news.json'), filters: [{ name: 'Fox News', extensions: ['json'] }] });
    if (r.canceled) return false;
    await writeJson(r.filePath, await community.feed()); return true;
  },
  async importNews() {
    const r = await dialog.showOpenDialog(win, { title: 'Импорт новостей', properties: ['openFile'], filters: [{ name: 'Fox News', extensions: ['json'] }] });
    if (r.canceled) return null;
    if ((await fsp.stat(r.filePaths[0])).size > 4*1024*1024) throw new Error('Лента больше 4 МБ');
    return community.import(JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8')));
  },
  async exportPack(id, opts = {}) {
    idle(id);
    const inst = (await getInstances()).find(i => i.id === id); if (!inst) throw new Error('Сборка не найдена');
    const r = await dialog.showSaveDialog(win, { title: 'Экспорт сборки', defaultPath: inst.name.replace(/[\\/:*?"<>|]/g,'_') + '.foxpack', filters: [{ name: 'Fox Modpack', extensions: ['foxpack'] }] });
    if (r.canceled) return false;
    if(inst.loader!=='vanilla' && !inst.loaderVersion){ const choices=await loaders.loaderVersions(inst.loader,inst.mc); if(!choices.length) throw new Error('Загрузчик не поддерживает версию Minecraft'); inst.loaderVersion=(choices.find(v=>v.stable)||choices[0]).version; const list=await getInstances();const row=list.find(i=>i.id===id);row.loaderVersion=inst.loaderVersion;await saveInstances(list); }
    return packs.exportPack(instDir(id), inst, r.filePath, { worlds:!!opts.worlds, news:opts.news ? await community.feed() : null });
  },
  async importPack() {
    const r = await dialog.showOpenDialog(win, { title: 'Импорт сборки Fox Launcher', properties: ['openFile'], filters: [{ name: 'Fox Modpack', extensions: ['foxpack'] }] });
    if (r.canceled) return null;
    const info = packs.inspect(r.filePaths[0]);
    const confirm = await dialog.showMessageBox(win, { type:'warning', title:'Установка сборки', message:info.instance.name,
      detail:`Minecraft ${info.instance.mc} · ${info.instance.loader}\nРаспакованный размер: ${Math.ceil(info.total/1048576)} МБ.\nМоды — исполняемый код. Устанавливайте сборки только от людей, которым доверяете.`, buttons:['Отмена','Установить'], defaultId:0, cancelId:0 });
    if (confirm.response !== 1) return null;
    const inst = await api.createInstance(info.instance);
    try {
      await packs.extract(info, instDir(inst.id));
      if (info.hasNews) await community.import(JSON.parse(info.zip.readAsText('fox-news.json')));
      return inst;
    } catch(e) { await fsp.rm(instDir(inst.id), {recursive:true,force:true}); await saveInstances((await getInstances()).filter(i=>i.id!==inst.id)); throw e; }
  },

  // окно
  winMin: () => win.minimize(),
  winMax: () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  async winClose() {
    if(launching.size){const r=await dialog.showMessageBox(win,{type:'question',message:'Идёт подготовка игры. Скрыть лаунчер?',buttons:['Отмена','Скрыть'],defaultId:0,cancelId:0});if(r.response===1)win.hide();return;}
    if(running.size){const r=await dialog.showMessageBox(win,{type:'question',message:'Minecraft ещё работает',detail:'Лаунчер можно скрыть — учёт времени и консоль продолжат работать. Чтобы открыть его снова, запусти ярлык Fox Launcher.',buttons:['Отмена','Скрыть лаунчер'],defaultId:0,cancelId:0});if(r.response===1)win.hide();return;}
    win.close();
  },
  info: async () => ({ root: ROOT, totalMem: Math.floor(os.totalmem() / 1048576), version: app.getVersion(), platform: process.platform }),

  // настройки
  getSettings, saveSettings,

  // версии
  listVersions: () => versions.listVersions(ROOT),
  loaderVersions: (type, mc) => loaders.loaderVersions(type, mc),

  // сборки
  getInstances,
  async createInstance(data) {
    validateInstance(data);
    const list = await getInstances();
    const base = (data.name || data.mc).replace(/[^\wа-яА-ЯёЁ.\- ]/g, '').trim().slice(0,70).replace(/^[. ]+|[. ]+$/g,'') || 'instance';
    let id = base.replace(/\s+/g, '-').toLowerCase() + '-' + crypto.randomBytes(3).toString('hex'), n = 1;
    while (list.some(x => x.id === id)) id = `${base.replace(/\s+/g, '-').toLowerCase()}-${++n}`;
    const inst = { id, name: data.name || data.mc, mc: data.mc, type: data.type || 'release', loader: data.loader || 'vanilla',
      loaderVersion: data.loaderVersion || null, versionId: null, memory: data.memory || null, color: data.color || '#36a9ff',
      created: Date.now(), lastPlayed: null, playTime: 0 };
    list.push(inst);
    await saveInstances(list);
    await fsp.mkdir(instDir(id), { recursive: true });
    await saveSettings({ selectedInstance: id });
    return inst;
  },
  async updateInstance(id, patch) {
    idle(id);
    const list = await getInstances();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) throw new Error('Сборка не найдена');
    patch = Object.fromEntries(Object.entries(patch).filter(([k])=>['name','mc','type','loader','loaderVersion','memory','color'].includes(k)));
    validateInstance({...list[i],...patch});
    if (patch.mc || patch.loader || 'loaderVersion' in patch) patch.versionId = null;
    list[i] = { ...list[i], ...patch };
    await saveInstances(list);
    return list[i];
  },
  async deleteInstance(id, removeFiles) {
    idle(id);
    const list = (await getInstances()).filter(x => x.id !== id);
    if (removeFiles && await exists(instDir(id))) await shell.trashItem(instDir(id));
    await saveInstances(list);
    return list;
  },
  openInstanceFolder: async id => { await fsp.mkdir(instDir(id), { recursive: true }); shell.openPath(instDir(id)); },
  openRoot: () => shell.openPath(ROOT),

  // аккаунты
  async getAccounts() { return (await getAccounts()).map(publicAccount); },
  async addOffline(name) { return upsertAccount(auth.offline(name)); },
  async loginMicrosoft() {
    const code = await msLoginWindow();
    const acc = await auth.loginWithCode(code);
    return upsertAccount(acc);
  },
  async removeAccount(id) {
    safeId(id);
    const list = (await getAccounts()).filter(a => a.id !== id);
    await saveAccounts(list);
    await fsp.unlink(path.join(P.skins, id + '.png')).catch(() => {});
    return list.map(publicAccount);
  },

  // java
  findJavas: () => java.findJavas(ROOT),
  async downloadJava(major) { return java.downloadJava(ROOT, +major, p => send('progress', { ...p, scope: 'java' })); },
  async pickJava() {
    const r = await dialog.showOpenDialog(win, { title: 'Выберите java.exe / javaw.exe', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : [] });
    if (r.canceled) return null;
    return java.probe(r.filePaths[0]);
  },

  // новости
  news: async () => { const settings=await getSettings(); const [own,official]=await Promise.all([community.all((await services.newsUrl()) || settings.newsFeedUrl),newsApi.news()]); return [...own,...official]; },
  patchBody: p => newsApi.patchBody(p),
  openExternal: url => { if (/^https?:\/\//.test(url)) shell.openExternal(url); },

  // готовые сборки
  async mpInstall(projectId, versionId) {
    if (launching.size || installingMods.size) throw new Error('Дождитесь окончания другой установки');
    const lock = 'modpack:' + crypto.randomUUID();
    installingMods.add(lock);
    let inst;
    try {
      const info = await modpacks.prepare(ROOT, projectId, versionId);
      const r = await dialog.showMessageBox(win, { type: 'question', title: 'Установка сборки', message: info.instance.name,
        detail: `Minecraft ${info.instance.mc} · ${info.instance.loader}\nБудет создана отдельная сборка. Ваши миры не изменятся.\nМоды могут выполнять код — устанавливайте сборки только от авторов, которым доверяете.`,
        buttons: ['Отмена', 'Установить'], defaultId: 0, cancelId: 0 });
      if (r.response !== 1) return null;
      await java.ensureJava(ROOT, await versions.resolveVersion(ROOT, info.instance.mc), {
        customPath: (await getSettings()).javaPath, onProgress: p => send('progress', p),
      });
      const previous = (await getSettings()).selectedInstance;
      inst = await api.createInstance(info.instance);
      installingMods.add(inst.id);
      try {
        await modpacks.install(info, instDir(inst.id), p => send('progress', p));
      } catch (e) {
        await fsp.rm(instDir(inst.id), { recursive: true, force: true });
        await saveInstances((await getInstances()).filter(i => i.id !== inst.id));
        if ((await getSettings()).selectedInstance === inst.id) await saveSettings({ selectedInstance: previous });
        throw e;
      }
      send('progress', { text: 'Сборка установлена — можно играть', done: 1, total: 1 });
      return inst;
    } finally { installingMods.delete(lock); if (inst) installingMods.delete(inst.id); }
  },

  // моды
  mrSearch: q => modrinth.search(q),
  mrVersions: (id, o) => modrinth.versions(id, o),
  async mrInstall(instanceId, projectId, opts) {
    const inst = (await getInstances()).find(x => x.id === instanceId);
    if (!inst) throw new Error('Выберите сборку');
    idle(instanceId); installingMods.add(instanceId);
    try { return await modrinth.install(instDir(instanceId), projectId, { gameVersion: inst.mc, loader: inst.loader === 'vanilla' ? null : inst.loader, ...opts,
      onProgress: p => send('toast', p.text) });
    } finally { installingMods.delete(instanceId); }
  },
  async installedNames(instanceId, type) {
    const dir = path.join(instDir(instanceId), modrinth.FOLDERS[type] || 'mods');
    try { return await fsp.readdir(dir); } catch { return []; }
  },

  // файловый менеджер
  fmList: (id, rel) => files.list(instDir(id), rel),
  fmOpen: (id, rel) => shell.openPath(files.safe(instDir(id), rel)),
  fmReveal: (id, rel) => shell.showItemInFolder(files.safe(instDir(id), rel)),
  fmDelete: async (id, rels) => { for (const r of rels) await shell.trashItem(files.safe(instDir(id), r)); },
  fmRename: (id, rel, name) => files.rename(instDir(id), rel, name),
  fmMkdir: (id, rel, name) => files.mkdir(instDir(id), rel, name),
  fmToggle: (id, rel) => files.toggle(instDir(id), rel),
  fmRead: (id, rel) => files.readText(instDir(id), rel),
  fmWrite: (id, rel, text) => files.writeText(instDir(id), rel, text),
  fmImport: (id, rel, paths) => files.importFiles(instDir(id), rel, paths),
  async fmImportDialog(id, rel) {
    const r = await dialog.showOpenDialog(win, { title: 'Добавить файлы', properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return false;
    await files.importFiles(instDir(id), rel, r.filePaths);
    return true;
  },
  fmSize: (id) => files.dirSize(instDir(id)),

  // скины
  async getSkin(accountId) {
    safeId(accountId);
    const p = path.join(P.skins, accountId + '.png');
    if (await exists(p)) return (await fsp.readFile(p)).toString('base64');
    const acc = (await getAccounts()).find(a => a.id === accountId);
    if (acc && acc.skinUrl) {
      try { const r = await fetch(acc.skinUrl.replace('http://', 'https://')); return Buffer.from(await r.arrayBuffer()).toString('base64'); } catch {}
    }
    return null;
  },
  async saveSkin(accountId, b64, variant) {
    safeId(accountId);
    if(!await cloud.entitled(1)) throw new Error('Редактор скинов доступен с Fox Plus');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 1024*1024 || buf.length < 100 || buf.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Некорректный PNG-файл скина');
    const list = await getAccounts();
    const acc = list.find(a => a.id === accountId);
    if (!acc) throw new Error('Аккаунт не найден. Обнови список аккаунтов и выбери его заново.');
    const model = variant === 'slim' ? 'slim' : 'classic';
    // Проверяем, что PNG декодируется и имеет один из размеров Minecraft skin.
    if (buf.length < 24 || buf.subarray(12,16).toString('ascii') !== 'IHDR') throw new Error('PNG повреждён. Пересохрани скин как обычный PNG.');
    const dimensions = { width:buf.readUInt32BE(16), height:buf.readUInt32BE(20) };
    if (!((dimensions.width === 64 && dimensions.height === 64) || (dimensions.width === 64 && dimensions.height === 32))) throw new Error('Размер скина должен быть 64×64 или 64×32 пикселя.');
    let uploaded = false;
    if (acc.type === 'microsoft') {
      const fresh = await auth.refresh(acc);
      Object.assign(acc, fresh);
      // Minecraft account upload is authoritative; do not claim success if it fails.
      acc.skinUrl = await auth.uploadSkin(acc, buf, model);
      if (!acc.skinUrl) throw new Error('Minecraft не подтвердил применение скина. Повтори попытку позже.');
      uploaded = true;
    }
    await fsp.mkdir(P.skins, { recursive: true });
    await fsp.writeFile(path.join(P.skins, accountId + '.png'), buf);
    acc.hasSkin = true; acc.skinVariant = model;
    await saveAccounts(list);
    return { uploaded, variant:model, width:dimensions.width, height:dimensions.height };
  },
  async skinByName(name) { const s = await auth.skinByName(name); return { b64: s.png.toString('base64'), variant: s.variant }; },
  async openSkinFile() {
    const r = await dialog.showOpenDialog(win, { title: 'Выберите скин (PNG)', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled) return null;
    return (await fsp.readFile(r.filePaths[0])).toString('base64');
  },
  async exportSkin(b64) {
    if(!await cloud.entitled(1))throw new Error('Экспорт из редактора доступен с Fox Plus');
    const r = await dialog.showSaveDialog(win, { title: 'Сохранить скин', defaultPath: 'skin.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled) return false;
    await fsp.writeFile(r.filePath, Buffer.from(b64, 'base64'));
    return true;
  },

  // запуск
  isRunning: id => running.has(id),
  stop: id => { const r = running.get(id); if (r) r.kill(); },
  async launch(instanceId) {
    idle(instanceId);
    if (launching.size) throw new Error('Дождитесь окончания загрузки другой сборки');
    launching.add(instanceId);
    try {
    const settings = await getSettings();
    const list = await getInstances();
    const inst = list.find(x => x.id === instanceId);
    if (!inst) throw new Error('Выберите сборку');
    const accounts = await getAccounts();
    let acc = accounts.find(a => a.id === settings.selectedAccount) || accounts[0];
    if (!acc) throw new Error('Добавьте аккаунт, чтобы играть');
    const progress = p => send('progress', { ...p, scope: 'launch', instanceId });
    progress({ stage: 'java', text: 'Проверка Java перед подготовкой игры…' });
    await java.ensureJava(ROOT, await versions.resolveVersion(ROOT, inst.mc), {
      customPath: inst.javaPath || settings.javaPath, onProgress: progress,
    });

    if (acc.type === 'microsoft') {
      progress({ stage: 'auth', text: 'Обновление входа Microsoft…' });
      try { acc = await auth.refresh(acc); await saveAccounts(accounts.map(a => (a.id === acc.id ? acc : a))); }
      catch (e) { throw new Error('Не удалось обновить вход Microsoft. Войдите заново. (' + e.message + ')'); }
    }

    if (!inst.versionId) {
      progress({ stage: 'loader', text: inst.loader === 'vanilla' ? 'Подготовка…' : `Установка ${inst.loader}…` });
      if(inst.loader!=='vanilla' && !inst.loaderVersion){ const choices=await loaders.loaderVersions(inst.loader,inst.mc); if(!choices.length) throw new Error('Загрузчик не поддерживает версию Minecraft'); inst.loaderVersion=(choices.find(v=>v.stable)||choices[0]).version; }
      inst.versionId = await loaders.installLoader(ROOT, inst.loader, inst.mc, inst.loaderVersion, {onProgress:progress,onLog:text=>send('log',{instanceId,text}),javaPath:inst.javaPath||settings.javaPath});
      const latestList = await getInstances(); const current=latestList.find(i=>i.id===instanceId); if(current) { current.versionId=inst.versionId; current.loaderVersion=inst.loaderVersion; } await saveInstances(latestList);
    }
    const gameDir = instDir(inst.id);

    // офлайн-скин для мода CustomSkinLoader
    if (acc.type === 'offline' && await exists(path.join(P.skins, acc.id + '.png'))) {
      const d = path.join(gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins');
      await fsp.mkdir(d, { recursive: true });
      await fsp.copyFile(path.join(P.skins, acc.id + '.png'), path.join(d, acc.name + '.png')).catch(() => {});
    }

    let started = null;
    const log = makeLogParser(text => send('log', { instanceId, text }));
    const proc = await launch({
      root: ROOT, versionId: inst.versionId, gameDir, account: acc,
      memory: inst.memory || settings.memory, jvmArgs: settings.jvmArgs, width: settings.width, height: settings.height,
      javaPath: inst.javaPath || settings.javaPath || null,
      onProgress: progress,
      onLog: log,
      onExit: async code => {
        running.delete(instanceId);
        await playtime.tick(instanceId).catch(()=>{});
        const l = await getInstances();
        const it = l.find(x => x.id === instanceId);
        if (it) { it.playTime = (it.playTime || 0) + (started ? Date.now() - started : 0); await saveInstances(l); }
        send('exit', { instanceId, code });
        if (settings.closeOnLaunch && win) { win.show(); }
      },
    });
    running.set(instanceId, proc);
    started=Date.now();
    playtime.start(instanceId).catch(()=>{});
    const latestList=await getInstances(); const current=latestList.find(i=>i.id===instanceId); if(current) current.lastPlayed=Date.now(); await saveInstances(latestList);
    send('started', { instanceId, java: proc.java });
    if (settings.closeOnLaunch) win.hide();
    return { ok: true };
    } finally { launching.delete(instanceId); }
  },
};

// ---------- вход Microsoft ----------
function msLoginWindow() {
  return new Promise((resolve, reject) => {
    const ses = session.fromPartition('msauth');
    const w = new BrowserWindow({ width: 520, height: 700, parent: win, modal: true, title: 'Вход в Microsoft', autoHideMenuBar: true,
      icon: path.join(__dirname, 'assets', 'icon.png'), webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true } });
    let done = false;
    const check = url => {
      if (!url.startsWith(auth.REDIRECT)) return false;
      const u = new URL(url);
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      done = true;
      w.close();
      if (code) resolve(code);
      else reject(new Error(err === 'access_denied' ? 'Вход отменён' : 'Ошибка входа: ' + (u.searchParams.get('error_description') || err)));
      return true;
    };
    w.webContents.on('will-redirect', (e, url) => { if (check(url)) e.preventDefault(); });
    w.webContents.on('will-navigate', (e, url) => { if (check(url)) e.preventDefault(); });
    w.webContents.on('did-navigate', (e, url) => check(url));
    w.on('closed', () => { if (!done) reject(new Error('Окно входа закрыто')); });
    w.loadURL(auth.AUTH_URL);
  });
}

// ---------- окно ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 780, minWidth: 1000, minHeight: 640, frame: false, show: false,
    backgroundColor: '#0e0e10', title: 'Fox Launcher',
    icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Allow mic/camera only for the trusted local Fox renderer, never external pages.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    const mediaPermission = permission === 'media' || permission === 'microphone' || permission === 'camera';
    callback(contents === win?.webContents && mediaPermission);
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', e => { if (!forceQuit && tray) { e.preventDefault(); win.hide(); } });
  win.on('maximize', () => send('maximized', true));
  win.on('unmaximize', () => send('maximized', false));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

ipcMain.handle('api', async (e, method, ...args) => {
  if (e.sender !== win?.webContents || e.senderFrame !== win.webContents.mainFrame) throw new Error('Недопустимый источник');
  if (/^admin/.test(method) && (await services.get()).supabase.url) await cloud.isAdmin();
  if (!Object.prototype.hasOwnProperty.call(api, method) || typeof api[method] !== 'function') throw new Error('Неизвестный метод: ' + method);
  try { return { ok: true, data: await api[method](...args) }; }
  catch (err) { console.error(method, err); return { ok: false, error: err.message || String(err) }; }
});

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => { await fsp.mkdir(ROOT, { recursive: true }); createWindow();
    try { tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'))); tray.setToolTip('Fox Launcher'); tray.setContextMenu(Menu.buildFromTemplate([{label:'Открыть Fox Launcher',click:()=>{if(win){win.show();win.focus();}}},{type:'separator'},{label:'Выйти',click:()=>{forceQuit=true;app.quit();}}])); tray.on('double-click',()=>{if(win){win.show();win.focus();}}); } catch(e) { console.warn('Tray unavailable:',e.message); }
    
    updates.init().catch(e=>send('update',{state:'error',message:e.message}));
    if(process.platform==='win32'&&app.isPackaged){const st=await getSettings();if(!st.desktopShortcutCreated){try{await api.createDesktopShortcut();await saveSettings({desktopShortcutCreated:true});}catch{}}}
  });
  app.on('window-all-closed', () => { if (forceQuit || !tray) app.quit(); });
  app.on('before-quit', () => { forceQuit = true; if (tray) { tray.destroy(); tray = null; } });
}

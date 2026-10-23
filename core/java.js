'use strict';
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const { OS, fetchJson, download, exists } = require('./util');

const EXE = OS === 'windows' ? 'java.exe' : 'java';
const EXEW = OS === 'windows' ? 'javaw.exe' : 'java';

function requiredJava(version) {
  return (version.javaVersion && version.javaVersion.majorVersion) || 8;
}

function probe(javaPath) {
  return new Promise(res => {
    const probePath = /javaw\.exe$/i.test(javaPath) ? javaPath.replace(/javaw\.exe$/i, 'java.exe') : javaPath;
    execFile(probePath, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      const out = (stderr || '') + (stdout || '');
      const m = out.match(/version "([^"]+)"/);
      if (err || !m) return res(null);
      const v = m[1];
      const major = v.startsWith('1.') ? +v.split('.')[1] : parseInt(v, 10);
      res({ path: javaPath, version: v, major, is64: /64-Bit/i.test(out), vendor: (out.match(/^(.*)Runtime Environment/m) || [, ''])[1].trim() });
    });
  });
}

async function subdirs(dir) {
  try { return (await fsp.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => path.join(dir, d.name)); }
  catch { return []; }
}

/** Ищет все Java на компьютере + скачанные лаунчером */
async function findJavas(root) {
  const cands = new Set();
  const addHome = h => cands.add(path.join(h, 'bin', EXE));
  for (const d of await subdirs(path.join(root, 'runtime'))) {
    addHome(d);
    for (const s of await subdirs(d)) addHome(s);
  }
  if (process.env.JAVA_HOME) addHome(process.env.JAVA_HOME);
  for (const p of (process.env.PATH || '').split(path.delimiter)) if (p) cands.add(path.join(p, EXE));
  if (OS === 'windows') {
    const bases = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA'] && path.join(process.env['LOCALAPPDATA'], 'Programs')].filter(Boolean);
    const vendors = ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'AdoptOpenJDK', 'Zulu', 'Microsoft', 'BellSoft', 'Amazon Corretto', 'Semeru', 'Liberica'];
    for (const b of bases) for (const v of vendors) for (const d of await subdirs(path.join(b, v))) addHome(d);
    // Java от официального лаунчера
    const mc = path.join(process.env.APPDATA || '', '.minecraft', 'runtime');
    for (const comp of await subdirs(mc)) for (const plat of await subdirs(comp)) for (const d of await subdirs(plat)) addHome(d);
  } else {
    for (const b of ['/usr/lib/jvm', '/usr/java', '/opt/java', '/Library/Java/JavaVirtualMachines']) {
      for (const d of await subdirs(b)) { addHome(d); addHome(path.join(d, 'Contents', 'Home')); }
    }
  }
  const found = [];
  const seen = new Set();
  for (const c of cands) {
    if (!(await exists(c))) continue;
    let real = c;
    try { real = await fsp.realpath(c); } catch {}
    if (seen.has(real)) continue;
    seen.add(real);
    const info = await probe(c);
    if (info) { info.managed = c.startsWith(path.join(root, 'runtime')); found.push(info); }
  }
  return found.sort((a, b) => b.major - a.major);
}

function compatible(have, need) {
  if (have === need) return true;
  if (need === 16 && have === 17) return true;
  return false;
}

/** Переводит java.exe -> javaw.exe на Windows, чтобы не было консоли */
function toWindowless(p) {
  if (OS !== 'windows') return p;
  const w = path.join(path.dirname(p), EXEW);
  return fs.existsSync(w) ? w : p;
}

/** Скачивает Temurin JRE нужной версии */
async function downloadJava(root, major, onProgress = () => {}) {
  if (major === 16) major = 17;
  const os = OS === 'osx' ? 'mac' : OS;
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'ia32' ? 'x32' : 'x64';
  let assets = [];
  for (const type of ['jre', 'jdk']) {
    try {
      assets = await fetchJson(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=${os}&architecture=${arch}&image_type=${type}`);
      if (assets.length) break;
    } catch {}
  }
  if (!assets.length) throw new Error(`Не удалось найти Java ${major} для скачивания`);
  const pkg = assets[0].binary.package;
  const dir = path.join(root, 'runtime', `java-${major}`);
  const archive = path.join(root, 'cache', pkg.name);
  await download(pkg.link, archive, { size: pkg.size, onProgress: (g, t) => onProgress({ stage: 'java', text: `Скачивание Java ${major}: ${Math.round(g / 1048576)} / ${Math.round(t / 1048576)} МБ`, done: g, total: t }) });
  if(pkg.checksum) { const hash=crypto.createHash('sha256'); for await(const c of fs.createReadStream(archive)) hash.update(c); if(hash.digest('hex')!==pkg.checksum) throw new Error('Неверная контрольная сумма Java'); }
  onProgress({ stage: 'java', text: `Распаковка Java ${major}…`, done: 1, total: 1 });
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  if (pkg.name.endsWith('.zip')) new AdmZip(archive).extractAllTo(dir, true);
  else await new Promise((res, rej) => execFile('tar', ['-xzf', archive, '-C', dir], e => (e ? rej(e) : res())));
  await fsp.unlink(archive).catch(() => {});
  for (const d of [dir, ...(await subdirs(dir))]) {
    for (const c of [path.join(d, 'bin', EXE), path.join(d, 'Contents', 'Home', 'bin', EXE)]) {
      if (await exists(c)) {
        if (OS !== 'windows') await fsp.chmod(c, 0o755).catch(() => {});
        return await probe(c);
      }
    }
  }
  throw new Error('Java распакована, но java не найдена');
}

/** Проверка перед запуском: возвращает путь к подходящей java (скачивает при необходимости) */
async function ensureJava(root, version, { customPath, onProgress } = {}) {
  const need = requiredJava(version);
  if (customPath) {
    const info = await probe(customPath);
    if (info && compatible(info.major, need) && info.is64) {
      return { ...info, path: toWindowless(info.path), need };
    }
    onProgress && onProgress({ stage: 'java', text: `Выбранная Java не подходит. Автоматический подбор Java ${need}…`, done: 0, total: 1 });
  }
  onProgress && onProgress({ stage: 'java', text: `Проверка Java ${need}…`, done: 0, total: 1 });
  const all = await findJavas(root);
  const ok = all.filter(j => compatible(j.major, need) && j.is64 !== false).sort((a, b) => (b.managed ? 1 : 0) - (a.managed ? 1 : 0));
  if (ok.length) return { ...ok[0], path: toWindowless(ok[0].path), need };
  const info = await downloadJava(root, need, onProgress);
  if (!info || !compatible(info.major, need) || !info.is64) throw new Error(`Скачанная Java не прошла проверку. Требуется 64-битная Java ${need}.`);
  return { ...info, path: toWindowless(info.path), need, downloaded: true };
}

module.exports = { requiredJava, findJavas, downloadJava, ensureJava, probe };

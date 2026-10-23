'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const UA = 'FoxLauncher/1.0 (github.com/foxbro/fox-launcher)';
const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const ARCH = process.arch === 'ia32' ? 'x86' : process.arch;

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(20000), headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  if (!r.ok) {
    let body = '';
    try { body = await r.text(); } catch {}
    const err = new Error(`HTTP ${r.status}: ${url}`);
    err.status = r.status; err.body = body;
    throw err;
  }
  return r.json();
}

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

function sha1File(p) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}

/** Скачивает файл. Пропускает, если файл уже есть и совпадает размер (или sha1 при strict). */
async function download(url, dest, { sha1, size, strict = false, onProgress, retries = 3 } = {}) {
  try {
    const st = await fsp.stat(dest);
    if (strict && sha1) { if (await sha1File(dest) === sha1) return false; }
    else if (!size || st.size === size) return false;
  } catch {}
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let i = 0; i < retries; i++) {
    const tmp = dest + '.part';
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(300000), headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
      const total = +r.headers.get('content-length') || size || 0;
      let got = 0;
      const meter = new Transform({ transform(chunk, enc, cb) { got += chunk.length; if (onProgress) onProgress(got,total); cb(null,chunk); } });
      await pipeline(Readable.fromWeb(r.body), meter, fs.createWriteStream(tmp));
      if (size && got !== size) throw new Error('Неполная загрузка: ' + url);
      if (sha1 && (await sha1File(tmp)) !== sha1) throw new Error('Неверная контрольная сумма: ' + url);
      await fsp.rename(tmp, dest);
      return true;
    } catch (e) {
      lastErr = e;
      try { await fsp.unlink(tmp); } catch {}
      await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

async function pool(items, limit, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

function rulesAllow(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allow = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== OS) match = false;
      if (r.os.arch && r.os.arch !== ARCH) match = false;
      if (r.os.version) { try { if (!new RegExp(r.os.version).test(os.release())) match = false; } catch {} }
    }
    if (r.features) for (const k in r.features) if (!!features[k] !== r.features[k]) match = false;
    if (match) allow = r.action === 'allow';
  }
  return allow;
}

/** group:artifact:version[:classifier][@ext] -> путь maven */
function mavenPath(name) {
  let ext = 'jar';
  if (name.includes('@')) { [name, ext] = name.split('@'); }
  const [group, artifact, version, classifier] = name.split(':');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

async function readJson(p, def) { try { return JSON.parse(await fsp.readFile(p, 'utf8')); } catch { return def; } }
async function writeJson(p, data) { await fsp.mkdir(path.dirname(p), { recursive: true }); const tmp=p+'.'+crypto.randomBytes(6).toString('hex')+'.tmp'; await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode:0o600 }); await fsp.rename(tmp,p); }

function offlineUUID(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
  return h.toString('hex');
}

module.exports = { UA, OS, ARCH, fetchJson, exists, sha1File, download, pool, rulesAllow, mavenPath, readJson, writeJson, offlineUUID };

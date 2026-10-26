'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const RELEASE_TAG = 'fox-official-mods';
const MAX_BYTES = 100 * 1024 * 1024;
const safeName = name => {
  const base = path.basename(String(name || '')).replace(/[^A-Za-z0-9._+() -]/g, '_').trim();
  if (!base || !base.toLowerCase().endsWith('.jar') || base.length > 180) throw new Error('Выбери JAR-файл с безопасным именем');
  return base;
};

class OfficialMods {
  constructor(services) { this.services = services; }

  async config() {
    const c = await this.services.get();
    if (!c.github.owner || !c.github.repo) throw new Error('Сначала настрой GitHub в подключениях владельца');
    return c.github;
  }

  async request(url, options = {}, token = '') {
    const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'FoxLauncher-OfficialMods', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(45000) });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error('GitHub API (' + response.status + '): ' + (body.slice(0, 220) || response.statusText));
    }
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    return type.includes('json') ? response.json() : response.arrayBuffer();
  }

  async release(create = false, requireToken = false) {
    const g = await this.config();
    const base = 'https://api.github.com/repos/' + encodeURIComponent(g.owner) + '/' + encodeURIComponent(g.repo);
    const token = (create || requireToken) ? await this.services.token() : '';
    let r = await fetch(base + '/releases/tags/' + RELEASE_TAG, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FoxLauncher-OfficialMods' }, signal: AbortSignal.timeout(20000) });
    if (r.status === 404 && create) {
      const made = await this.request(base + '/releases', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ tag_name: RELEASE_TAG, name: 'Fox Launcher — официальные моды', body: 'Официальные моды Fox Launcher. Файлы доступны из раздела «Моды» лаунчера.', draft: false, prerelease: false }) }, token);
      return { release: made, base, token };
    }
    if (r.status === 404) return { release: null, base, token };
    if (!r.ok) throw new Error('Не удалось получить список официальных модов: GitHub (' + r.status + ')');
    return { release: await r.json(), base, token };
  }

  async list() {
    const { release } = await this.release(false);
    if (!release) return { configured: true, items: [], checkedAt: new Date().toISOString() };
    const items = (release.assets || []).filter(a => a.name.toLowerCase().endsWith('.jar')).map(a => ({
      id: a.id, name: a.name, label: a.label || '', size: a.size, downloads: a.download_count,
      downloadUrl: a.browser_download_url, updatedAt: a.updated_at, digest: a.digest || null
    }));
    return { configured: true, items, checkedAt: new Date().toISOString() };
  }

  async upload(filePath, metadata = {}) {
    const name = safeName(path.basename(filePath));
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw new Error('JAR должен быть размером от 1 байта до 100 МБ');
    const title = String(metadata.title || name.replace(/\.jar$/i, '')).trim().slice(0, 70);
    const mc = String(metadata.minecraft || '').trim().slice(0, 24);
    const loader = String(metadata.loader || 'Любой').trim().slice(0, 24);
    const description = String(metadata.description || '').trim().replace(/[\r\n|]/g, ' ').slice(0, 90);
    if (!title) throw new Error('Укажи название мода');
    const label = [title, mc ? 'MC ' + mc : '', loader, description].filter(Boolean).join(' · ').slice(0, 120);
    const { release, base, token } = await this.release(true);
    const existing = (release.assets || []).find(a => a.name === name);
    if (existing) await this.request(base + '/releases/assets/' + existing.id, { method: 'DELETE' }, token);
    const bytes = await fs.readFile(filePath);
    const uploadUrl = 'https://uploads.github.com/repos/' + encodeURIComponent((await this.config()).owner) + '/' + encodeURIComponent((await this.config()).repo) + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(name) + '&label=' + encodeURIComponent(label);
    await this.request(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/java-archive' }, body: bytes }, token);
    return { name, label, size: bytes.length };
  }

  async remove(assetId) {
    if (!Number.isSafeInteger(Number(assetId)) || Number(assetId) <= 0) throw new Error('Некорректный идентификатор файла');
    const { release, base, token } = await this.release(false, true);
    if (!release) throw new Error('Релиз официальных модов не найден');
    const asset = (release.assets || []).find(a => a.id === Number(assetId) && a.name.toLowerCase().endsWith('.jar'));
    if (!asset) throw new Error('Файл не найден в списке официальных модов');
    await this.request(base + '/releases/assets/' + asset.id, { method: 'DELETE' }, token);
    return true;
  }

  async install(gameDir, assetId) {
    if (!Number.isSafeInteger(Number(assetId)) || Number(assetId) <= 0) throw new Error('Некорректный идентификатор файла');
    const { release } = await this.release(false);
    const asset = (release?.assets || []).find(a => a.id === Number(assetId) && a.name.toLowerCase().endsWith('.jar'));
    if (!asset) throw new Error('Официальный мод больше не опубликован. Обнови список.');
    if (asset.size > MAX_BYTES) throw new Error('Файл превышает лимит 100 МБ');
    const response = await fetch(asset.browser_download_url, { redirect: 'follow', headers: { 'User-Agent': 'FoxLauncher-OfficialMods' }, signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('Не удалось скачать мод (HTTP ' + response.status + ')');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Некорректный размер скачанного файла');
    if (asset.digest && asset.digest.startsWith('sha256:')) {
      const crypto = require('node:crypto');
      const actual = crypto.createHash('sha256').update(bytes).digest('hex');
      if (actual !== asset.digest.slice(7)) throw new Error('Проверка SHA-256 не пройдена: файл не установлен');
    }
    const filename = safeName(asset.name);
    const dir = path.join(gameDir, 'mods');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), bytes, { flag: 'w' });
    return { name: filename, size: bytes.length };
  }
}

module.exports = { OfficialMods, RELEASE_TAG, MAX_BYTES };

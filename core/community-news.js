'use strict';
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./util');
function cleanPost(p) {
  if (!p || typeof p.title !== 'string' || !p.title.trim()) throw new Error('У новости должен быть заголовок');
  const text = String(p.text || '').slice(0, 50000);
  return { id: typeof p.id === 'string' ? p.id.slice(0,100) : crypto.randomUUID(), kind: 'community',
    title: p.title.trim().slice(0,160), text, body: text, date: Number.isFinite(Date.parse(p.date)) ? new Date(p.date).toISOString() : new Date().toISOString(),
    image: typeof p.image === 'string' && /^https:\/\//i.test(p.image) ? p.image.slice(0,2000) : null, draft: !!p.draft, pinned: !!p.pinned };
}
function parseFeed(data) {
  const list = Array.isArray(data) ? data : data?.posts;
  if (!Array.isArray(list) || list.length > 200) throw new Error('Неверная лента новостей: нужен объект с массивом posts (до 200 новостей)');
  return list.map(cleanPost);
}
class CommunityNews {
  constructor(root, sharedDir) { this.root = root; this.sharedDir = sharedDir; this.local = path.join(root, 'community-news.json'); }
  localPosts() { return readJson(this.local, []); }
  async save(post) {
    const list = await this.localPosts(), p = cleanPost(post), i = list.findIndex(x => x.id === p.id);
    if (i < 0 && list.length >= 200) throw new Error('Лимит: 200 новостей');
    if (i < 0) list.unshift(p); else list[i] = p;
    await writeJson(this.local, list); return p;
  }
  async remove(id) { await writeJson(this.local, (await this.localPosts()).filter(x => x.id !== id));
    const file=path.join(this.root,'deleted-news.json'),ids=await readJson(file,[]);await writeJson(file,[...new Set([...ids,String(id)])]);
  }
  async feed() { return { format: 'fox-news', version: 1, deleted: await readJson(path.join(this.root,'deleted-news.json'),[]), posts: (await this.localPosts()).filter(p=>!p.draft) }; }
  async import(data) { const list = parseFeed(data); await writeJson(path.join(this.root, 'imported-news.json'), list); return list.length; }
  async all(url) {
    const feeds = [],deleted=new Set(await readJson(path.join(this.root,'deleted-news.json'),[]));
    const bundled = await readJson(path.join(this.sharedDir, 'fox-news.json'), await readJson(path.join(__dirname,'..','fox-news.json'),null));
    if (bundled) { try { feeds.push(...parseFeed(bundled)); } catch {} }
    feeds.push(...await readJson(path.join(this.root, 'imported-news.json'), []));
    if (url && /^https:\/\//i.test(url)) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'FoxLauncher/1.0' } });
        if (!r.ok) throw new Error('HTTP '+r.status);
        const chunks=[]; let size=0;
        for await (const chunk of r.body) { size+=chunk.length; if(size>4*1024*1024) throw new Error('Лента слишком большая'); chunks.push(chunk); }
        const data=JSON.parse(Buffer.concat(chunks).toString('utf8')),posts = parseFeed(data);if(Array.isArray(data.deleted))for(const id of data.deleted)deleted.add(String(id));
        await writeJson(path.join(this.root, 'cache', 'community-feed.json'), { url, posts, deleted:[...deleted] }); feeds.push(...posts);
      } catch { const cached = await readJson(path.join(this.root, 'cache', 'community-feed.json'), null); if (cached?.url === url) {feeds.push(...cached.posts);for(const id of cached.deleted||[])deleted.add(id);} }
    }
    feeds.push(...await this.localPosts());
    return [...new Map(feeds.filter(p=>p.id!=='fox-welcome'&&!p.draft&&!deleted.has(p.id)).map(p => [p.id, p])).values()].sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Date.parse(b.date)-Date.parse(a.date));
  }
}
module.exports = { CommunityNews, cleanPost, parseFeed };

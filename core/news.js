'use strict';
const { fetchJson } = require('./util');
const BASE = 'https://launchercontent.mojang.com';

async function news() {
  const out = [];
  const [patchData,newsData]=await Promise.all([fetchJson(BASE+'/v2/javaPatchNotes.json').catch(()=>null),fetchJson(BASE+'/news.json').catch(()=>null)]);
  try {
    const p = patchData;
    for (const e of p.entries.slice(0, 40)) out.push({
      id: 'pn-' + e.id, kind: 'patch', title: e.title, version: e.version, type: e.type, date: e.date,
      image: e.image ? BASE + e.image.url : null, text: e.shortText, contentPath: e.contentPath,
    });
  } catch {}
  try {
    const n = newsData;
    for (const e of n.entries.filter(x => /java/i.test(x.category) || !x.category).slice(0, 30)) out.push({
      id: 'n-' + e.id, kind: 'news', title: e.title, date: e.date, text: e.text, tag: e.tag,
      image: e.newsPageImage ? BASE + e.newsPageImage.url : e.playPageImage ? BASE + e.playPageImage.url : null,
      link: e.readMoreLink,
    });
  } catch {}
  return out.sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function patchBody(contentPath) {
  const j = await fetchJson(BASE + '/v2/' + contentPath);
  return j.body || '';
}

module.exports = { news, patchBody };

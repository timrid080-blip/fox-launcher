'use strict';
const { fetchJson, offlineUUID, UA } = require('./util');

// Публичный client id официального лаунчера Minecraft — не требует своей регистрации в Azure
const CLIENT_ID = '00000000402b5328';
const REDIRECT = 'https://login.live.com/oauth20_desktop.srf';
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';

const AUTH_URL = `https://login.live.com/oauth20_authorize.srf?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(SCOPE)}&prompt=select_account`;

async function msToken(params) {
  const body = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: SCOPE, ...params });
  return fetchJson('https://login.live.com/oauth20_token.srf', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
}

const XERR = {
  2148916233: 'У этого аккаунта Microsoft нет профиля Xbox. Зайдите на xbox.com и создайте его.',
  2148916235: 'Xbox Live недоступен в вашей стране.',
  2148916236: 'Нужна верификация возраста на xbox.com.',
  2148916237: 'Нужна верификация возраста на xbox.com.',
  2148916238: 'Детский аккаунт: его нужно добавить в семью на account.microsoft.com.',
};

async function xboxChain(msAccessToken) {
  const json = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(b) });
  const xbl = await fetchJson('https://user.auth.xboxlive.com/user/authenticate', json({
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  }));
  let xsts;
  try {
    xsts = await fetchJson('https://xsts.auth.xboxlive.com/xsts/authorize', json({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    }));
  } catch (e) {
    let code; try { code = JSON.parse(e.body).XErr; } catch {}
    throw new Error(XERR[code] || 'Ошибка Xbox Live: ' + e.message);
  }
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  const mc = await fetchJson('https://api.minecraftservices.com/authentication/login_with_xbox', json({ identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }));
  let profile;
  try {
    profile = await fetchJson('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + mc.access_token } });
  } catch (e) {
    if (e.status === 404) throw new Error('На этом аккаунте нет лицензии Minecraft Java Edition. Используйте офлайн-аккаунт.');
    throw e;
  }
  return { accessToken: mc.access_token, expires: Date.now() + (mc.expires_in - 60) * 1000, profile };
}

function toAccount(ms, mc) {
  const skin = (mc.profile.skins || []).find(s => s.state === 'ACTIVE');
  return {
    type: 'microsoft', id: mc.profile.id, uuid: mc.profile.id, name: mc.profile.name,
    accessToken: mc.accessToken, expires: mc.expires, refreshToken: ms.refresh_token,
    skinUrl: skin ? skin.url : null, skinVariant: skin ? skin.variant.toLowerCase() : 'classic',
  };
}

async function loginWithCode(code) {
  const ms = await msToken({ grant_type: 'authorization_code', code });
  return toAccount(ms, await xboxChain(ms.access_token));
}

async function refresh(account) {
  if (account.type !== 'microsoft') return account;
  if (account.expires && account.expires > Date.now() + 60000) return account;
  const ms = await msToken({ grant_type: 'refresh_token', refresh_token: account.refreshToken });
  return { ...account, ...toAccount(ms, await xboxChain(ms.access_token)) };
}

function offline(name) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
  const uuid = offlineUUID(name);
  return { type: 'offline', id: 'off-' + uuid, uuid, name, accessToken: '0' };
}

async function uploadSkin(account, pngBuffer, variant = 'classic') {
  const form = new FormData();
  form.append('variant', variant);
  form.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'skin.png');
  const r = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST', headers: { Authorization: 'Bearer ' + account.accessToken, 'User-Agent': UA }, body: form,
  });
  if (!r.ok) throw new Error('Не удалось загрузить скин: HTTP ' + r.status);
  const p = await r.json();
  const s = (p.skins || []).find(x => x.state === 'ACTIVE');
  return s ? s.url : null;
}

/** Скин любого игрока по нику (лицензия) */
async function skinByName(name) {
  const p = await fetchJson('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name)).catch(() => null);
  if (!p) throw new Error('Игрок не найден');
  const s = await fetchJson('https://sessionserver.mojang.com/session/minecraft/profile/' + p.id);
  const tex = JSON.parse(Buffer.from(s.properties.find(x => x.name === 'textures').value, 'base64').toString());
  const skin = tex.textures.SKIN;
  if (!skin) throw new Error('У игрока стандартный скин');
  const r = await fetch(skin.url.replace('http://', 'https://'));
  return { png: Buffer.from(await r.arrayBuffer()), variant: skin.metadata && skin.metadata.model === 'slim' ? 'slim' : 'classic' };
}

module.exports = { AUTH_URL, REDIRECT, loginWithCode, refresh, offline, uploadSkin, skinByName };

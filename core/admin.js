'use strict';
const crypto = require('crypto');
const path = require('path');
const { readJson, writeJson } = require('./util');
const defaults = require('./admin-default.json');
const derive = (password, salt) => new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (e, k) => e ? reject(e) : resolve(k)));
class Admin {
  constructor(root) { this.file = path.join(root, 'admin.json'); this.token = null; this.until = 0; this.failures = 0; this.lockedUntil = 0; }
  async config() { let c = await readJson(this.file, null); if (!c) { c = { ...defaults, mustChange: true }; await writeJson(this.file, c); } return c; }
  async login(password) {
    if (Date.now() < this.lockedUntil) throw new Error('Слишком много попыток. Подождите 30 секунд.');
    if (typeof password !== 'string' || password.length > 256) throw new Error('Некорректный пароль');
    const c = await this.config(), key = await derive(password, c.salt), hash = Buffer.from(c.hash, 'hex');
    if (hash.length !== key.length || !crypto.timingSafeEqual(hash, key)) {
      if (++this.failures >= 5) { this.lockedUntil = Date.now() + 30000; this.failures = 0; }
      throw new Error('Неверный пароль');
    }
    this.failures = 0; this.token = crypto.randomBytes(32).toString('hex'); this.until = Date.now() + 15 * 60000;
    return { token: this.token, mustChange: c.mustChange, expires: this.until };
  }
  require(token) { if (!this.token || token !== this.token || Date.now() > this.until) { this.logout(); throw new Error('Войдите в админ-панель заново: сессия истекла.'); } }
  logout() { this.token = null; this.until = 0; }
  async change(token, current, password) {
    this.require(token);
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Новый пароль: от 12 до 128 символов');
    const c = await this.config(), key = await derive(String(current), c.salt);
    if (!crypto.timingSafeEqual(Buffer.from(c.hash, 'hex'), key)) throw new Error('Текущий пароль неверный');
    const salt = crypto.randomBytes(24).toString('hex');
    await writeJson(this.file, { salt, hash: (await derive(password, salt)).toString('hex'), mustChange: false }); this.logout();
  }
}
module.exports = { Admin };

'use strict';
/* Fox Launcher — редактор скинов: UV-канвас 64×64 + 3D-модель на CSS (по ней тоже можно рисовать) */
(function () {
  const S3 = 9; // пикселей экрана на пиксель скина в 3D

  function boxes(slim) {
    const aw = slim ? 3 : 4;
    // name, layer, uv(x0,y0), size(w,h,d), pos (fx,fy,fz — левый верхний передний угол в координатах фигуры), inflate
    return [
      ['head', 0, 0, 0, 8, 8, 8, 4, 0, -4, 0], ['hat', 1, 32, 0, 8, 8, 8, 4, 0, -4, .5],
      ['body', 0, 16, 16, 8, 12, 4, 4, 8, -2, 0], ['jacket', 1, 16, 32, 8, 12, 4, 4, 8, -2, .25],
      ['rarm', 0, 40, 16, aw, 12, 4, 4 - aw, 8, -2, 0], ['rsleeve', 1, 40, 32, aw, 12, 4, 4 - aw, 8, -2, .25],
      ['larm', 0, 32, 48, aw, 12, 4, 12, 8, -2, 0], ['lsleeve', 1, 48, 48, aw, 12, 4, 12, 8, -2, .25],
      ['rleg', 0, 0, 16, 4, 12, 4, 4, 20, -2, 0], ['rpants', 1, 0, 32, 4, 12, 4, 4, 20, -2, .25],
      ['lleg', 0, 16, 48, 4, 12, 4, 8, 20, -2, 0], ['lpants', 1, 0, 48, 4, 12, 4, 8, 20, -2, .25],
    ].map(b => ({ name: b[0], layer: b[1], u: b[2], v: b[3], w: b[4], h: b[5], d: b[6], fx: b[7], fy: b[8], fz: b[9], inf: b[10] }));
  }
  function faces(b) {
    const { u, v, w, h, d } = b;
    return {
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
    };
  }
  function usedMask(slim) {
    const m = new Uint8Array(64 * 64);
    for (const b of boxes(slim)) for (const f of Object.values(faces(b))) {
      for (let y = f[1]; y < f[1] + f[3]; y++) for (let x = f[0]; x < f[0] + f[2]; x++) m[y * 64 + x] = 1;
    }
    return m;
  }
  function faceAt(slim, x, y) {
    for (const b of boxes(slim)) for (const f of Object.values(faces(b))) {
      if (x >= f[0] && x < f[0] + f[2] && y >= f[1] && y < f[1] + f[3]) return f;
    }
    return [0, 0, 64, 64];
  }

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть изображение')); i.src = src; });
  }
  /** Нормализует любой скин в canvas 64×64 (конвертирует старые 64×32) */
  async function toCanvas64(b64) {
    const img = await loadImage('data:image/png;base64,' + b64);
    if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) throw new Error('Скин должен быть 64×64 или 64×32 пикселя');
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    if (img.height === 32) {
      const flip = (sx, sy, w, h, dx, dy) => { x.save(); x.translate(dx + w, dy); x.scale(-1, 1); x.drawImage(c, sx, sy, w, h, 0, 0, w, h); x.restore(); };
      // нога и рука копируются зеркально на левую сторону
      for (const [ox, oy] of [[0, 0], [24, 0]]) {
        const sx = ox === 0 ? 0 : 40, dx = ox === 0 ? 16 : 32;
        flip(sx + 4, 16, 4, 4, dx + 4, 48); flip(sx + 8, 16, 4, 4, dx + 8, 48);
        flip(sx + 0, 20, 4, 12, dx + 8, 52); flip(sx + 4, 20, 4, 12, dx + 4, 52);
        flip(sx + 8, 20, 4, 12, dx + 0, 52); flip(sx + 12, 20, 4, 12, dx + 12, 52);
      }
    }
    return c;
  }
  function headDataUrl(canvas, size = 64) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    x.drawImage(canvas, 8, 8, 8, 8, 0, 0, size, size);
    x.drawImage(canvas, 40, 8, 8, 8, 0, 0, size, size);
    return c.toDataURL();
  }
  function defaultSkin() {
    // простой «лисий» скин по умолчанию
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const fillFaces = (b, col) => { for (const f of Object.values(faces(b))) { x.fillStyle = col; x.fillRect(f[0], f[1], f[2], f[3]); } };
    for (const b of boxes(false)) if (b.layer === 0) fillFaces(b, { head: '#f08a2c', body: '#2b2b33', rarm: '#f08a2c', larm: '#f08a2c', rleg: '#1f1f26', lleg: '#1f1f26' }[b.name]);
    x.fillStyle = '#fff3e6'; x.fillRect(10, 12, 4, 4);
    x.fillStyle = '#ffffff'; x.fillRect(9, 11, 2, 1); x.fillRect(13, 11, 2, 1);
    x.fillStyle = '#1a1a1a'; x.fillRect(10, 11, 1, 1); x.fillRect(13, 11, 1, 1); x.fillRect(11, 13, 2, 1);
    x.fillStyle = '#ff7a1a'; x.fillRect(20, 20, 8, 2);
    return c;
  }

  class Editor {
    constructor(root, { onChange } = {}) {
      this.root = root; this.onChange = onChange || (() => {});
      this.slim = false; this.tool = 'pencil'; this.color = '#ff7a1a'; this.layer = 0;
      this.showOverlay = true; this.showGrid = true; this.zoom = 8; this.mirror = false;
      this.rx = -12; this.ry = 30; this.undo = []; this.redo = [];
      this.tex = document.createElement('canvas'); this.tex.width = this.tex.height = 64;
      this.tx = this.tex.getContext('2d', { willReadFrequently: true });
      this.build();
      this.setCanvas(defaultSkin(), false);
    }
    build() {
      this.root.innerHTML = `
        <div class="canvas-box"><div class="checker"><canvas class="pix" width="512" height="512"></canvas></div>
          <div class="row dim" style="font-size:12px;gap:16px"><span data-k="coord">—</span><span>ЛКМ — рисовать · ПКМ — пипетка · Колёсико — масштаб</span></div></div>
        <div class="col">
          <div class="canvas-box" style="padding:0;overflow:hidden">
            <div class="stage3d" style="width:100%;height:380px;perspective:900px;display:grid;place-items:center;cursor:grab;position:relative;background:radial-gradient(circle at 50% 40%,#2a1c10,#141417 70%)">
              <div class="model" style="position:relative;width:0;height:0;transform-style:preserve-3d"></div>
              <div class="dim" style="position:absolute;bottom:8px;font-size:11px">Тяни фон — вращать · рисуй прямо по модели</div>
            </div>
          </div>
        </div>`;
      this.uv = this.root.querySelector('canvas.pix');
      this.ux = this.uv.getContext('2d');
      this.stage = this.root.querySelector('.stage3d');
      this.model = this.root.querySelector('.model');
      this.coord = this.root.querySelector('[data-k=coord]');
      this.bindUV(); this.bind3D();
    }
    // --------- данные ----------
    setCanvas(c, pushUndo = true) {
      if (pushUndo) this.snapshot();
      this.tx.clearRect(0, 0, 64, 64); this.tx.drawImage(c, 0, 0);
      this.build3D(); this.render();
    }
    async loadBase64(b64, variant) {
      const c = await toCanvas64(b64);
      if (variant) this.slim = variant === 'slim';
      this.setCanvas(c);
    }
    toBase64() { return this.tex.toDataURL('image/png').split(',')[1]; }
    snapshot() { this.undo.push(this.tx.getImageData(0, 0, 64, 64)); if (this.undo.length > 80) this.undo.shift(); this.redo = []; }
    doUndo() { if (!this.undo.length) return; this.redo.push(this.tx.getImageData(0, 0, 64, 64)); this.tx.putImageData(this.undo.pop(), 0, 0); this.render(); }
    doRedo() { if (!this.redo.length) return; this.undo.push(this.tx.getImageData(0, 0, 64, 64)); this.tx.putImageData(this.redo.pop(), 0, 0); this.render(); }
    setSlim(v) { this.slim = v; this.build3D(); this.render(); }
    clearLayer() {
      this.snapshot();
      for (const b of boxes(this.slim)) if (b.layer === 1) for (const f of Object.values(faces(b))) this.tx.clearRect(f[0], f[1], f[2], f[3]);
      this.render();
    }
    // --------- рисование ----------
    hexToRgba(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; }
    getPx(x, y) { return Array.from(this.tx.getImageData(x, y, 1, 1).data); }
    setPx(x, y, rgba) {
      if (x < 0 || y < 0 || x > 63 || y > 63) return;
      const id = this.tx.createImageData(1, 1); id.data.set(rgba); this.tx.putImageData(id, x, y);
    }
    mirrorOf(x, y) {
      // зеркалит пиксель между левой и правой половиной той же грани/конечности
      for (const b of boxes(this.slim)) {
        const fs = faces(b);
        for (const [k, f] of Object.entries(fs)) {
          if (x >= f[0] && x < f[0] + f[2] && y >= f[1] && y < f[1] + f[3]) {
            if (['head', 'hat', 'body', 'jacket'].includes(b.name)) {
              if (k === 'left' || k === 'right') { const o = fs[k === 'left' ? 'right' : 'left']; return [o[0] + (f[0] + f[2] - 1 - x), y]; }
              return [f[0] + (f[0] + f[2] - 1 - x), y];
            }
            const pair = { rarm: 'larm', larm: 'rarm', rsleeve: 'lsleeve', lsleeve: 'rsleeve', rleg: 'lleg', lleg: 'rleg', rpants: 'lpants', lpants: 'rpants' }[b.name];
            const ob = boxes(this.slim).find(q => q.name === pair);
            const ofs = faces(ob);
            const ok = k === 'left' ? 'right' : k === 'right' ? 'left' : k;
            const o = ofs[ok];
            return [o[0] + Math.min(o[2] - 1, (f[0] + f[2] - 1 - x)), y - f[1] + o[1]];
          }
        }
      }
      return null;
    }
    apply(x, y, first) {
      if (this.tool === 'picker') {
        const p = this.getPx(x, y);
        if (p[3] > 0) { this.color = '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join(''); this.onChange('color', this.color); }
        return;
      }
      if (first) this.snapshot();
      if (this.tool === 'fill') { this.fill(x, y); this.render(); return; }
      const rgba = this.tool === 'eraser' ? [0, 0, 0, 0] : this.hexToRgba(this.color);
      this.setPx(x, y, rgba);
      if (this.mirror) { const m = this.mirrorOf(x, y); if (m) this.setPx(m[0], m[1], rgba); }
      this.render();
    }
    fill(x, y) {
      const f = faceAt(this.slim, x, y);
      const img = this.tx.getImageData(0, 0, 64, 64), d = img.data;
      const idx = (a, b) => (b * 64 + a) * 4;
      const t = d.slice(idx(x, y), idx(x, y) + 4);
      const rgba = this.hexToRgba(this.color);
      if (t.every((v, i) => v === rgba[i])) return;
      const st = [[x, y]];
      while (st.length) {
        const [a, b] = st.pop();
        if (a < f[0] || b < f[1] || a >= f[0] + f[2] || b >= f[1] + f[3]) continue;
        const i = idx(a, b);
        if (d[i] !== t[0] || d[i + 1] !== t[1] || d[i + 2] !== t[2] || d[i + 3] !== t[3]) continue;
        d.set(rgba, i);
        st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
      }
      this.tx.putImageData(img, 0, 0);
    }
    line(x0, y0, x1, y1) {
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.apply(x0, y0, false);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    // --------- UV-канвас ----------
    bindUV() {
      const pos = e => { const r = this.uv.getBoundingClientRect(); return [Math.max(0, Math.min(63, Math.floor((e.clientX - r.left) / r.width * 64))), Math.max(0, Math.min(63, Math.floor((e.clientY - r.top) / r.height * 64)))]; };
      let down = false, last = null, prevTool = null;
      this.uv.addEventListener('contextmenu', e => e.preventDefault());
      this.uv.addEventListener('pointerdown', e => {
        this.uv.setPointerCapture(e.pointerId);
        const [x, y] = pos(e);
        if (e.button === 2) { prevTool = this.tool; this.tool = 'picker'; this.apply(x, y, true); this.tool = prevTool; return; }
        down = true; last = [x, y]; this.apply(x, y, true);
      });
      this.uv.addEventListener('pointermove', e => {
        const [x, y] = pos(e);
        this.hover = [x, y];
        const p = x >= 0 && y >= 0 && x < 64 && y < 64 ? this.getPx(x, y) : null;
        this.coord.textContent = p ? `x ${x}, y ${y}` + (p[3] ? ` · #${p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')}` : ' · прозрачный') : '—';
        if (down && (this.tool === 'pencil' || this.tool === 'eraser')) { this.line(last[0], last[1], x, y); last = [x, y]; }
        else this.render(true);
      });
      const up = () => { if (down) { down = false; this.onChange('edit'); } };
      this.uv.addEventListener('pointerup', up);
      this.uv.addEventListener('pointerleave', () => { this.hover = null; this.render(true); });
      this.uv.addEventListener('wheel', e => {
        e.preventDefault();
        this.zoom = Math.max(4, Math.min(14, this.zoom + (e.deltaY < 0 ? 1 : -1)));
        this.uv.style.width = this.uv.style.height = 64 * this.zoom + 'px';
      }, { passive: false });
      this.uv.style.width = this.uv.style.height = 64 * this.zoom + 'px';
    }
    renderUV() {
      const c = this.ux, Z = 8;
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, 512, 512);
      const mask = usedMask(this.slim);
      c.fillStyle = 'rgba(10,10,12,.82)';
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (!mask[y * 64 + x]) c.fillRect(x * Z, y * Z, Z, Z);
      c.drawImage(this.tex, 0, 0, 512, 512);
      if (this.showGrid) {
        c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; c.beginPath();
        for (let i = 0; i <= 64; i++) { c.moveTo(i * Z + .5, 0); c.lineTo(i * Z + .5, 512); c.moveTo(0, i * Z + .5); c.lineTo(512, i * Z + .5); }
        c.stroke();
        c.strokeStyle = 'rgba(255,122,26,.28)'; c.beginPath();
        for (const b of boxes(this.slim)) for (const f of Object.values(faces(b))) c.rect(f[0] * Z + .5, f[1] * Z + .5, f[2] * Z, f[3] * Z);
        c.stroke();
      }
      if (this.hover) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(this.hover[0] * Z + 1, this.hover[1] * Z + 1, Z - 2, Z - 2); }
    }
    // --------- 3D ----------
    build3D() {
      this.model.innerHTML = '';
      this.faceCanvases = [];
      const S = S3;
      for (const b of boxes(this.slim)) {
        const inf = b.inf;
        const W = (b.w + inf * 2) * S, H = (b.h + inf * 2) * S, D = (b.d + inf * 2) * S;
        const cx = (b.fx + b.w / 2 - 8) * S, cy = (b.fy + b.h / 2 - 16) * S, cz = (b.fz + b.d / 2) * S;
        const fs = faces(b);
        const T = {
          front: [W, H, `translate3d(${cx - W / 2}px,${cy - H / 2}px,${cz + D / 2}px)`],
          back: [W, H, `translate3d(${cx - W / 2}px,${cy - H / 2}px,${cz - D / 2}px) rotateY(180deg)`],
          right: [D, H, `translate3d(${cx - W / 2 - D / 2}px,${cy - H / 2}px,${cz}px) rotateY(-90deg)`],
          left: [D, H, `translate3d(${cx + W / 2 - D / 2}px,${cy - H / 2}px,${cz}px) rotateY(90deg)`],
          top: [W, D, `translate3d(${cx - W / 2}px,${cy - H / 2 - D / 2}px,${cz}px) rotateX(90deg)`],
          bottom: [W, D, `translate3d(${cx - W / 2}px,${cy + H / 2 - D / 2}px,${cz}px) rotateX(-90deg)`],
        };
        for (const [k, f] of Object.entries(fs)) {
          const cv = document.createElement('canvas');
          cv.width = f[2]; cv.height = f[3];
          const [w, h, tr] = T[k];
          cv.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform:${tr};image-rendering:pixelated;backface-visibility:hidden;cursor:crosshair`;
          cv.dataset.layer = b.layer;
          this.model.appendChild(cv);
          this.faceCanvases.push({ cv, f, layer: b.layer, flipY: k === 'bottom' });
        }
      }
      this.updateRot();
    }
    render3D() {
      for (const fc of this.faceCanvases || []) {
        fc.cv.style.display = fc.layer === 1 && !this.showOverlay ? 'none' : '';
        const x = fc.cv.getContext('2d');
        x.clearRect(0, 0, fc.f[2], fc.f[3]);
        if (fc.flipY) { x.save(); x.translate(0, fc.f[3]); x.scale(1, -1); }
        x.drawImage(this.tex, fc.f[0], fc.f[1], fc.f[2], fc.f[3], 0, 0, fc.f[2], fc.f[3]);
        if (fc.flipY) x.restore();
        fc.cv.style.pointerEvents = fc.layer === 1 && this.layer === 0 ? 'none' : 'auto';
      }
    }
    updateRot() { this.model.style.transform = `translateY(10px) rotateX(${this.rx}deg) rotateY(${this.ry}deg)`; }
    bind3D() {
      let mode = null, sx = 0, sy = 0, last = null;
      this.stage.addEventListener('contextmenu', e => e.preventDefault());
      const facePix = e => {
        const fc = (this.faceCanvases || []).find(q => q.cv === e.target);
        if (!fc) return null;
        const w = parseFloat(fc.cv.style.width), h = parseFloat(fc.cv.style.height);
        let px = Math.floor(e.offsetX / w * fc.f[2]), py = Math.floor(e.offsetY / h * fc.f[3]);
        px = Math.max(0, Math.min(fc.f[2] - 1, px)); py = Math.max(0, Math.min(fc.f[3] - 1, py));
        if (fc.flipY) py = fc.f[3] - 1 - py;
        return [fc.f[0] + px, fc.f[1] + py, fc];
      };
      this.stage.addEventListener('pointerdown', e => {
        const p = e.button === 0 ? facePix(e) : null;
        if (p && p[2].layer === this.layer) {
          mode = 'paint'; last = p; this.apply(p[0], p[1], true);
        } else { mode = 'rot'; sx = e.clientX; sy = e.clientY; this.stage.style.cursor = 'grabbing'; this.stage.setPointerCapture(e.pointerId); }
      });
      this.stage.addEventListener('pointermove', e => {
        if (mode === 'rot') {
          this.ry += (e.clientX - sx) * .6; this.rx = Math.max(-80, Math.min(80, this.rx - (e.clientY - sy) * .6));
          sx = e.clientX; sy = e.clientY; this.updateRot();
        } else if (mode === 'paint' && (this.tool === 'pencil' || this.tool === 'eraser')) {
          const p = facePix(e);
          if (p && (p[0] !== last[0] || p[1] !== last[1])) { this.apply(p[0], p[1], false); last = p; }
        }
      });
      const end = () => { if (mode === 'paint') this.onChange('edit'); mode = null; this.stage.style.cursor = 'grab'; };
      this.stage.addEventListener('pointerup', end);
      this.stage.addEventListener('pointerleave', () => { if (mode === 'paint') end(); });
    }
    render(onlyUV) { this.renderUV(); if (!onlyUV) this.render3D(); }
  }

  window.Skin = { Editor, toCanvas64, headDataUrl, defaultSkin, loadImage };
})();

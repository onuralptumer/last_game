// Procedurally generated textures (no image assets needed).

import * as THREE from 'three';

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable 2D value noise with a given integer period.
function makeNoise(seed, period) {
  const rand = mulberry32(seed);
  const vals = new Float32Array(period * period);
  for (let i = 0; i < vals.length; i++) vals[i] = rand();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = s(x - xi), yf = s(y - yi);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = vals[y0 * period + x0], b = vals[y0 * period + x1];
    const c = vals[y1 * period + x0], d = vals[y1 * period + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

function fbm(noise, x, y, oct = 5) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += noise(x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = [1, 1] } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Writes a per-pixel function into a canvas. fn(u, v) -> [r, g, b] (0..255)
function paint(c, fn) {
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const [r, g, b] = fn(x, y);
      d[i++] = r;
      d[i++] = g;
      d[i++] = b;
      d[i++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return ctx;
}

function drawCracks(ctx, rand, count, size, color, width) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = rand() * size, y = rand() * size;
    let a = rand() * Math.PI * 2;
    ctx.lineWidth = width * (0.5 + rand());
    ctx.beginPath();
    ctx.moveTo(x, y);
    const n = 8 + rand() * 20;
    for (let j = 0; j < n; j++) {
      a += (rand() - 0.5) * 1.2;
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// Floor: 4x4 concrete slabs per tile.
export function floorTextures() {
  const S = 1024;
  const n = makeNoise(7, 32);
  const n2 = makeNoise(13, 16);
  const rand = mulberry32(99);
  const slabTint = [];
  for (let i = 0; i < 16; i++) slabTint.push(0.82 + rand() * 0.3);

  const colC = canvas(S, S);
  const bumpC = canvas(S, S);
  const slab = S / 4;
  const groove = (x, y) => {
    const gx = Math.min(x % slab, slab - (x % slab));
    const gy = Math.min(y % slab, slab - (y % slab));
    return Math.min(gx, gy);
  };
  const ctx = paint(colC, (x, y) => {
    const u = (x / S) * 32, v = (y / S) * 32;
    const f = fbm(n, u, v, 5);
    const big = fbm(n2, (x / S) * 16, (y / S) * 16, 3);
    const tint = slabTint[(Math.floor(y / slab) * 4 + Math.floor(x / slab)) % 16];
    let c = (0.2 + f * 0.25 + (big - 0.5) * 0.18) * tint;
    const g = groove(x, y);
    if (g < 3) c *= 0.25;
    else if (g < 6) c *= 0.7;
    const r = c * 205, gg = c * 212, b = c * 225;
    return [r, gg, b];
  });
  drawCracks(ctx, rand, 26, S, 'rgba(10,10,14,0.55)', 1.4);
  // dark stains
  for (let i = 0; i < 18; i++) {
    const x = rand() * S, y = rand() * S, r = 30 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(8,8,10,0.35)');
    g.addColorStop(1, 'rgba(8,8,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const bctx = paint(bumpC, (x, y) => {
    const f = fbm(n, (x / S) * 24, (y / S) * 24, 3);
    const g = groove(x, y);
    let c = 0.65 + f * 0.3;
    if (g < 4) c *= 0.2 + (g / 4) * 0.6;
    return [c * 255, c * 255, c * 255];
  });
  drawCracks(bctx, mulberry32(99), 26, S, 'rgba(0,0,0,0.9)', 1.4);

  // Puddle roughness map covering the whole arena (not tiled).
  const R = 512;
  const rn = makeNoise(42, 8);
  const roughC = canvas(R, R);
  paint(roughC, (x, y) => {
    const f = fbm(rn, (x / R) * 8, (y / R) * 8, 5);
    let r;
    if (f > 0.56) r = 0.06;
    else if (f > 0.5) r = 0.06 + ((0.56 - f) / 0.06) * 0.6;
    else r = 0.66 + (0.5 - f) * 0.9;
    r = Math.min(1, r);
    return [r * 255, r * 255, r * 255];
  });

  return {
    map: toTexture(colC),
    bump: toTexture(bumpC, { srgb: false }),
    rough: toTexture(roughC, { srgb: false }),
  };
}

// Wall concrete with panel seams and rain streaks.
export function wallTextures() {
  const W = 512, H = 1024;
  const n = makeNoise(3, 16);
  const rand = mulberry32(5);
  const streaks = new Float32Array(W);
  for (let i = 0; i < W; i++) streaks[i] = 0;
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(rand() * W), w = 2 + Math.floor(rand() * 12), s = rand() * 0.5;
    for (let k = 0; k < w; k++) streaks[(x + k) % W] += s * Math.sin((k / w) * Math.PI);
  }
  const c = canvas(W, H);
  paint(c, (x, y) => {
    const f = fbm(n, (x / W) * 8, (y / H) * 16, 5);
    let v = 0.22 + f * 0.3;
    const drip = streaks[x] * (1 - y / H) * 0.35;
    v *= 1 - Math.min(0.6, drip);
    const seam = y % 256 < 4 || x % 256 < 3;
    if (seam) v *= 0.35;
    // tie holes
    const hx = x % 128, hy = y % 128;
    if ((hx - 64) ** 2 + (hy - 64) ** 2 < 20) v *= 0.3;
    return [v * 200, v * 205, v * 215];
  });
  const b = canvas(W, H);
  paint(b, (x, y) => {
    const f = fbm(n, (x / W) * 32, (y / H) * 64, 3);
    let v = 0.55 + f * 0.45;
    if (y % 256 < 4 || x % 256 < 3) v = 0.1;
    const hx = x % 128, hy = y % 128;
    if ((hx - 64) ** 2 + (hy - 64) ** 2 < 20) v = 0.1;
    return [v * 255, v * 255, v * 255];
  });
  return { map: toTexture(c), bump: toTexture(b, { srgb: false }) };
}

// Glowing glyphs for the monolith.
export function runeTexture() {
  const W = 256, H = 1024;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const rand = mulberry32(1337);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'square';
  const cols = 3;
  for (let col = 0; col < cols; col++) {
    const cx = (W / cols) * (col + 0.5);
    for (let y = 40; y < H - 40; y += 46) {
      if (rand() < 0.2) continue;
      ctx.lineWidth = 2 + rand() * 2;
      ctx.beginPath();
      const s = 14;
      let px = cx + (rand() - 0.5) * s, py = y;
      ctx.moveTo(px, py);
      const strokes = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < strokes; k++) {
        const dir = Math.floor(rand() * 4);
        if (dir === 0) px += s; else if (dir === 1) px -= s; else if (dir === 2) py += s * 0.8; else py -= s * 0.8;
        px = Math.max(cx - s, Math.min(cx + s, px));
        py = Math.max(y - s, Math.min(y + s, py));
        if (rand() < 0.3) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (rand() < 0.4) {
        ctx.beginPath();
        ctx.arc(cx, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    }
  }
  // vertical channel lines
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  for (let col = 1; col < cols; col++) {
    ctx.beginPath();
    ctx.moveTo((W / cols) * col, 0);
    ctx.lineTo((W / cols) * col, H);
    ctx.stroke();
  }
  return toTexture(c);
}

export function crateTexture() {
  const S = 256;
  const c = canvas(S, S);
  const n = makeNoise(21, 8);
  const ctx = paint(c, (x, y) => {
    const f = fbm(n, (x / S) * 8, (y / S) * 8, 4);
    const v = 0.18 + f * 0.15;
    return [v * 210, v * 200, v * 190];
  });
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, S - 10, S - 10);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(10, 10);
  ctx.lineTo(S - 10, S - 10);
  ctx.stroke();
  // hazard band
  ctx.save();
  ctx.beginPath();
  ctx.rect(14, S - 50, S - 28, 26);
  ctx.clip();
  for (let x = -40; x < S + 40; x += 24) {
    ctx.fillStyle = 'rgba(190,120,20,0.55)';
    ctx.beginPath();
    ctx.moveTo(x, S - 50);
    ctx.lineTo(x + 12, S - 50);
    ctx.lineTo(x - 14, S - 24);
    ctx.lineTo(x - 26, S - 24);
    ctx.fill();
  }
  ctx.restore();
  return toTexture(c);
}

// Soft round sprite used for glows / particles.
export function glowTexture() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Bullet hole / scorch decal.
export function decalTexture() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.18, 'rgba(10,8,6,0.95)');
  g.addColorStop(0.35, 'rgba(20,16,12,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const rand = mulberry32(8);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    ctx.lineTo(S / 2 + Math.cos(a) * (20 + rand() * 30), S / 2 + Math.sin(a) * (20 + rand() * 30));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

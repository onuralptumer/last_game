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

// Puddle roughness map covering the whole arena floor (not tiled): wet patches are mirror-smooth.
export function puddleMap() {
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
  return toTexture(roughC, { srgb: false });
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

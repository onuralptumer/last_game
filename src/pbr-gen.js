// Procedural PBR material generators. Every material is built from a height field
// (which becomes a normal map) plus albedo, roughness/metalness and emissive layers.
// All maps tile seamlessly so they can be used with triplanar projection.
// Pure functions with no DOM or three.js dependency, so they can run in a Web Worker.

// --- primitives ----------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tileable value noise with integer period P (sample x, y in [0, P)).
function makeNoise(seed, P) {
  const vals = new Float32Array(P * P);
  const r = mulberry32(seed);
  for (let i = 0; i < vals.length; i++) vals[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let xf = x - xi, yf = y - yi;
    xf = xf * xf * (3 - 2 * xf);
    yf = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P;
    const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
    const a = vals[y0 * P + x0], b = vals[y0 * P + x1], c = vals[y1 * P + x0], d = vals[y1 * P + x1];
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

function fbm(n, x, y, oct = 5, gain = 0.5) {
  let v = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += n(x * f, y * f) * a;
    norm += a;
    a *= gain;
    f *= 2;
  }
  return v / norm;
}

function ridged(n, x, y, oct = 4) {
  let v = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += (1 - Math.abs(n(x * f, y * f) * 2 - 1)) * a;
    norm += a;
    a *= 0.5;
    f *= 2;
  }
  return v / norm;
}

// Tileable Voronoi on an N x N grid. Returns [f1, f2, cellX, cellY, px, py].
function makeVoronoi(seed, N, jitter = 0.85) {
  const pts = new Float32Array(N * N * 2);
  const r = mulberry32(seed);
  for (let i = 0; i < N * N; i++) {
    pts[i * 2] = 0.5 + (r() - 0.5) * jitter;
    pts[i * 2 + 1] = 0.5 + (r() - 0.5) * jitter;
  }
  const out = [0, 0, 0, 0, 0, 0];
  return (x, y) => {
    const cx = Math.floor(x), cy = Math.floor(y);
    let f1 = 1e9, f2 = 1e9, bx = 0, by = 0, bpx = 0, bpy = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j;
        const wx = ((gx % N) + N) % N, wy = ((gy % N) + N) % N;
        const k = (wy * N + wx) * 2;
        const px = gx + pts[k], py = gy + pts[k + 1];
        const d = Math.hypot(px - x, py - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          bx = wx;
          by = wy;
          bpx = px;
          bpy = py;
        } else if (d < f2) f2 = d;
      }
    }
    out[0] = f1; out[1] = f2; out[2] = bx; out[3] = by; out[4] = bpx; out[5] = bpy;
    return out;
  };
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// --- buffers -> textures -------------------------------------------------------------------
class Maps {
  constructor(S) {
    this.S = S;
    this.h = new Float32Array(S * S);
    this.col = new Float32Array(S * S * 3);
    this.rough = new Float32Array(S * S).fill(0.8);
    this.metal = new Float32Array(S * S);
    this.emis = null;
  }
  emissive() {
    if (!this.emis) this.emis = new Float32Array(this.S * this.S);
    return this.emis;
  }
}

// Packs the layers into three RGBA8 arrays: albedo (sRGB), normal, and ORM
// (R = emissive mask, G = roughness, B = metalness). Rows run with +v (no flip).
function finish(m, normalStrength) {
  const S = m.S;
  const { h, col, rough, metal, emis } = m;
  const albedo = new Uint8Array(S * S * 4);
  const normal = new Uint8Array(S * S * 4);
  const orm = new Uint8Array(S * S * 4);
  const enc = (v) => Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255;
  for (let i = 0; i < S * S; i++) {
    albedo[i * 4] = enc(col[i * 3]);
    albedo[i * 4 + 1] = enc(col[i * 3 + 1]);
    albedo[i * 4 + 2] = enc(col[i * 3 + 2]);
    albedo[i * 4 + 3] = 255;
    orm[i * 4] = emis ? Math.min(1, emis[i]) * 255 : 0;
    orm[i * 4 + 1] = Math.max(0.02, Math.min(1, rough[i])) * 255;
    orm[i * 4 + 2] = Math.max(0, Math.min(1, metal[i])) * 255;
    orm[i * 4 + 3] = 255;
  }
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S, yp = ((y + 1) % S) * S, yc = y * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S;
      const dx = (h[yc + xp] - h[yc + xm]) * normalStrength;
      const dy = (h[yp + x] - h[ym + x]) * normalStrength;
      const l = Math.hypot(dx, dy, 1);
      const i = (yc + x) * 4;
      normal[i] = (-dx / l * 0.5 + 0.5) * 255;
      normal[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
      normal[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  return { S, albedo, normal, orm };
}

// Draw random strokes into a mask (used for scratches and cracks).
function strokeMask(S, seed, count, len, width, alpha) {
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext('2d');
  const r = mulberry32(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
    const L = len * (0.3 + r());
    ctx.strokeStyle = `rgba(255,255,255,${alpha * (0.4 + r() * 0.6)})`;
    ctx.lineWidth = width * (0.5 + r());
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        if (x + ox < -L || x + ox > S + L || y + oy < -L || y + oy > S + L) continue;
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        let px = x + ox, py = y + oy, aa = a;
        const steps = 6;
        for (let s = 0; s < steps; s++) {
          aa += (r() - 0.5) * 0.4;
          px += (Math.cos(aa) * L) / steps;
          py += (Math.sin(aa) * L) / steps;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }
  const d = ctx.getImageData(0, 0, S, S).data;
  const m = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) m[i] = d[i * 4 + 3] / 255;
  return m;
}

// --- materials -----------------------------------------------------------------------------

// Irregular, slightly tilted flagstones with chipped edges and cracks. Tile = ~8 m.
function flagstones(S = 1024) {
  const m = new Maps(S);
  const N = 6;
  const vor = makeVoronoi(11, N, 0.9);
  const warp = makeNoise(3, 16);
  const det = makeNoise(5, 64);
  const big = makeNoise(9, 8);
  const crackN = makeNoise(17, 16);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let u = (x / S) * N, v = (y / S) * N;
      const wx = (fbm(warp, (x / S) * 16, (y / S) * 16, 3) - 0.5) * 0.16;
      const wy = (fbm(warp, (x / S) * 16 + 7.3, (y / S) * 16 + 2.1, 3) - 0.5) * 0.16;
      const [f1, f2, cx, cy, px, py] = vor(u + wx, v + wy);
      const e = f2 - f1;
      const id = hash2(cx, cy, 1);
      const chip = fbm(det, (x / S) * 64, (y / S) * 64, 3);
      const g = 0.012 + chip * 0.022;
      const slab = smooth(g, g + 0.035, e);
      const tiltX = (hash2(cx, cy, 2) - 0.5) * 0.12, tiltY = (hash2(cx, cy, 3) - 0.5) * 0.12;
      const surf = fbm(det, (x / S) * 64 + id * 10, (y / S) * 64, 4);
      const crack = id > 0.78 ? smooth(0.006, 0.0, Math.abs(fbm(crackN, (x / S) * 16 + id * 5, (y / S) * 16, 4) - 0.5)) : 0;
      m.h[i] = slab * (0.7 + (u - px) * tiltX + (v - py) * tiltY + surf * 0.12) - crack * 0.25;

      const tint = 0.85 + id * 0.3;
      const warm = hash2(cx, cy, 4);
      const b = (0.17 + surf * 0.1 + (fbm(big, (x / S) * 8, (y / S) * 8, 3) - 0.5) * 0.08) * tint;
      let r = b * (1.0 + warm * 0.12), gg = b * (1.0 + warm * 0.05), bb = b * (1.05 - warm * 0.08);
      const ao = 0.6 + 0.4 * smooth(0.0, g + 0.1, e);
      const grime = 1 - slab;
      r = lerp(r, 0.06, grime) * ao * (1 - crack * 0.5);
      gg = lerp(gg, 0.058, grime) * ao * (1 - crack * 0.5);
      bb = lerp(bb, 0.055, grime) * ao * (1 - crack * 0.5);
      m.col[i * 3] = r; m.col[i * 3 + 1] = gg; m.col[i * 3 + 2] = bb;
      m.rough[i] = 0.75 + grime * 0.2 - surf * 0.15;
    }
  }
  return finish(m, 7);
}

// Ashlar masonry: staggered courses of chiselled blocks with recessed mortar. Tile = 4 m.
function ashlar(S = 1024) {
  const m = new Maps(S);
  const rows = 8;
  const r = mulberry32(21);
  const courses = [];
  for (let k = 0; k < rows; k++) {
    const widths = [];
    let sum = 0;
    while (sum < 1 - 0.18) {
      const w = 0.16 + r() * 0.16;
      widths.push(w);
      sum += w;
    }
    widths.push(1 - sum);
    courses.push({ off: r(), widths });
  }
  const det = makeNoise(31, 64);
  const chipN = makeNoise(37, 32);
  const streak = makeNoise(41, 32);
  const mortarW = 0.006;
  for (let y = 0; y < S; y++) {
    const v = y / S;
    const row = Math.floor(v * rows);
    const ly = v * rows - row; // 0..1 in course
    const C = courses[row];
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = (x / S + C.off) % 1;
      let acc = 0, bi = 0;
      while (bi < C.widths.length - 1 && acc + C.widths[bi] < u) acc += C.widths[bi++];
      const bw = C.widths[bi];
      const lx = u - acc;
      // distance to block edge in tile units
      const dEdge = Math.min(lx, bw - lx, ly / rows, (1 - ly) / rows);
      const chip = fbm(chipN, (x / S) * 32, (y / S) * 32, 3);
      const bevel = 0.008 + chip * 0.01;
      const face = smooth(mortarW, mortarW + bevel, dEdge);
      const chisel = fbm(det, (x / S) * 64, (y / S) * 64, 4);
      const id = hash2(row, bi, 7);
      m.h[i] = face * (0.8 + chisel * 0.25 + id * 0.05);
      const st = fbm(streak, (x / S) * 32, (y / S) * 4, 3);
      const tone = (0.2 + chisel * 0.1) * (0.8 + id * 0.35) * (1 - Math.max(0, st - 0.55) * 1.2);
      const mortar = 1 - face;
      const ao = 0.65 + 0.35 * smooth(0, mortarW + 0.02, dEdge);
      m.col[i * 3] = lerp(tone * 1.03, 0.11, mortar) * ao;
      m.col[i * 3 + 1] = lerp(tone * 1.0, 0.105, mortar) * ao;
      m.col[i * 3 + 2] = lerp(tone * 0.95, 0.1, mortar) * ao;
      m.rough[i] = 0.82 + mortar * 0.12 - Math.max(0, st - 0.55) * 0.5;
    }
  }
  return finish(m, 9);
}

// Board-formed concrete with pores, blotches and tie holes. Tile = 3 m.
function concrete(S = 512) {
  const m = new Maps(S);
  const n = makeNoise(51, 32);
  const pores = makeNoise(53, 128);
  const board = makeNoise(57, 16);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const blot = fbm(n, (x / S) * 32, (y / S) * 32, 5);
      const p = pores((x / S) * 128, (y / S) * 128);
      const pore = smooth(0.82, 0.92, p);
      const boardLine = (y % (S / 6)) < 2 ? 1 : 0;
      const grain = fbm(board, (x / S) * 2, (y / S) * 16, 3);
      const hx = (x % (S / 3)) - S / 6, hy = (y % (S / 3)) - S / 6;
      const tie = hx * hx + hy * hy < 25 ? 1 : 0;
      m.h[i] = blot * 0.3 + grain * 0.15 - pore * 0.4 - boardLine * 0.2 - tie * 0.6;
      const t = (0.2 + blot * 0.12 + grain * 0.04) * (1 - pore * 0.5) * (1 - tie * 0.7) * (1 - boardLine * 0.3);
      m.col[i * 3] = t * 1.0; m.col[i * 3 + 1] = t * 1.0; m.col[i * 3 + 2] = t * 1.04;
      m.rough[i] = 0.85 + pore * 0.1 - blot * 0.1;
    }
  }
  return finish(m, 5);
}

// Painted industrial steel: panel seams, rivets, scratches to bare metal, rust. Tile = 2 m.
function paintedMetal(S = 512, paint = [0.11, 0.13, 0.14], seed = 61) {
  const m = new Maps(S);
  const n = makeNoise(seed, 16);
  const dent = makeNoise(seed + 2, 32);
  const scratches = strokeMask(S, seed + 4, 220, S * 0.06, 1.2, 0.9);
  const panel = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const px = x % panel, py = y % panel;
      const seam = Math.min(px, py, panel - px, panel - py);
      const seamM = smooth(1.5, 3.5, seam);
      // rivets along seams
      const rx = (px + 16) % 32 - 16, ry = py - 10, ry2 = panel - py - 10;
      const rx2 = px - 10, ry3 = (py + 16) % 32 - 16, rx3 = panel - px - 10;
      const rd = Math.min(Math.hypot(rx, ry), Math.hypot(rx, ry2), Math.hypot(rx2, ry3), Math.hypot(rx3, ry3));
      const rivet = smooth(4.5, 2.5, rd);
      const rustN = fbm(n, (x / S) * 16, (y / S) * 16, 5);
      const rust = smooth(0.6, 0.72, rustN + (1 - seamM) * 0.15 + rivet * 0.1);
      const sc = scratches[i] * (1 - rust);
      const d = fbm(dent, (x / S) * 32, (y / S) * 32, 3);
      m.h[i] = seamM * 0.5 + rivet * 0.4 + d * 0.12 - sc * 0.08 + rust * (fbm(dent, (x / S) * 64, (y / S) * 64, 3) * 0.2);
      const grime = 0.85 + d * 0.3;
      let r = paint[0] * grime, g = paint[1] * grime, b = paint[2] * grime;
      r = lerp(r, 0.55, sc); g = lerp(g, 0.55, sc); b = lerp(b, 0.56, sc);
      r = lerp(r, 0.2 + rustN * 0.1, rust); g = lerp(g, 0.09 + rustN * 0.04, rust); b = lerp(b, 0.04, rust);
      const ao = 0.55 + 0.45 * seamM;
      m.col[i * 3] = r * ao; m.col[i * 3 + 1] = g * ao; m.col[i * 3 + 2] = b * ao;
      m.metal[i] = sc + rivet * 0.6;
      m.rough[i] = lerp(lerp(0.55 + d * 0.2, 0.3, sc), 0.92, rust);
    }
  }
  return finish(m, 6);
}

// Diamond (tread) plate steel. Tile = 1.2 m.
function diamondPlate(S = 512) {
  const m = new Maps(S);
  const n = makeNoise(71, 16);
  const cell = S / 12;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      let lx = (x % cell) / cell - 0.5, ly = (y % cell) / cell - 0.5;
      const flip = (cx + cy) % 2 ? 1 : -1;
      const a = flip * 0.785;
      const rx = lx * Math.cos(a) - ly * Math.sin(a), ry = lx * Math.sin(a) + ly * Math.cos(a);
      const lozenge = smooth(1, 0.6, Math.hypot(rx / 0.42, ry / 0.1));
      const dirt = fbm(n, (x / S) * 16, (y / S) * 16, 4);
      m.h[i] = lozenge * 0.6 + dirt * 0.1;
      const worn = lozenge * 0.25;
      const t = 0.28 + dirt * 0.12 + worn;
      const dd = 1 - (1 - lozenge) * smooth(0.45, 0.7, dirt) * 0.6;
      m.col[i * 3] = t * dd; m.col[i * 3 + 1] = t * dd * 0.98; m.col[i * 3 + 2] = t * dd * 0.95;
      m.metal[i] = 0.85 - (1 - dd) * 0.8;
      m.rough[i] = 0.5 - lozenge * 0.2 + (1 - dd) * 0.4;
    }
  }
  return finish(m, 5);
}

// Wrinkled, wet skin with branching veins and pores. Veins go to the emissive channel. Tile = 0.8 m.
function flesh(S = 512, seed = 81) {
  const m = new Maps(S);
  const n = makeNoise(seed, 16);
  const vn = makeNoise(seed + 1, 16);
  const vn2 = makeNoise(seed + 2, 32);
  const w = makeNoise(seed + 3, 32);
  const pores = makeNoise(seed + 4, 128);
  const em = m.emissive();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = x / S, v = y / S;
      // domain-warped ridges make meandering, branching vein lines
      const wx = (fbm(n, u * 8, v * 8, 3) - 0.5) * 3, wy = (fbm(n, u * 8 + 5, v * 8 + 3, 3) - 0.5) * 3;
      const r1 = 1 - Math.abs(fbm(vn, u * 8 + wx, v * 8 + wy, 4) * 2 - 1);
      const r2 = 1 - Math.abs(fbm(vn2, u * 16 + wy, v * 16 + wx, 3) * 2 - 1);
      const vein = smooth(0.9, 0.975, r1);
      const capillary = smooth(0.93, 0.985, r2) * 0.6;
      const wrinkle = ridged(w, u * 16 + wx * 0.3, v * 32, 3);
      const mott = fbm(n, u * 16 + 3, v * 16, 5);
      const pore = smooth(0.8, 0.9, pores(u * 128, v * 128));
      m.h[i] = wrinkle * 0.25 + vein * 0.4 + capillary * 0.15 + mott * 0.25 - pore * 0.12;
      const base = 0.09 + mott * 0.07;
      const flush = smooth(0.45, 0.75, mott);
      m.col[i * 3] = (base * (1.3 + flush * 0.4) + vein * 0.05) * (1 - pore * 0.3);
      m.col[i * 3 + 1] = base * (0.95 - flush * 0.15) * (1 - pore * 0.3) * (1 - vein * 0.3);
      m.col[i * 3 + 2] = base * 1.0 * (1 - pore * 0.3) * (1 - vein * 0.15);
      m.rough[i] = 0.3 + wrinkle * 0.25 + pore * 0.2;
      em[i] = vein * smooth(0.4, 0.7, fbm(n, u * 4 + 9, v * 4 + 4, 3)) + capillary * 0.2;
    }
  }
  return finish(m, 5);
}

// Segmented chitin/carapace: glossy plates with raised lips. Tile = 0.6 m.
function chitin(S = 512) {
  const m = new Maps(S);
  const vor = makeVoronoi(91, 6, 0.8);
  const n = makeNoise(93, 32);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = x / S, v = y / S;
      const [f1, f2, cx, cy] = vor(u * 6, v * 6);
      const e = f2 - f1;
      const lip = smooth(0.02, 0.06, e) * (1 - smooth(0.06, 0.25, e) * 0.4);
      const d = fbm(n, u * 32, v * 32, 4);
      const id = hash2(cx, cy, 5);
      m.h[i] = lip * (0.6 + f1 * 0.3) + d * 0.08;
      const t = (0.08 + id * 0.05 + d * 0.04) * (0.4 + lip * 0.6);
      m.col[i * 3] = t * 1.1; m.col[i * 3 + 1] = t * 0.95; m.col[i * 3 + 2] = t * 0.9;
      m.rough[i] = 0.25 + (1 - lip) * 0.4 + d * 0.1;
    }
  }
  return finish(m, 5);
}

// Machined gunmetal: brushed grain, fine scratches, slight wear. Tile = 0.25 m.
function gunmetal(S = 512) {
  const m = new Maps(S);
  const n = makeNoise(101, 16);
  const brush = makeNoise(103, 128);
  const scratches = strokeMask(S, 105, 160, S * 0.05, 0.8, 0.7);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = x / S, v = y / S;
      const b = fbm(brush, u * 4, v * 128, 2);
      const d = fbm(n, u * 16, v * 16, 4);
      const sc = scratches[i];
      m.h[i] = b * 0.08 - sc * 0.15 + d * 0.05;
      const t = 0.16 + b * 0.05 + d * 0.06 + sc * 0.25;
      m.col[i * 3] = t; m.col[i * 3 + 1] = t * 1.01; m.col[i * 3 + 2] = t * 1.04;
      m.metal[i] = 0.75 + sc * 0.25;
      m.rough[i] = 0.32 + d * 0.2 - sc * 0.1;
    }
  }
  return finish(m, 3);
}

// Diamond knurling / stippled polymer for grips. Tile = 0.12 m.
function grip(S = 256) {
  const m = new Maps(S);
  const n = makeNoise(111, 16);
  const c = S / 24;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const a = ((x + y) % c) / c - 0.5, b = ((x - y + S) % c) / c - 0.5;
      const k = 1 - Math.max(Math.abs(a), Math.abs(b)) * 2;
      const d = fbm(n, (x / S) * 16, (y / S) * 16, 3);
      m.h[i] = k * 0.6 + d * 0.05;
      const t = 0.045 + k * 0.03 + d * 0.02;
      m.col[i * 3] = t; m.col[i * 3 + 1] = t; m.col[i * 3 + 2] = t * 1.05;
      m.rough[i] = 0.7 - k * 0.15;
    }
  }
  return finish(m, 6);
}

// Coarse woven cloth with stains. Tile = 0.5 m.
function cloth(S = 512) {
  const m = new Maps(S);
  const n = makeNoise(121, 16);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const wx = Math.sin((x / S) * Math.PI * 2 * 96), wy = Math.sin((y / S) * Math.PI * 2 * 96);
      const over = ((Math.floor((x / S) * 96) + Math.floor((y / S) * 96)) % 2) ? wx : wy;
      const d = fbm(n, (x / S) * 16, (y / S) * 16, 5);
      m.h[i] = over * 0.15 + d * 0.3;
      const t = (0.05 + d * 0.06) * (0.85 + over * 0.15);
      m.col[i * 3] = t * 1.25; m.col[i * 3 + 1] = t * 0.75; m.col[i * 3 + 2] = t * 0.75;
      m.rough[i] = 0.92;
    }
  }
  return finish(m, 4);
}

export const GENERATORS = {
  flag: () => flagstones(),
  ashlar: () => ashlar(),
  concrete: () => concrete(),
  metal: () => paintedMetal(512, [0.1, 0.12, 0.13], 61),
  rustRed: () => paintedMetal(512, [0.22, 0.06, 0.04], 67),
  plate: () => diamondPlate(),
  flesh: () => flesh(512, 81),
  chitin: () => chitin(),
  gun: () => gunmetal(),
  grip: () => grip(),
  cloth: () => cloth(),
};

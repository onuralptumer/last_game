// Detailed procedural enemy models.
//
// Each model is assembled from many small parts (bones, plates, teeth, rivets...) that are
// merged per (pivot, material) into a single mesh, so a detailed enemy costs only a handful
// of draw calls. A template is built once per type and cloned for every spawn; each clone
// gets its own materials so hit flashes stay per-enemy.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rbox, capsule } from './shapes.js';
import { materials as pbr } from './pbr.js';
import { triplanar } from './triplanar.js';

// --- geometry helpers ----------------------------------------------------------------------
const cache = new Map();
const memo = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
};
const SPH = (r, w = 20, h = 14) => memo(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const CAP = (r, len) => memo(`c${r},${len}`, () => capsule(r, len, 12));
const CONE = (r, h, s = 10) => memo(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const CYL = (rt, rb, h, s = 16) => memo(`y${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const TOR = (r, t, rs = 8, ts = 32, arc = Math.PI * 2) => memo(`t${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const BOX = (w, h, d, r = null) => memo(`b${w},${h},${d},${r}`, () => rbox(w, h, d, r === null ? Math.min(w, h, d) * 0.3 : r));

// Lumpy, muscular deformation along the normals.
function organic(geo, amp, freq, seed = 1) {
  return memo(`o${geo.uuid},${amp},${freq},${seed}`, () => {
    const g = geo.clone();
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d =
        Math.sin(x * freq + seed) * Math.sin(y * freq * 1.3 + seed * 2.1) * Math.sin(z * freq * 0.9 + seed * 3.7) +
        0.5 * Math.sin(x * freq * 2.3 + seed * 5) * Math.sin(y * freq * 2.1) * Math.sin(z * freq * 2.7 + seed);
      p.setXYZ(i, x + n.getX(i) * d * amp, y + n.getY(i) * d * amp, z + n.getZ(i) * d * amp);
    }
    g.computeVertexNormals();
    return g;
  });
}

// Partial sphere shell (for armour plates, carapace segments, hoods).
const SHELL = (r, phiStart, phiLen, thStart, thLen, w = 20, h = 10) =>
  memo(`sh${r},${phiStart},${phiLen},${thStart},${thLen}`, () => new THREE.SphereGeometry(r, w, h, phiStart, phiLen, thStart, thLen));

// A curved scythe/halo blade.
const BLADE = (len, width) =>
  memo(`bl${len},${width}`, () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(width * 1.4, len * 0.45, width * 0.2, len);
    s.quadraticCurveTo(width * 0.5, len * 0.5, -width * 0.4, len * 0.05);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -0.015);
    return g;
  });

// --- rig builder ---------------------------------------------------------------------------
class Rig {
  constructor() {
    this.root = new THREE.Group();
    this.parts = new Map(); // pivot.uuid + key -> { pivot, key, list }
  }

  pivot(parent, name, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    (parent || this.root).add(g);
    return g;
  }

  // Adds a part to `pivot` with material slot `key`.
  add(pivot, key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    const id = pivot.uuid + key;
    if (!this.parts.has(id)) this.parts.set(id, { pivot, key, list: [] });
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(sx, sy, sz)
    );
    this.parts.get(id).list.push({ geo, m });
  }

  // Mirror helper: adds the part at +x and -x (mirroring yaw/roll).
  pair(pivot, key, geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
    this.add(pivot, key, geo, x, y, z, rx, ry, rz, sx, sy, sz);
    this.add(pivot, key, geo, -x, y, z, rx, -ry, -rz, sx, sy, sz);
  }

  build() {
    for (const { pivot, key, list } of this.parts.values()) {
      const geos = list.map(({ geo, m }) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', geo.attributes.position.clone());
        g.setAttribute('normal', geo.attributes.normal.clone());
        g.setIndex(geo.index ? geo.index.clone() : [...Array(geo.attributes.position.count).keys()]);
        g.applyMatrix4(m);
        return g;
      });
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), null);
      mesh.userData.key = key;
      mesh.castShadow = true;
      mesh.name = pivot.name + ':' + key;
      pivot.add(mesh);
    }
    return this.root;
  }
}

// --- materials -----------------------------------------------------------------------------
const std = (color, roughness = 1, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

function flesh(tint, vein, rim) {
  const m = triplanar(std(tint), pbr().flesh, { space: 'object', scale: 1.5, normalScale: 1.4, emissive: C(vein, 0.45), rim: C(rim, 0.4) });
  m.side = THREE.DoubleSide;
  return m;
}
const bone = (tint, rim) => triplanar(std(tint), pbr().chitin, { space: 'object', scale: 3.5, normalScale: 0.7, rim: C(rim, 0.35) });
const chitin = (tint, rim) => triplanar(std(tint), pbr().chitin, { space: 'object', scale: 2.2, normalScale: 1.3, rim: C(rim, 0.6) });
const armour = (set, tint, rim) => triplanar(std(tint, 1, 1), pbr()[set], { space: 'object', scale: 1.8, normalScale: 1.2, rim: C(rim, 0.45) });
function cloth(tint, rim) {
  const m = triplanar(std(tint), pbr().cloth, { space: 'object', scale: 1.4, normalScale: 1.6, rim: C(rim, 0.7) });
  m.side = THREE.DoubleSide;
  return m;
}
const glow = (color, intensity) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });

// --- Husk: a gaunt, flayed ghoul -------------------------------------------------------------
function husk() {
  const R = new Rig();
  const body = R.pivot(null, 'body', 0, 0.95, 0);
  R.add(body, 'flesh', organic(SPH(0.17), 0.015, 18, 1), 0, 0, 0, 0, 0, 0, 1.25, 0.8, 0.9);
  R.pair(body, 'bone', SPH(0.065), 0.14, 0.05, 0.0, 0, 0, 0, 1, 0.7, 1.2);

  const torso = R.pivot(body, 'torso', 0, 0.1, 0);
  torso.rotation.x = 0.45;
  R.add(torso, 'flesh', organic(CAP(0.085, 0.4), 0.01, 25, 2), 0, 0.16, -0.03);
  // Open ribcage: flesh only at the back, ribs arching over a glowing heart.
  R.add(torso, 'flesh', organic(SHELL(0.21, Math.PI, Math.PI, 0.15, 2.6), 0.012, 20, 3), 0, 0.42, 0, 0, 0, 0, 1.12, 1.3, 0.85);
  R.add(torso, 'flesh', organic(SPH(0.11), 0.02, 22, 4), 0, 0.4, -0.06);
  R.add(torso, 'heart', SPH(0.065), 0, 0.42, 0.03);
  const ribArc = 2.5;
  for (let k = 0; k < 6; k++) {
    const y = 0.58 - k * 0.055;
    const rr = 0.2 - Math.abs(k - 1.5) * 0.012;
    R.add(torso, 'bone', TOR(rr, 0.011, 6, 24, ribArc), 0, y, -0.01, Math.PI / 2 + 0.3, -(Math.PI / 2 - ribArc / 2), 0, 1.15, 0.92, 1);
  }
  R.add(torso, 'bone', BOX(0.035, 0.26, 0.03), 0, 0.44, 0.185, 0.15);
  // Spine: vertebrae with spurs down the back
  for (let k = 0; k < 9; k++) {
    const y = 0.02 + k * 0.08;
    R.add(torso, 'bone', BOX(0.06, 0.045, 0.05, 0.015), 0, y, -0.15 - Math.sin(k * 0.4) * 0.02);
    R.add(torso, 'bone', CONE(0.014, 0.08, 6), 0, y, -0.2, -1.2);
  }
  R.pair(torso, 'bone', BOX(0.15, 0.19, 0.03, 0.012), 0.13, 0.55, -0.15, 0.2, 0.5, 0.1);
  R.pair(torso, 'bone', CAP(0.018, 0.22), 0.11, 0.66, 0.05, 0, 0.4, Math.PI / 2 - 0.25);
  R.add(torso, 'flesh', organic(CAP(0.045, 0.24), 0.008, 30, 5), 0, 0.68, 0.06, 0.6);

  const head = R.pivot(torso, 'head', 0, 0.78, 0.12);
  R.add(head, 'flesh', organic(SPH(0.16, 24, 16), 0.012, 16, 6), 0, 0.04, 0, 0, 0, 0, 0.92, 1.0, 1.18);
  R.add(head, 'bone', CAP(0.03, 0.26), 0, 0.075, 0.14, 0, 0, Math.PI / 2);
  R.pair(head, 'bone', SPH(0.04), 0.085, -0.02, 0.12);
  R.pair(head, 'socket', SPH(0.038), 0.058, 0.035, 0.135);
  R.pair(head, 'eye', SPH(0.022), 0.058, 0.035, 0.16);
  R.add(head, 'socket', CONE(0.02, 0.04, 6), 0, -0.005, 0.175, Math.PI);
  for (let k = 0; k < 8; k++) {
    const a = (k / 7 - 0.5) * 1.6;
    R.add(head, 'bone', CONE(0.009, 0.045, 6), Math.sin(a) * 0.075, -0.075, 0.1 + Math.cos(a) * 0.05, Math.PI);
  }
  const jaw = R.pivot(head, 'jaw', 0, -0.08, 0.03);
  R.add(jaw, 'bone', BOX(0.15, 0.035, 0.15, 0.015), 0, -0.03, 0.07);
  for (let k = 0; k < 8; k++) {
    const a = (k / 7 - 0.5) * 1.6;
    R.add(jaw, 'bone', CONE(0.008, 0.04, 6), Math.sin(a) * 0.065, -0.0, 0.08 + Math.cos(a) * 0.05);
  }

  for (const sx of [-1, 1]) {
    const sh = R.pivot(torso, sx < 0 ? 'shL' : 'shR', sx * 0.3, 0.52, 0);
    R.add(sh, 'flesh', SPH(0.06), 0, 0, 0);
    R.add(sh, 'flesh', organic(CAP(0.05, 0.54), 0.008, 30, 7), 0, -0.25, 0);
    const el = R.pivot(sh, sx < 0 ? 'elL' : 'elR', 0, -0.5, 0);
    R.add(el, 'bone', SPH(0.04), 0, 0, -0.02);
    R.add(el, 'flesh', organic(CAP(0.04, 0.52), 0.007, 32, 8), 0, -0.26, 0);
    R.add(el, 'flesh', BOX(0.08, 0.085, 0.035, 0.012), 0, -0.55, 0.01);
    for (let f = -1; f <= 1; f++) {
      const fx = f * 0.028;
      R.add(el, 'flesh', CAP(0.012, 0.13), fx, -0.65, 0.01, 0.1, 0, f * 0.12);
      R.add(el, 'flesh', CAP(0.01, 0.11), fx + f * 0.012, -0.76, 0.03, 0.4, 0, f * 0.1);
      R.add(el, 'bone', CONE(0.009, 0.09, 6), fx + f * 0.02, -0.85, 0.07, Math.PI + 0.7, 0, 0);
    }
  }
  for (const sx of [-1, 1]) {
    const hip = R.pivot(body, sx < 0 ? 'hipL' : 'hipR', sx * 0.13, -0.05, 0);
    R.add(hip, 'flesh', organic(CAP(0.07, 0.54), 0.01, 24, 9), 0, -0.24, 0);
    const knee = R.pivot(hip, sx < 0 ? 'kneeL' : 'kneeR', 0, -0.48, 0);
    R.add(knee, 'bone', SPH(0.042), 0, 0, 0.045);
    R.add(knee, 'flesh', organic(CAP(0.05, 0.48), 0.008, 28, 10), 0, -0.23, 0);
    R.add(knee, 'flesh', BOX(0.08, 0.05, 0.2, 0.02), 0, -0.46, 0.06);
    for (let t = -1; t <= 1; t++) R.add(knee, 'bone', CONE(0.012, 0.07, 6), t * 0.025, -0.47, 0.18, Math.PI / 2);
  }
  return {
    root: R.build(),
    mats: () => ({
      flesh: flesh(0x9a8c90, 0xff2a10, 0xff3020),
      bone: bone(0xd8ccb8, 0xff3020),
      heart: glow(0xff3010, 7),
      eye: glow(0xff2a14, 8),
      socket: std(0x050304, 1, 0),
    }),
    flash: ['flesh', 'bone'],
    glowKey: 'eye',
    parts: (r) => ({
      body: r.getObjectByName('body'),
      torso: r.getObjectByName('torso'),
      head: r.getObjectByName('head'),
      jaw: r.getObjectByName('jaw'),
      arms: [{ sh: r.getObjectByName('shL'), el: r.getObjectByName('elL') }, { sh: r.getObjectByName('shR'), el: r.getObjectByName('elR') }],
      legs: [{ hip: r.getObjectByName('hipL'), knee: r.getObjectByName('kneeL') }, { hip: r.getObjectByName('hipR'), knee: r.getObjectByName('kneeR') }],
    }),
    hit: [
      { p: new THREE.Vector3(0, 1.37, 0.15), r: 0.42 },
      { p: new THREE.Vector3(0, 1.69, 0.4), r: 0.24, crit: true },
      { p: new THREE.Vector3(0, 0.55, 0), r: 0.32 },
    ],
  };
}

// --- Stalker: an armoured, six-legged hunter -----------------------------------------------
function stalker() {
  const R = new Rig();
  const body = R.pivot(null, 'body', 0, 0.72, 0);
  R.add(body, 'flesh', organic(SPH(0.33), 0.02, 12, 1), 0, -0.04, 0, 0, 0, 0, 0.95, 0.62, 1.35);
  for (let k = 0; k < 4; k++) {
    const z = 0.32 - k * 0.2;
    R.add(body, 'chitin', SHELL(0.3 - k * 0.012, 0, Math.PI * 2, 0, 1.05), 0, 0.02 + Math.sin(k) * 0.01, z, -0.25, 0, 0, 1.05, 0.75, 0.8);
    R.add(body, 'chitin', CONE(0.025, 0.2, 8), 0, 0.22, z - 0.03, -0.55);
  }
  const segR = [0.29, 0.26, 0.21, 0.14];
  segR.forEach((r, k) => {
    const z = -0.48 - k * 0.2 - (k > 1 ? 0.04 : 0);
    R.add(body, k % 2 ? 'flesh' : 'chitin', organic(SPH(r), 0.01, 18, k), 0, 0.08 + k * 0.02, z, 0, 0, 0, 1, 0.8, 0.85);
  });
  R.pair(body, 'glow', SPH(0.045), 0.17, 0.12, -0.6);
  R.pair(body, 'glow', SPH(0.035), 0.15, 0.12, -0.82);
  R.add(body, 'chitin', CONE(0.05, 0.3, 10), 0, 0.18, -1.2, -2.3);

  const head = R.pivot(body, 'head', 0, 0.05, 0.55);
  R.add(head, 'chitin', organic(SPH(0.17), 0.01, 20, 3), 0, 0, 0, 0, 0, 0, 1.05, 0.8, 1.2);
  R.add(head, 'chitin', SHELL(0.19, 0, Math.PI * 2, 0, 0.9), 0, 0.02, -0.02, -0.3, 0, 0, 1.1, 0.8, 1.2);
  for (const [x, y, z, r] of [[0.06, 0.06, 0.16, 0.03], [0.11, 0.02, 0.13, 0.025], [0.12, -0.03, 0.09, 0.02]]) {
    R.pair(head, 'glow', SPH(r), x, y, z);
  }
  for (const sx of [-1, 1]) {
    R.add(head, 'chitin', CAP(0.022, 0.16), sx * 0.07, -0.08, 0.17, 1.2, 0, -sx * 0.4);
    R.add(head, 'bone', CONE(0.018, 0.14, 8), sx * 0.04, -0.1, 0.27, 1.9, 0, sx * 0.6);
    R.add(head, 'chitin', CAP(0.007, 0.55), sx * 0.06, 0.2, 0.3, -0.7, 0, -sx * 0.35);
  }

  const legs = [];
  const zs = [0.35, 0, -0.35];
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    const hip = R.pivot(body, 'hip' + i, side * 0.25, 0, zs[i % 3]);
    hip.rotation.y = side * (zs[i % 3] * 0.8);
    const up = R.pivot(hip, 'up' + i);
    up.rotation.z = side * -0.9;
    R.add(up, 'chitin', SPH(0.055), 0, 0, 0);
    R.add(up, 'chitin', organic(CAP(0.04, 0.66), 0.006, 30, i), side * 0.3, 0, 0, 0, 0, Math.PI / 2);
    R.add(up, 'bone', CONE(0.012, 0.09, 6), side * 0.32, 0.04, 0, 0, 0, -side * 0.6);
    R.add(up, 'bone', CONE(0.01, 0.07, 6), side * 0.45, 0.035, 0, 0, 0, -side * 0.6);
    const knee = R.pivot(up, 'kn' + i, side * 0.6, 0, 0);
    knee.rotation.z = side * 2.0;
    R.add(knee, 'chitin', SPH(0.04), 0, 0, 0);
    R.add(knee, 'chitin', CYL(0.03, 0.007, 0.85, 10), side * 0.42, 0, 0, 0, 0, Math.PI / 2);
    R.add(knee, 'bone', CONE(0.009, 0.08, 6), side * 0.86, 0, 0, 0, 0, -side * Math.PI / 2);
    legs.push(i);
  }
  return {
    root: R.build(),
    mats: () => ({
      chitin: chitin(0x8a7e8a, 0xff30d0),
      flesh: flesh(0x9a7a90, 0xff20c0, 0xff30d0),
      bone: bone(0xd8d0c0, 0xff30d0),
      glow: glow(0xff2bd6, 7),
    }),
    flash: ['chitin', 'flesh'],
    glowKey: 'glow',
    parts: (r) => ({
      body: r.getObjectByName('body'),
      head: r.getObjectByName('head'),
      legs: [0, 1, 2, 3, 4, 5].map((i) => ({
        hip: r.getObjectByName('hip' + i),
        up: r.getObjectByName('up' + i),
        phase: (i % 2) * Math.PI + (i % 3) * 0.5,
        side: i < 3 ? -1 : 1,
      })),
    }),
    hit: [
      { p: new THREE.Vector3(0, 0.72, 0), r: 0.5 },
      { p: new THREE.Vector3(0, 0.75, 0.6), r: 0.24, crit: true },
      { p: new THREE.Vector3(0, 0.8, -0.6), r: 0.38 },
    ],
  };
}

// --- Wisp: a caged, hovering lantern-construct ----------------------------------------------
function wisp() {
  const R = new Rig();
  const core = R.pivot(null, 'core');
  R.add(core, 'glow', SPH(0.17, 24, 16));
  R.add(core, 'hot', SPH(0.09));
  for (let k = 0; k < 4; k++) {
    R.add(core, 'metal', SHELL(0.3, (k / 4) * Math.PI * 2 + 0.18, Math.PI / 2 - 0.36, 0.35, 2.4, 12, 10));
    R.add(core, 'metal', CAP(0.018, 0.5), Math.cos((k / 4) * Math.PI * 2 + Math.PI / 4) * 0.305, 0, -Math.sin((k / 4) * Math.PI * 2 + Math.PI / 4) * 0.305);
  }
  R.add(core, 'metal', CYL(0.08, 0.05, 0.08, 16), 0, 0.3, 0);
  R.add(core, 'metal', CYL(0.05, 0.08, 0.08, 16), 0, -0.3, 0);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const p = R.pivot(null, 'ring' + i);
    const rr = 0.5 + i * 0.09;
    R.add(p, 'metal', TOR(rr, 0.022, 8, 64));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      R.add(p, k % 4 === 0 ? 'glow' : 'metal', k % 4 === 0 ? SPH(0.03) : BOX(0.05, 0.06, 0.07, 0.01), Math.cos(a) * rr, Math.sin(a) * rr, 0, 0, 0, a);
    }
    rings.push(i);
  }
  for (let i = 0; i < 4; i++) {
    const s = R.pivot(null, 'shard' + i);
    R.add(s, 'metal', memo('wispShard', () => new THREE.OctahedronGeometry(0.1, 0)), 0, 0, 0, 0, 0, 0, 0.5, 2.0, 0.25);
  }
  const tail = R.pivot(null, 'tail', 0, -0.35, 0);
  for (let t = 0; t < 3; t++) {
    const a = (t / 3) * Math.PI * 2;
    for (let k = 0; k < 6; k++) {
      const r = 0.045 - k * 0.006;
      R.add(tail, k === 5 ? 'glow' : 'metal', SPH(r, 12, 8), Math.cos(a) * (0.06 + k * 0.03), -k * 0.1, Math.sin(a) * (0.06 + k * 0.03));
    }
  }
  return {
    root: R.build(),
    mats: () => ({
      metal: armour('metal', 0xc8c0e0, 0xa060ff),
      glow: glow(0xa060ff, 7),
      hot: glow(0xe8d8ff, 10),
    }),
    flash: ['metal'],
    glowKey: 'glow',
    parts: (r) => ({
      core: r.getObjectByName('core'),
      rings: [0, 1, 2].map((i) => {
        const p = r.getObjectByName('ring' + i);
        p.rotation.set(Math.random() * 3, Math.random() * 3, 0);
        return p;
      }),
      shards: [0, 1, 2, 3].map((i) => r.getObjectByName('shard' + i)),
      tail: r.getObjectByName('tail'),
    }),
    hit: [
      { p: new THREE.Vector3(0, 0, 0), r: 0.62 },
      { p: new THREE.Vector3(0, 0, 0), r: 0.3, crit: true },
    ],
  };
}

// --- Brute: a furnace-hearted armoured colossus ----------------------------------------------
function rivets(R, pivot, key, x0, x1, y, z, n, rx = 0) {
  for (let k = 0; k < n; k++) R.add(pivot, key, SPH(0.022, 8, 6), x0 + ((x1 - x0) * k) / Math.max(1, n - 1), y, z, rx);
}

function brute() {
  const R = new Rig();
  for (const sx of [-1, 1]) {
    const hip = R.pivot(null, sx < 0 ? 'hipL' : 'hipR', sx * 0.45, 1.1, 0);
    R.add(hip, 'flesh', organic(CAP(0.26, 0.75), 0.03, 7, sx + 2), 0, -0.3, 0);
    R.add(hip, 'armour', BOX(0.42, 0.42, 0.08, 0.03), 0, -0.25, 0.25, 0.1);
    rivets(R, hip, 'iron', -0.15, 0.15, -0.07, 0.3, 3);
    const knee = R.pivot(hip, sx < 0 ? 'kneeL' : 'kneeR', 0, -0.6, 0);
    R.add(knee, 'armour', SHELL(0.2, 0, Math.PI * 2, 0, 1.6), 0, 0.02, 0.12, Math.PI / 2 - 0.2);
    R.add(knee, 'armour', BOX(0.44, 0.5, 0.46, 0.08), 0, -0.25, 0.02);
    rivets(R, knee, 'iron', -0.16, 0.16, -0.06, 0.26, 4);
    rivets(R, knee, 'iron', -0.16, 0.16, -0.42, 0.26, 4);
    R.add(knee, 'armour', BOX(0.54, 0.16, 0.74, 0.05), 0, -0.45, 0.1);
    for (let t = -1; t <= 1; t++) R.add(knee, 'iron', CONE(0.04, 0.12, 8), t * 0.16, -0.48, 0.5, Math.PI / 2);
  }
  const torso = R.pivot(null, 'torso', 0, 1.2, 0);
  torso.rotation.x = 0.3;
  R.add(torso, 'flesh', organic(SPH(0.62, 28, 20), 0.035, 6, 3), 0, 0.45, 0.02, 0, 0, 0, 1.2, 1.0, 0.85);
  R.pair(torso, 'flesh', organic(SPH(0.38), 0.025, 8, 4), 0.33, 0.85, 0.2, 0, 0, 0, 1.1, 0.85, 0.8);
  R.add(torso, 'flesh', organic(SPH(0.45), 0.03, 7, 5), 0, 1.15, -0.05, 0, 0, 0, 1.6, 0.6, 1);
  // Back armour and boiler tank
  R.add(torso, 'armour', BOX(1.35, 1.0, 0.22, 0.08), 0, 0.85, -0.45, -0.1);
  rivets(R, torso, 'iron', -0.55, 0.55, 1.28, -0.56, 7);
  rivets(R, torso, 'iron', -0.55, 0.55, 0.42, -0.53, 7);
  R.add(torso, 'armour', CYL(0.24, 0.24, 1.05, 24), 0, 1.25, -0.72, 0, 0, Math.PI / 2);
  for (const x of [-0.4, 0, 0.4]) R.add(torso, 'iron', TOR(0.25, 0.025, 6, 32), x, 1.25, -0.72, 0, Math.PI / 2, 0);
  for (const x of [-0.3, 0.3]) {
    R.add(torso, 'iron', CYL(0.07, 0.08, 0.6, 14), x, 1.6, -0.78, -0.2);
    R.add(torso, 'ember', CYL(0.055, 0.055, 0.03, 14), x, 1.9, -0.84, -0.2);
  }
  // Chest furnace: riveted frame, grille bars, molten glow
  R.add(torso, 'armour', BOX(0.66, 0.5, 0.16, 0.04), 0, 0.6, 0.48);
  R.add(torso, 'ember', BOX(0.5, 0.34, 0.05, 0.01), 0, 0.6, 0.53);
  for (let k = -2; k <= 2; k++) R.add(torso, 'iron', CYL(0.016, 0.016, 0.36, 8), k * 0.09, 0.6, 0.57);
  rivets(R, torso, 'iron', -0.28, 0.28, 0.83, 0.57, 5);
  rivets(R, torso, 'iron', -0.28, 0.28, 0.37, 0.57, 5);
  for (const sx of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.33, 0.6, 0.5), new THREE.Vector3(sx * 0.62, 0.7, 0.3),
      new THREE.Vector3(sx * 0.68, 1.0, -0.3), new THREE.Vector3(sx * 0.5, 1.2, -0.62),
    ]);
    R.add(torso, 'iron', memo('brutePipe' + sx, () => new THREE.TubeGeometry(path, 24, 0.045, 10, false)));
  }
  // Pauldrons with spikes
  for (const sx of [-1, 1]) {
    R.add(torso, 'armour', SHELL(0.42, 0, Math.PI * 2, 0, 1.45), sx * 0.92, 1.18, 0, 0, 0, sx * 0.35, 1, 0.8, 1.05);
    for (let k = 0; k < 3; k++) R.add(torso, 'iron', CONE(0.06, 0.32, 10), sx * (0.85 + k * 0.08), 1.5 - k * 0.04, -0.1 + k * 0.12, -0.2, 0, -sx * (0.3 + k * 0.15));
    rivets(R, torso, 'iron', sx * 0.65, sx * 1.15, 1.0, 0.38, 4);
  }
  const head = R.pivot(torso, 'head', 0, 1.32, 0.34);
  R.add(head, 'flesh', organic(SPH(0.22), 0.015, 12, 6), 0, -0.02, 0.02, 0, 0, 0, 1.05, 0.95, 1.05);
  R.add(head, 'armour', SHELL(0.25, 0, Math.PI * 2, 0, 1.3), 0, 0.02, 0, -0.15, 0, 0, 1.0, 0.95, 1.1);
  R.add(head, 'armour', BOX(0.36, 0.2, 0.06, 0.02), 0, -0.02, 0.22);
  R.add(head, 'ember', BOX(0.26, 0.03, 0.02, 0.008), 0, 0.02, 0.255);
  R.pair(head, 'bone', CONE(0.035, 0.22, 10), 0.13, -0.15, 0.22, -1.0, 0, 0.3);

  for (const sx of [-1, 1]) {
    const sh = R.pivot(torso, sx < 0 ? 'shL' : 'shR', sx * 1.0, 1.05, 0.05);
    R.add(sh, 'flesh', organic(SPH(0.28), 0.02, 9, 7 + sx), 0, -0.05, 0);
    R.add(sh, 'flesh', organic(CAP(0.22, 0.9), 0.025, 8, 8 + sx), 0, -0.42, 0);
    const el = R.pivot(sh, sx < 0 ? 'elL' : 'elR', 0, -0.8, 0);
    R.add(el, 'armour', BOX(0.5, 0.75, 0.5, 0.08), 0, -0.38, 0);
    R.add(el, 'ember', BOX(0.52, 0.06, 0.52, 0.02), 0, -0.68, 0);
    rivets(R, el, 'iron', -0.18, 0.18, -0.08, 0.26, 4);
    for (let k = 0; k < 7; k++) {
      const y = -0.15 - k * 0.075;
      R.add(el, 'iron', TOR(0.05, 0.016, 6, 12), Math.sin(k * 2) * 0.27, y, Math.cos(k * 2) * 0.27, 0, k * 2, k % 2 ? Math.PI / 2 : 0);
    }
    R.add(el, 'flesh', organic(BOX(0.56, 0.46, 0.56, 0.18), 0.02, 10, 9), 0, -0.95, 0.02);
    for (let k = 0; k < 4; k++) R.add(el, 'armour', BOX(0.12, 0.1, 0.14, 0.03), -0.18 + k * 0.12, -1.12, 0.22);
  }
  return {
    root: R.build(),
    mats: () => ({
      flesh: flesh(0xa07868, 0xff6010, 0xff6a1a),
      armour: armour('rustRed', 0xffffff, 0xff6a1a),
      iron: armour('metal', 0xffffff, 0xff6a1a),
      bone: bone(0xe0d4c0, 0xff6a1a),
      ember: glow(0xff7a1a, 6),
    }),
    flash: ['flesh', 'armour'],
    glowKey: 'ember',
    parts: (r) => ({
      torso: r.getObjectByName('torso'),
      head: r.getObjectByName('head'),
      legs: [{ hip: r.getObjectByName('hipL'), knee: r.getObjectByName('kneeL') }, { hip: r.getObjectByName('hipR'), knee: r.getObjectByName('kneeR') }],
      arms: [{ sh: r.getObjectByName('shL'), el: r.getObjectByName('elL') }, { sh: r.getObjectByName('shR'), el: r.getObjectByName('elR') }],
    }),
    hit: [
      { p: new THREE.Vector3(0, 2.0, 0.15), r: 0.95 },
      { p: new THREE.Vector3(0, 2.7, 0.7), r: 0.33, crit: true },
      { p: new THREE.Vector3(0, 0.8, 0), r: 0.6 },
    ],
  };
}

// --- The Warden: robed keeper of the gates ----------------------------------------------------
function tatteredRobe() {
  return memo('wardenRobe', () => {
    const g = new THREE.CylinderGeometry(0.7, 2.0, 3.8, 64, 14, true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const t = (1.9 - y) / 3.8; // 0 top .. 1 hem
      const fold = 1 + (0.07 * Math.sin(a * 9) + 0.04 * Math.sin(a * 17 + 1)) * t;
      x *= fold;
      z *= fold;
      if (t > 0.98) y += Math.max(0, Math.sin(a * 7) * 0.35 + Math.sin(a * 23) * 0.2 + Math.sin(a * 41) * 0.15);
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  });
}

function warden() {
  const R = new Rig();
  const robe = R.pivot(null, 'robe', 0, 2.0, 0);
  R.add(robe, 'cloth', tatteredRobe());
  R.add(robe, 'clothDark', tatteredRobe(), 0, 0.1, 0, 0, 0.3, 0, 0.85, 0.97, 0.85);
  R.add(robe, 'armour', TOR(0.78, 0.07, 8, 48), 0, 1.75, 0, Math.PI / 2);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    R.add(robe, 'armour', BOX(0.06, 1.1, 0.04, 0.015), Math.cos(a) * 0.86, 1.25, Math.sin(a) * 0.86, 0, -a, 0.12);
  }

  const chest = R.pivot(null, 'chest', 0, 4.3, 0);
  R.add(chest, 'armour', organic(BOX(1.6, 1.25, 0.9, 0.35), 0.02, 4, 2));
  for (let k = 0; k < 3; k++) R.add(chest, 'armour', TOR(0.62 - k * 0.1, 0.035, 6, 32, Math.PI), 0, 0.1 - k * 0.22, 0.42, 0, 0, Math.PI);
  R.add(chest, 'glow', BOX(0.12, 0.85, 0.05, 0.02), 0, -0.1, 0.47);
  R.add(chest, 'armour', TOR(0.42, 0.08, 10, 32), 0, 0.68, 0.0, Math.PI / 2);
  for (let k = 0; k < 5; k++) R.add(chest, 'armour', CONE(0.05, 0.3, 10), 0, 0.45 - k * 0.22, -0.48, -1.9);
  // Hood with crown of spikes
  R.add(chest, 'cloth', organic(CONE(0.95, 1.8, 32), 0.03, 6, 4), 0, 1.3, -0.05);
  for (let k = 0; k < 7; k++) {
    const a = (k / 6 - 0.5) * 2.2;
    R.add(chest, 'armour', CONE(0.045, 0.5 + (k === 3 ? 0.25 : 0), 10), Math.sin(a) * 0.55, 1.65, Math.cos(a) * 0.4 - 0.05, -0.2 * Math.cos(a), 0, -0.35 * Math.sin(a));
    R.add(chest, 'glow', SPH(0.03), Math.sin(a) * 0.6, 1.92 + (k === 3 ? 0.25 : 0), Math.cos(a) * 0.4 - 0.08);
  }
  // Mask around the great eye
  R.add(chest, 'armour', SHELL(0.62, -Math.PI / 2 - 1.1, 2.2, 0.35, 2.3), 0, 0.95, 0.12, 0, Math.PI, 0);
  R.add(chest, 'eyeWhite', SPH(0.46, 24, 16), 0, 0.95, 0.42);
  const iris = R.pivot(chest, 'iris', 0, 0.95, 0.83);
  R.add(iris, 'iris', SPH(0.19, 20, 14));

  const halo = R.pivot(chest, 'halo', 0, 1.2, -0.7);
  R.add(halo, 'glow', TOR(2.3, 0.04, 8, 96));
  R.add(halo, 'armour', TOR(2.45, 0.06, 8, 96));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    R.add(halo, 'armour', BLADE(0.95, 0.18), Math.cos(a) * 2.45, Math.sin(a) * 2.45, 0, 0, 0, a - Math.PI / 2);
    R.add(halo, 'glow', SPH(0.05), Math.cos(a) * 2.45, Math.sin(a) * 2.45, 0.04);
  }

  for (const sx of [-1, 1]) {
    const sh = R.pivot(chest, sx < 0 ? 'shL' : 'shR', sx * 1.0, 0.35, 0);
    sh.rotation.z = sx * 0.4;
    R.add(sh, 'armour', SHELL(0.36, 0, Math.PI * 2, 0, 1.5), 0, 0.05, 0, 0, 0, 0, 1, 0.8, 1);
    R.add(sh, 'armour', BOX(0.3, 1.4, 0.3, 0.1), 0, -0.7, 0);
    for (let k = 0; k < 4; k++) R.add(sh, 'iron', TOR(0.2, 0.025, 6, 24), 0, -0.25 - k * 0.3, 0, Math.PI / 2);
    const el = R.pivot(sh, sx < 0 ? 'elL' : 'elR', 0, -1.4, 0);
    R.add(el, 'cloth', CYL(0.15, 0.3, 1.1, 20), 0, -0.55, 0);
    R.add(el, 'armour', BLADE(2.1, 0.45), 0, -0.9, 0.1, Math.PI, 0, 0);
    R.add(el, 'glow', BOX(0.03, 1.6, 0.03, 0.01), 0.08, -1.95, 0.16, 0, 0, 0.12);
    for (let f = -1; f <= 1; f++) R.add(el, 'iron', CONE(0.035, 0.3, 8), f * 0.08, -1.18, 0.12, Math.PI + 0.3);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = R.pivot(null, 'tendril' + i, Math.cos(a) * 1.6, 0.2, Math.sin(a) * 1.6);
    for (let k = 0; k < 6; k++) R.add(p, k === 5 ? 'glow' : 'cloth', SPH(0.08 - k * 0.011, 12, 8), 0, -k * 0.3, 0);
  }
  return {
    root: R.build(),
    mats: () => ({
      cloth: cloth(0xb07070, 0xff2a20),
      clothDark: cloth(0x503838, 0xff2a20),
      armour: armour('metal', 0xd8d0d8, 0xff4030),
      iron: armour('rustRed', 0xffffff, 0xff4030),
      glow: glow(0xff3030, 4),
      eyeWhite: glow(0xffd0c0, 2.2),
      iris: glow(0xff2010, 6),
    }),
    flash: ['armour', 'cloth'],
    glowKey: 'glow',
    parts: (r) => ({
      robe: r.getObjectByName('robe'),
      chest: r.getObjectByName('chest'),
      iris: r.getObjectByName('iris').children[0],
      irisPivot: r.getObjectByName('iris'),
      halo: r.getObjectByName('halo'),
      arms: [{ sh: r.getObjectByName('shL'), el: r.getObjectByName('elL') }, { sh: r.getObjectByName('shR'), el: r.getObjectByName('elR') }],
      tendrils: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => r.getObjectByName('tendril' + i)),
    }),
    hit: [
      { p: new THREE.Vector3(0, 5.25, 0.6), r: 0.65, crit: true },
      { p: new THREE.Vector3(0, 4.3, 0), r: 1.25 },
      { p: new THREE.Vector3(0, 2.2, 0), r: 1.5 },
    ],
  };
}

const DEFS = { husk, stalker, wisp, brute, warden };
const templates = {};

// Returns { root, parts, mats (flashable), eye (glow material), hit }.
export function createEnemyModel(type) {
  if (!templates[type]) templates[type] = DEFS[type]();
  const T = templates[type];
  const root = T.root.clone(true);
  const mats = T.mats();
  root.traverse((o) => {
    if (o.isMesh && o.userData.key) o.material = mats[o.userData.key];
  });
  return {
    root,
    parts: T.parts(root),
    mats: T.flash.map((k) => mats[k]),
    eye: mats[T.glowKey],
    hit: T.hit,
  };
}

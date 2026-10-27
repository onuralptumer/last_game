// Enemy roster: procedural models, behaviours, projectiles and hazards.

import * as THREE from 'three';
import { resolveActor, groundHeight, raycastWorld, ARENA_RADIUS } from './physics.js';
import { glowTexture } from './textures.js';
import { rbox, capsule, pebble } from './shapes.js';

export const ENEMY_TYPES = {
  husk: { name: 'Husk', hp: 55, speed: 4.4, radius: 0.45, height: 1.9, damage: 12, shards: 2, score: 100, glow: 0xff2a14, mass: 1 },
  stalker: { name: 'Stalker', hp: 34, speed: 8.2, radius: 0.5, height: 1.0, damage: 9, shards: 2, score: 120, glow: 0xff2bd6, mass: 0.8 },
  wisp: { name: 'Wisp', hp: 48, speed: 5.5, radius: 0.55, height: 1.0, damage: 13, shards: 3, score: 150, glow: 0xa060ff, mass: 0.7, flying: true },
  brute: { name: 'Brute', hp: 430, speed: 2.9, radius: 1.1, height: 3.2, damage: 30, shards: 12, score: 500, glow: 0xff7a1a, mass: 6 },
  warden: { name: 'The Warden', hp: 4200, speed: 3.2, radius: 2.0, height: 7, damage: 18, shards: 90, score: 5000, glow: 0xff3030, mass: 50, flying: true, boss: true },
};

// --- geometry cache ---------------------------------------------------------------------
const geoCache = new Map();
function geo(key, fn) {
  if (!geoCache.has(key)) geoCache.set(key, fn());
  return geoCache.get(key);
}
// All enemy parts are soft, smooth forms: rounded boxes, capsules, high-segment curves.
const BOX = (w, h, d, r = null) => geo(`b${w},${h},${d},${r}`, () => rbox(w, h, d, r === null ? Math.min(w, h, d) * 0.32 : r, 3));
const CYL = (rt, rb, h, s = 8) => geo(`c${rt},${rb},${h}`, () => new THREE.CylinderGeometry(rt, rb, h, Math.max(16, s * 2)));
const LIMB = (r, len) => geo(`l${r},${len}`, () => capsule(r, len, 14));
const SPH = (r, w = 12, h = 8) => geo(`s${r}`, () => new THREE.SphereGeometry(r, Math.max(24, w), Math.max(16, h)));
const ICO = (r, d = 0) => geo(`i${r}`, () => new THREE.IcosahedronGeometry(r, Math.max(3, d)));
const CONE = (r, h, s = 6) => geo(`k${r},${h}`, () => new THREE.ConeGeometry(r, h, Math.max(16, s * 2)));
const TOR = (r, t, rs = 6, ts = 32) => geo(`t${r},${t}`, () => new THREE.TorusGeometry(r, t, Math.max(12, rs), Math.max(64, ts)));

function add(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Standard material plus a fresnel rim glow so silhouettes stay readable in the dark.
function skinMat(color, rough = 0.55, metal = 0.25, rim = 0xff3020, rimStrength = 0.7) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: 0x000000 });
  const uRim = { value: new THREE.Color(rim).multiplyScalar(rimStrength) };
  m.userData.rim = uRim;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = uRim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n{ float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); totalEmissiveRadiance += uRim * pow(rimF, 4.0) * 0.85; }'
      );
  };
  m.customProgramCacheKey = () => 'enemy-rim';
  return m;
}
function glowMat(color, intensity = 5) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
}

function buildHusk() {
  const root = new THREE.Group();
  const skin = skinMat(0x2a272d, 0.55, 0.25, 0xff3020, 0.9);
  const bone = skinMat(0x5a534c, 0.7, 0.1, 0xff3020, 0.5);
  const glow = glowMat(0xff2a14, 6);
  const body = pivot(root, 0, 0.95, 0);
  add(body, BOX(0.38, 0.22, 0.24, 0.1), skin);
  const torso = pivot(body, 0, 0.1, 0);
  torso.rotation.x = 0.45;
  add(torso, BOX(0.5, 0.6, 0.32, 0.15), skin, 0, 0.35, 0);
  add(torso, SPH(0.08, 8, 6), glow, 0, 0.38, 0.16);
  for (let i = 0; i < 3; i++) {
    const s = add(torso, CONE(0.05, 0.22, 4), bone, 0, 0.2 + i * 0.18, -0.2);
    s.rotation.x = -1.1;
  }
  const head = pivot(torso, 0, 0.75, 0.08);
  const skull = add(head, ICO(0.19, 0), skin);
  skull.scale.set(1, 1.1, 1.25);
  add(head, SPH(0.032, 6, 4), glow, -0.075, 0.03, 0.19);
  add(head, SPH(0.032, 6, 4), glow, 0.075, 0.03, 0.19);
  const jaw = add(head, BOX(0.17, 0.06, 0.16), bone, 0, -0.14, 0.09);
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = pivot(torso, sx * 0.33, 0.55, 0);
    add(sh, LIMB(0.06, 0.56), skin, 0, -0.25, 0);
    const el = pivot(sh, 0, -0.5, 0);
    add(el, LIMB(0.045, 0.58), skin, 0, -0.27, 0);
    for (let c = -1; c <= 1; c++) {
      const claw = add(el, CONE(0.02, 0.22, 4), bone, c * 0.035, -0.62, 0.02);
      claw.rotation.x = Math.PI;
    }
    arms.push({ sh, el });
  }
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = pivot(body, sx * 0.14, -0.05, 0);
    add(hip, LIMB(0.075, 0.55), skin, 0, -0.24, 0);
    const knee = pivot(hip, 0, -0.48, 0);
    add(knee, LIMB(0.055, 0.52), skin, 0, -0.23, 0);
    legs.push({ hip, knee });
  }
  return {
    root, parts: { body, torso, head, jaw, arms, legs }, mats: [skin], eye: glow,
    hit: [
      { p: new THREE.Vector3(0, 1.37, 0.15), r: 0.42 },
      { p: new THREE.Vector3(0, 1.69, 0.4), r: 0.24, crit: true },
      { p: new THREE.Vector3(0, 0.55, 0), r: 0.32 },
    ],
  };
}

function buildStalker() {
  const root = new THREE.Group();
  const bone = skinMat(0x6e655c, 0.6, 0.15, 0xff30d0, 0.6);
  const dark = skinMat(0x241f26, 0.55, 0.25, 0xff30d0, 0.9);
  const glow = glowMat(0xff2bd6, 6);
  const body = pivot(root, 0, 0.72, 0);
  const thorax = add(body, SPH(0.35, 10, 8), bone);
  thorax.scale.set(1, 0.7, 1.4);
  const abd = add(body, SPH(0.32, 10, 8), dark, 0, 0.1, -0.62);
  abd.scale.set(1, 0.85, 1.2);
  add(body, SPH(0.07, 6, 4), glow, 0, 0.25, -0.62);
  const head = pivot(body, 0, 0.05, 0.55);
  add(head, SPH(0.18, 8, 6), dark);
  for (const [x, y] of [[-0.07, 0.06], [0.07, 0.06], [-0.11, -0.01], [0.11, -0.01]]) add(head, SPH(0.03, 6, 4), glow, x, y, 0.15);
  for (const sx of [-1, 1]) {
    const m = add(head, CONE(0.03, 0.22, 4), bone, sx * 0.07, -0.1, 0.18);
    m.rotation.x = 1.9;
  }
  const legs = [];
  const zs = [0.35, 0, -0.35];
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    const hip = pivot(body, side * 0.25, 0, zs[i % 3]);
    hip.rotation.y = side * (zs[i % 3] * 0.8);
    const up = pivot(hip, 0, 0, 0);
    up.rotation.z = side * -0.9;
    const u = add(up, LIMB(0.035, 0.66), bone, side * 0.3, 0, 0);
    u.rotation.z = Math.PI / 2;
    const knee = pivot(up, side * 0.6, 0, 0);
    knee.rotation.z = side * 2.0;
    const l = add(knee, CYL(0.03, 0.008, 0.85), dark, side * 0.42, 0, 0);
    l.rotation.z = Math.PI / 2;
    legs.push({ hip, up, phase: (i % 2) * Math.PI + (i % 3) * 0.5, side });
  }
  return {
    root, parts: { body, head, legs }, mats: [bone, dark], eye: glow,
    hit: [
      { p: new THREE.Vector3(0, 0.72, 0), r: 0.5 },
      { p: new THREE.Vector3(0, 0.75, 0.6), r: 0.24, crit: true },
      { p: new THREE.Vector3(0, 0.8, -0.6), r: 0.38 },
    ],
  };
}

function buildWisp() {
  const root = new THREE.Group();
  const metal = skinMat(0x3a3646, 0.35, 0.8, 0xa060ff, 0.9);
  const glow = glowMat(0xa060ff, 7);
  const core = add(root, ICO(0.28, 1), glow);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = add(root, TOR(0.5 + i * 0.08, 0.025, 4, 28), metal);
    r.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    rings.push(r);
  }
  const shards = [];
  for (let i = 0; i < 4; i++) {
    const s = add(root, CONE(0.07, 0.35, 4), metal);
    shards.push(s);
  }
  const tail = add(root, CONE(0.14, 0.7, 6), metal, 0, -0.55, 0);
  tail.rotation.x = Math.PI;
  return {
    root, parts: { core, rings, shards, tail }, mats: [metal], eye: glow,
    hit: [
      { p: new THREE.Vector3(0, 0, 0), r: 0.62 },
      { p: new THREE.Vector3(0, 0, 0), r: 0.3, crit: true },
    ],
  };
}

function buildBrute() {
  const root = new THREE.Group();
  const skin = skinMat(0x3a2620, 0.6, 0.2, 0xff6a1a, 0.8);
  const plate = skinMat(0x3a3d44, 0.35, 0.85, 0xff6a1a, 0.6);
  const glow = glowMat(0xff7a1a, 6);
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = pivot(root, sx * 0.45, 1.1, 0);
    add(hip, BOX(0.45, 0.6, 0.5), skin, 0, -0.3, 0);
    const knee = pivot(hip, 0, -0.6, 0);
    add(knee, BOX(0.42, 0.5, 0.45), plate, 0, -0.25, 0.02);
    add(knee, BOX(0.5, 0.15, 0.7), plate, 0, -0.45, 0.1);
    legs.push({ hip, knee });
  }
  const torso = pivot(root, 0, 1.2, 0);
  torso.rotation.x = 0.3;
  add(torso, BOX(1.5, 1.2, 1.0), skin, 0, 0.65, 0);
  add(torso, BOX(1.2, 0.5, 0.3), plate, 0, 0.95, 0.45);
  add(torso, BOX(0.55, 0.38, 0.12), glow, 0, 0.5, 0.5);
  for (let i = 0; i < 4; i++) add(torso, BOX(0.06, 0.4, 0.05), plate, -0.2 + i * 0.13, 0.5, 0.57);
  for (const sx of [-1, 1]) add(torso, BOX(0.7, 0.32, 0.85), plate, sx * 0.9, 1.25, 0);
  const head = pivot(torso, 0, 1.35, 0.32);
  add(head, BOX(0.42, 0.36, 0.45), plate);
  add(head, BOX(0.3, 0.05, 0.02), glow, 0, 0.02, 0.23);
  for (let i = 0; i < 3; i++) {
    const s = add(torso, CONE(0.1, 0.45, 4), plate, -0.4 + i * 0.4, 1.35, -0.4);
    s.rotation.x = -0.7;
  }
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = pivot(torso, sx * 1.0, 1.05, 0.05);
    add(sh, BOX(0.4, 0.8, 0.4), skin, 0, -0.4, 0);
    const el = pivot(sh, 0, -0.8, 0);
    add(el, BOX(0.5, 0.75, 0.5), plate, 0, -0.38, 0);
    add(el, BOX(0.62, 0.5, 0.62), skin, 0, -0.95, 0.02);
    add(el, BOX(0.64, 0.08, 0.64), glow, 0, -0.75, 0.02);
    arms.push({ sh, el });
  }
  return {
    root, parts: { torso, head, legs, arms }, mats: [skin, plate], eye: glow,
    hit: [
      { p: new THREE.Vector3(0, 2.0, 0.15), r: 0.95 },
      { p: new THREE.Vector3(0, 2.7, 0.7), r: 0.33, crit: true },
      { p: new THREE.Vector3(0, 0.8, 0), r: 0.6 },
    ],
  };
}

function buildWarden() {
  const root = new THREE.Group();
  const cloth = skinMat(0x1d171d, 0.9, 0.0, 0xff2a20, 1.1);
  cloth.side = THREE.DoubleSide;
  const plate = skinMat(0x45434c, 0.3, 0.9, 0xff4030, 0.9);
  const glow = glowMat(0xff3030, 6);
  const eyeMat = glowMat(0xffd0c0, 2.2);
  const robe = add(root, geo('wardenRobe', () => new THREE.CylinderGeometry(0.7, 2.0, 3.8, 40, 6, true)), cloth, 0, 2.0, 0);
  const chest = pivot(root, 0, 4.3, 0);
  add(chest, BOX(1.6, 1.2, 0.9), plate);
  add(chest, BOX(0.2, 0.9, 0.05), glow, 0, -0.1, 0.46);
  const hood = add(chest, CONE(0.95, 1.8, 6), cloth, 0, 1.3, -0.05);
  const eye = add(chest, SPH(0.48, 16, 12), eyeMat, 0, 0.95, 0.5);
  const iris = add(chest, SPH(0.2, 10, 8), glowMat(0xff2010, 6), 0, 0.95, 0.85);
  const halo = pivot(chest, 0, 1.2, -0.7);
  add(halo, TOR(2.3, 0.05, 6, 64), glowMat(0xff3030, 2.5));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = add(halo, BOX(0.12, 0.9, 0.06), plate, Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0);
    b.rotation.z = a - Math.PI / 2;
  }
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = pivot(chest, sx * 1.0, 0.35, 0);
    sh.rotation.z = sx * 0.4;
    add(sh, BOX(0.32, 1.4, 0.32), plate, 0, -0.7, 0);
    const el = pivot(sh, 0, -1.4, 0);
    add(el, BOX(0.26, 1.2, 0.26), cloth, 0, -0.6, 0);
    add(el, BOX(0.08, 2.0, 0.35), glow, 0, -1.9, 0.1);
    arms.push({ sh, el });
  }
  const tendrils = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = pivot(root, Math.cos(a) * 1.6, 0.2, Math.sin(a) * 1.6);
    add(p, CYL(0.06, 0.01, 1.8, 4), cloth, 0, -0.9, 0);
    tendrils.push(p);
  }
  return {
    root, parts: { robe, chest, hood, eye, iris, halo, arms, tendrils }, mats: [plate, cloth], eye: glow,
    hit: [
      { p: new THREE.Vector3(0, 5.25, 0.6), r: 0.65, crit: true },
      { p: new THREE.Vector3(0, 4.3, 0), r: 1.25 },
      { p: new THREE.Vector3(0, 2.2, 0), r: 1.5 },
    ],
  };
}

const BUILDERS = { husk: buildHusk, stalker: buildStalker, wisp: buildWisp, brute: buildBrute, warden: buildWarden };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class EnemyManager {
  constructor(scene, effects, audio) {
    this.scene = scene;
    this.fx = effects;
    this.audio = audio;
    this.list = [];
    this.projectiles = [];
    this.hazards = [];
    this.colliders = [];
    this.avoid = [];
    this.onKill = null;

    // Projectile pool
    this.projPool = [];
    // Orbs: a white-hot core inside an additive glow sprite.
    const pgeo = new THREE.SphereGeometry(0.11, 10, 6);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0e8, fog: false });
    const glow = glowTexture();
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(pgeo, coreMat);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
      );
      halo.scale.setScalar(1.3);
      m.add(halo);
      m.userData.halo = halo;
      m.visible = false;
      scene.add(m);
      this.projPool.push(m);
    }
    const rockGeo = pebble(0.45, 3);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.8, emissive: 0xff5010, emissiveIntensity: 0.8 });
    this.rocks = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(rockGeo, this.rockMat);
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      this.rocks.push(m);
    }
    this.bossLight = new THREE.PointLight(0xff3a2a, 0, 22, 1.6);
    scene.add(this.bossLight);

    // Nova ring hazards
    this.novaPool = [];
    const ngeo = new THREE.CylinderGeometry(1, 1, 0.9, 96, 1, true);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        ngeo,
        new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      m.visible = false;
      scene.add(m);
      this.novaPool.push(m);
    }
  }

  setColliders(colliders) {
    this.colliders = colliders;
    this.avoid = colliders
      .filter((c) => c.top > 0.8)
      .map((c) =>
        c.type === 'cyl'
          ? { x: c.x, z: c.z, r: c.r, top: c.top }
          : { x: (c.minX + c.maxX) / 2, z: (c.minZ + c.maxZ) / 2, r: Math.hypot(c.maxX - c.minX, c.maxZ - c.minZ) / 2, top: c.top }
      );
  }

  clear() {
    for (const e of this.list) this.scene.remove(e.root);
    this.list.length = 0;
    for (const p of this.projectiles) p.mesh.visible = false;
    this.projectiles.length = 0;
    for (const h of this.hazards) h.mesh.visible = false;
    this.hazards.length = 0;
  }

  get bossAlive() {
    return this.list.find((e) => e.def.boss && e.hp > 0);
  }

  spawn(type, pos, scaling) {
    const def = ENEMY_TYPES[type];
    const built = BUILDERS[type]();
    const root = built.root;
    root.position.copy(pos);
    this.scene.add(root);
    const hpMul = scaling.hp || 1;
    const e = {
      type,
      def,
      root,
      parts: built.parts,
      mats: built.mats,
      eye: built.eye,
      hit: built.hit,
      hitWorld: built.hit.map(() => new THREE.Vector3()),
      pos: root.position,
      vel: new THREE.Vector3(),
      yaw: Math.atan2(-pos.x, -pos.z),
      hp: def.hp * hpMul,
      maxHp: def.hp * hpMul,
      dmgMul: scaling.dmg || 1,
      speed: def.speed * (scaling.speed || 1) * (0.92 + Math.random() * 0.16),
      radius: def.radius,
      state: 'spawn',
      stateT: 0,
      spawnT: 0,
      attackCd: 1 + Math.random(),
      rangedCd: 2 + Math.random() * 2,
      phase: Math.random() * 10,
      flash: 0,
      burn: 0,
      burnDps: 0,
      burnTick: 0,
      grounded: true,
      side: Math.random() < 0.5 ? -1 : 1,
      orbitA: Math.random() * Math.PI * 2,
      hitThisLeap: false,
      dead: false,
      bossPhase: 1,
      attackIndex: 0,
      lastPos: pos.clone(),
    };
    if (def.flying) e.pos.y = type === 'warden' ? 1.5 : 3.5;
    root.scale.setScalar(0.2);
    this.list.push(e);
    if (type === 'warden') this.audio.play('roar', { vol: 1 });
    return e;
  }

  // --- damage ---------------------------------------------------------------------------
  damage(e, amount, { knock = null, burn = 0 } = {}) {
    if (e.dead) return false;
    e.hp -= amount;
    e.flash = 1;
    if (knock && !e.def.boss) e.vel.addScaledVector(knock, 1 / e.def.mass);
    if (burn > 0) {
      e.burn = 3;
      e.burnDps = Math.max(e.burnDps, burn);
    }
    if (e.state === 'spawn' && e.spawnT > 0.3) e.state = 'chase';
    if (e.hp <= 0) {
      this.kill(e);
      return true;
    }
    return false;
  }

  kill(e) {
    if (e.dead) return;
    e.dead = true;
    const center = _v.copy(e.pos).setY(e.pos.y + (e.def.flying && e.type !== 'warden' ? 0 : e.def.height * 0.5));
    const scale = e.type === 'warden' ? 4 : e.type === 'brute' ? 2 : 1;
    this.fx.deathBurst(center, e.def.glow, scale);
    this.fx.gibBurst(center, e.def.glow, e.type === 'warden' ? 30 : e.type === 'brute' ? 18 : 9, Math.min(1, scale * 0.7), scale > 1 ? 1.4 : 1);
    if (e.type === 'warden') this.fx.explosion(center, 8, 0xff3030);
    this.scene.remove(e.root);
    if (this.onKill) this.onKill(e, center.clone());
  }

  // --- projectiles ----------------------------------------------------------------------
  fireOrb(from, vel, damage, color, radius = 0.25) {
    const mesh = this.projPool.find((m) => !m.visible);
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.copy(from);
    mesh.userData.halo.material.color.set(color).multiplyScalar(2.5);
    mesh.scale.setScalar(radius / 0.22);
    this.projectiles.push({ mesh, vel: vel.clone(), grav: 0, damage, color: new THREE.Color(color), radius, life: 6, rock: false });
  }

  throwRock(from, target, damage) {
    const mesh = this.rocks.find((m) => !m.visible);
    if (!mesh) return;
    const flat = Math.hypot(target.x - from.x, target.z - from.z);
    const t = Math.max(0.6, flat / 20);
    const g = 18;
    const vel = new THREE.Vector3((target.x - from.x) / t, (target.y - from.y + 0.5 * g * t * t) / t, (target.z - from.z) / t);
    mesh.visible = true;
    mesh.position.copy(from);
    this.projectiles.push({ mesh, vel, grav: g, damage, color: new THREE.Color(0xff6020), radius: 0.5, life: 5, rock: true });
  }

  nova(center, damage, speed = 13, maxR = 34) {
    const mesh = this.novaPool.find((m) => !m.visible);
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(center.x, 0.45, center.z);
    mesh.scale.set(0.5, 1, 0.5);
    this.hazards.push({ mesh, center: center.clone(), r: 0.5, speed, maxR, damage, hit: false });
  }

  _updateProjectiles(dt, ctx) {
    const player = ctx.player;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vel.y -= p.grav * dt;
      const from = _v.copy(p.mesh.position);
      const step = p.vel.length() * dt;
      _dir.copy(p.vel).normalize();
      const hit = raycastWorld(this.colliders, from, _dir, step);
      let done = p.life <= 0;
      if (hit) {
        p.mesh.position.addScaledVector(_dir, hit.t);
        done = true;
      } else {
        p.mesh.position.addScaledVector(p.vel, dt);
      }
      if (p.rock) {
        p.mesh.rotation.x += dt * 5;
        p.mesh.rotation.z += dt * 3;
      }
      // trail
      this.fx.trail(p.mesh.position, p.color.clone().multiplyScalar(1.6), p.radius * 1.4, 0.3);
      // player hit: distance to the player's vertical capsule
      const pp = p.mesh.position;
      const py = Math.max(player.pos.y + 0.3, Math.min(player.pos.y + 1.6, pp.y));
      const d = Math.hypot(pp.x - player.pos.x, pp.y - py, pp.z - player.pos.z);
      if (!player.dead && d < p.radius + player.radius) {
        ctx.damagePlayer(p.damage, pp);
        done = true;
      }
      if (done) {
        if (p.rock) {
          this.fx.explosion(pp, 2.5, 0xff6020);
          this.audio.play('slam', ctx.spatial(pp, 0.6));
          const dd = pp.distanceTo(player.pos);
          if (!player.dead && dd < 3 && d >= p.radius + player.radius) ctx.damagePlayer(p.damage * 0.5, pp);
        } else {
          this.fx.impact(pp, hit ? hit.normal : _w.set(0, 1, 0), 'energy');
        }
        p.mesh.visible = false;
        this.projectiles.splice(i, 1);
      }
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.r += h.speed * dt;
      h.mesh.scale.set(h.r, 1, h.r);
      h.mesh.material.opacity = 1 - h.r / h.maxR;
      const pd = Math.hypot(player.pos.x - h.center.x, player.pos.z - h.center.z);
      const airborne = player.pos.y - groundHeight(this.colliders, player.pos.x, player.pos.z, 0.3, player.pos.y) > 0.55;
      if (!h.hit && !player.dead && Math.abs(pd - h.r) < 0.8 && !airborne) {
        h.hit = true;
        ctx.damagePlayer(h.damage, h.center);
        player.vel.y = 6;
        player.onGround = false;
      }
      if (h.r >= h.maxR) {
        h.mesh.visible = false;
        this.hazards.splice(i, 1);
      }
    }
  }

  // --- behaviour ------------------------------------------------------------------------
  update(dt, ctx) {
    const player = ctx.player;
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);

    for (const e of list) {
      e.phase += dt;
      e.attackCd -= dt;
      e.rangedCd -= dt;
      e.stateT += dt;
      e.lastPos.copy(e.pos);

      if (e.state === 'spawn') {
        e.spawnT += dt;
        const k = Math.min(1, e.spawnT / 0.7);
        e.root.scale.setScalar(0.2 + 0.8 * (1 - (1 - k) * (1 - k)));
        if (k >= 1) {
          e.state = 'chase';
          e.stateT = 0;
        }
        this._animate(e, dt, 0);
        this._updateHit(e);
        continue;
      }

      // burning
      if (e.burn > 0) {
        e.burn -= dt;
        e.burnTick -= dt;
        if (Math.random() < dt * 20) this.fx.trail(_v.copy(e.pos).setY(e.pos.y + Math.random() * e.def.height), new THREE.Color(2.5, 0.9, 0.2), 0.15, 0.6);
        if (e.burnTick <= 0) {
          e.burnTick = 0.33;
          ctx.burnDamage(e, e.burnDps * 0.33);
          if (e.dead) continue;
        }
      }

      switch (e.type) {
        case 'husk': this._husk(e, dt, ctx); break;
        case 'stalker': this._stalker(e, dt, ctx); break;
        case 'wisp': this._wisp(e, dt, ctx); break;
        case 'brute': this._brute(e, dt, ctx); break;
        case 'warden': this._warden(e, dt, ctx); break;
      }
      if (e.dead) continue;

      // Hit flash
      e.flash = Math.max(0, e.flash - dt * 7);
      for (const m of e.mats) m.emissive.setRGB(e.flash * 1.6, e.flash * 1.4, e.flash * 1.3);

      // Face movement / target
      const tx = player.pos.x - e.pos.x, tz = player.pos.z - e.pos.z;
      const targetYaw = Math.atan2(tx, tz);
      let dy = targetYaw - e.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      e.yaw += dy * Math.min(1, dt * (e.type === 'brute' ? 3 : 8));
      e.root.rotation.y = e.yaw;
      this._updateHit(e);
    }

    // Separation
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || a.def.flying !== b.def.flying) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) / d;
          const wa = b.def.mass / (a.def.mass + b.def.mass), wb = 1 - wa;
          a.pos.x -= dx * push * wa;
          a.pos.z -= dz * push * wa;
          b.pos.x += dx * push * wb;
          b.pos.z += dz * push * wb;
        }
      }
    }

    // Keep enemies out of the player's personal space so their bodies never
    // envelop the camera (a crowd could otherwise blind the player completely).
    for (const e of list) {
      if (e.dead) continue;
      const bottom = e.type === 'wisp' ? e.pos.y - 0.7 : e.pos.y;
      const top = e.type === 'wisp' ? e.pos.y + 0.7 : e.pos.y + e.def.height;
      if (top < player.pos.y || bottom > player.pos.y + player.height) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const min = e.radius + player.radius + 0.35;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-4 ? dx / d : Math.sin(e.yaw + Math.PI), nz = d > 1e-4 ? dz / d : Math.cos(e.yaw + Math.PI);
      e.pos.x = player.pos.x + nx * min;
      e.pos.z = player.pos.z + nz * min;
      // Kill velocity heading into the player (e.g. a pouncing stalker).
      const into = e.vel.x * -nx + e.vel.z * -nz;
      if (into > 0) {
        e.vel.x += nx * into;
        e.vel.z += nz * into;
      }
    }

    const boss = this.bossAlive;
    if (boss) {
      this.bossLight.position.set(boss.pos.x, boss.pos.y + 5.5, boss.pos.z).addScaledVector(_dir.set(Math.sin(boss.yaw), 0, Math.cos(boss.yaw)), 2.5);
      this.bossLight.intensity = 60 + Math.sin(boss.phase * 3) * 15;
    } else this.bossLight.intensity = 0;

    this._updateProjectiles(dt, ctx);
  }

  _updateHit(e) {
    e.root.updateMatrixWorld(true);
    for (let i = 0; i < e.hit.length; i++) e.hitWorld[i].copy(e.hit[i].p).applyMatrix4(e.root.matrixWorld);
  }

  // Steering toward a point, with obstacle avoidance.
  _steer(e, tx, tz, speedMul = 1) {
    let dx = tx - e.pos.x, dz = tz - e.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return { x: 0, z: 0, dist };
    dx /= dist;
    dz /= dist;
    let sx = 0, sz = 0;
    const look = Math.min(dist, 4);
    for (const c of this.avoid) {
      if (e.def.flying && c.top < e.pos.y) continue;
      const rx = c.x - e.pos.x, rz = c.z - e.pos.z;
      const along = rx * dx + rz * dz;
      if (along < 0 || along > look + c.r) continue;
      const px = rx - dx * along, pz = rz - dz * along;
      const pd = Math.hypot(px, pz);
      const minD = c.r + e.radius + 0.4;
      if (pd < minD) {
        const k = (minD - pd) / minD;
        if (pd > 0.05) {
          sx -= (px / pd) * k * 2.2;
          sz -= (pz / pd) * k * 2.2;
        } else {
          sx += -dz * e.side * 2;
          sz += dx * e.side * 2;
        }
      }
    }
    let mx = dx + sx, mz = dz + sz;
    const ml = Math.hypot(mx, mz) || 1;
    return { x: (mx / ml) * speedMul, z: (mz / ml) * speedMul, dist };
  }

  _moveGround(e, dt, mx, mz, speed, ctx, accel = 8) {
    const k = 1 - Math.exp(-accel * dt);
    e.vel.x += (mx * speed - e.vel.x) * k;
    e.vel.z += (mz * speed - e.vel.z) * k;
    e.vel.y -= 24 * dt;
    const before = _w.copy(e.pos);
    const prevY = e.pos.y;
    e.pos.addScaledVector(e.vel, dt);
    resolveActor(this.colliders, e.pos, e.radius, e.def.height, 0.7, e.grounded);
    const g = groundHeight(this.colliders, e.pos.x, e.pos.z, e.radius, Math.max(prevY, e.pos.y));
    if (e.pos.y <= g) {
      e.pos.y = g;
      e.vel.y = 0;
      e.grounded = true;
    } else if (e.pos.y > g + 0.05) e.grounded = false;
    // Leap up onto platforms when the player is up there and we're blocked.
    const moved = Math.hypot(e.pos.x - before.x, e.pos.z - before.z);
    const player = ctx.player;
    if (e.grounded && e.def.mass < 3 && player.pos.y > e.pos.y + 1.2 && moved < speed * dt * 0.3 && e.state !== 'attack') {
      const pd = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
      if (pd < 9) {
        e.vel.y = 12.5;
        e.grounded = false;
        e.vel.x = mx * speed * 1.2;
        e.vel.z = mz * speed * 1.2;
      }
    }
  }

  _husk(e, dt, ctx) {
    const player = ctx.player;
    const d3 = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
    const dy = Math.abs(player.pos.y - e.pos.y);
    let mx = 0, mz = 0, sp = e.speed;
    if (e.state === 'chase') {
      const s = this._steer(e, player.pos.x, player.pos.z);
      mx = s.x; mz = s.z;
      sp *= Math.max(0, Math.min(1, (d3 - 1.25) / 0.8));
      if (d3 < 1.7 && dy < 1.6 && e.attackCd <= 0) {
        e.state = 'attack';
        e.stateT = 0;
        e.struck = false;
        this.audio.play('growl', ctx.spatial(e.pos, 0.7));
      }
      if (Math.random() < dt * 0.08) this.audio.play('growl', ctx.spatial(e.pos, 0.4));
    } else if (e.state === 'attack') {
      sp = d3 > 1.4 ? e.speed * 0.25 : 0;
      const s = this._steer(e, player.pos.x, player.pos.z);
      mx = s.x; mz = s.z;
      if (e.stateT > 0.38 && !e.struck) {
        e.struck = true;
        this.audio.play('swipe', ctx.spatial(e.pos, 0.8));
        if (d3 < 2.3 && dy < 1.8) ctx.damagePlayer(e.def.damage * e.dmgMul, e.pos);
      }
      if (e.stateT > 0.7) {
        e.state = 'chase';
        e.attackCd = 0.8;
      }
    }
    this._moveGround(e, dt, mx, mz, sp, ctx);
    this._animate(e, dt, Math.hypot(e.vel.x, e.vel.z));
  }

  _stalker(e, dt, ctx) {
    const player = ctx.player;
    const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
    const dy = Math.abs(player.pos.y - e.pos.y);
    let mx = 0, mz = 0, sp = e.speed;
    if (e.state === 'chase') {
      // zig-zag approach
      const s = this._steer(e, player.pos.x, player.pos.z);
      const zig = Math.sin(e.phase * 3) * 0.6;
      mx = s.x - s.z * zig;
      mz = s.z + s.x * zig;
      const l = Math.hypot(mx, mz) || 1;
      mx /= l; mz /= l;
      if (d > 3.5 && d < 9 && e.attackCd <= 0 && e.grounded && dy < 2) {
        e.state = 'windup';
        e.stateT = 0;
        this.audio.play('shriek', ctx.spatial(e.pos, 0.8));
      } else if (d < 1.5 && dy < 1.5 && e.attackCd <= 0) {
        e.attackCd = 0.9;
        this.audio.play('swipe', ctx.spatial(e.pos, 0.6));
        ctx.damagePlayer(e.def.damage * 0.8 * e.dmgMul, e.pos);
      }
      this._moveGround(e, dt, mx, mz, sp, ctx);
    } else if (e.state === 'windup') {
      this._moveGround(e, dt, 0, 0, 0, ctx, 12);
      if (e.stateT > 0.35) {
        // pounce, leading the target a little
        const lead = _v.copy(player.pos).addScaledVector(player.vel, 0.25);
        const dx = lead.x - e.pos.x, dz = lead.z - e.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        e.vel.set((dx / l) * 16, 6.5, (dz / l) * 16);
        e.grounded = false;
        e.state = 'leap';
        e.stateT = 0;
        e.hitThisLeap = false;
      }
    } else if (e.state === 'leap') {
      e.vel.y -= 24 * dt;
      e.pos.addScaledVector(e.vel, dt);
      resolveActor(this.colliders, e.pos, e.radius, e.def.height, 0.7, true);
      const pd = Math.hypot(player.pos.x - e.pos.x, player.pos.y + 0.8 - e.pos.y - 0.5, player.pos.z - e.pos.z);
      if (!e.hitThisLeap && pd < 1.4) {
        e.hitThisLeap = true;
        ctx.damagePlayer(e.def.damage * e.dmgMul, e.pos);
      }
      const g = groundHeight(this.colliders, e.pos.x, e.pos.z, e.radius, e.pos.y + 0.1);
      if (e.pos.y <= g && e.vel.y < 0) {
        e.pos.y = g;
        e.vel.set(e.vel.x * 0.2, 0, e.vel.z * 0.2);
        e.grounded = true;
        e.state = 'recover';
        e.stateT = 0;
      }
    } else if (e.state === 'recover') {
      this._moveGround(e, dt, 0, 0, 0, ctx, 5);
      if (e.stateT > 0.55) {
        e.state = 'chase';
        e.attackCd = 1.6 + Math.random();
      }
    }
    this._animate(e, dt, Math.hypot(e.vel.x, e.vel.z));
  }

  _wisp(e, dt, ctx) {
    const player = ctx.player;
    e.orbitA += dt * 0.35 * e.side;
    const R = 11 + Math.sin(e.phase * 0.5) * 3;
    const tx = player.pos.x + Math.cos(e.orbitA) * R;
    const tz = player.pos.z + Math.sin(e.orbitA) * R;
    const ty = Math.max(player.pos.y + 3.2, 3) + Math.sin(e.phase * 1.3) * 0.8;
    const s = this._steer(e, tx, tz);
    const speed = s.dist > 1 ? e.speed : 0;
    const k = 1 - Math.exp(-3 * dt);
    e.vel.x += (s.x * speed - e.vel.x) * k;
    e.vel.z += (s.z * speed - e.vel.z) * k;
    e.vel.y += ((ty - e.pos.y) * 2 - e.vel.y) * k;
    e.pos.addScaledVector(e.vel, dt);
    const feet = _v.copy(e.pos);
    feet.y -= 0.5;
    resolveActor(this.colliders, feet, e.radius, 1, 0, false);
    e.pos.x = feet.x;
    e.pos.z = feet.z;

    if (e.state === 'chase' && e.rangedCd <= 0) {
      e.state = 'charge';
      e.stateT = 0;
      this.audio.play('wispCharge', ctx.spatial(e.pos, 0.7));
    } else if (e.state === 'charge') {
      e.parts.core.scale.setScalar(1 + e.stateT * 1.4);
      if (e.stateT > 0.55) {
        e.parts.core.scale.setScalar(1);
        const eye = player.eye;
        const lead = eye.addScaledVector(player.vel, eye.distanceTo(e.pos) / 16 * 0.5);
        const dir = lead.sub(e.pos).normalize();
        const los = raycastWorld(this.colliders, e.pos, dir, e.pos.distanceTo(player.eye));
        if (!los) {
          this.fireOrb(e.pos, dir.multiplyScalar(16), e.def.damage * e.dmgMul, 0xa060ff, 0.25);
          this.audio.play('wispShot', ctx.spatial(e.pos, 0.8));
        }
        e.state = 'chase';
        e.rangedCd = 2.2 + Math.random() * 1.5;
      }
    }
    this._animate(e, dt, 0);
  }

  _brute(e, dt, ctx) {
    const player = ctx.player;
    const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
    let mx = 0, mz = 0, sp = e.speed;
    if (e.state === 'chase') {
      const s = this._steer(e, player.pos.x, player.pos.z);
      mx = s.x; mz = s.z;
      if (d < 4.2 && e.attackCd <= 0) {
        e.state = 'slam';
        e.stateT = 0;
        this.audio.play('growl', ctx.spatial(e.pos, 1));
        this.fx.ring(e.pos, 6.5, 6.5, 0.9, 0xff4010);
      } else if (d > 9 && e.rangedCd <= 0) {
        e.state = 'throw';
        e.stateT = 0;
      }
    } else if (e.state === 'slam') {
      sp = 0;
      if (e.stateT > 0.9 && !e.struck) {
        e.struck = true;
        const c = _v.copy(e.pos).addScaledVector(_w.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)), 1.6);
        this.fx.ring(c, 0.5, 7, 0.5, 0xff6a20);
        this.fx.explosion(c.setY(e.pos.y + 0.3), 2, 0xff6a20);
        this.audio.play('slam', ctx.spatial(e.pos, 1));
        ctx.shake(e.pos, 0.6);
        const g = groundHeight(this.colliders, player.pos.x, player.pos.z, 0.3, player.pos.y);
        if (d < 6.5 && player.pos.y - g < 0.5 && Math.abs(player.pos.y - e.pos.y) < 1.5) {
          ctx.damagePlayer(e.def.damage * e.dmgMul, e.pos);
          player.vel.y = 7;
          player.onGround = false;
        }
      }
      if (e.stateT > 1.6) {
        e.state = 'chase';
        e.struck = false;
        e.attackCd = 1.5;
      }
    } else if (e.state === 'throw') {
      sp = 0;
      if (e.stateT > 0.8 && !e.struck) {
        e.struck = true;
        const from = _v.copy(e.pos).setY(e.pos.y + 3.4);
        const target = player.pos.clone().addScaledVector(player.vel, 0.4).setY(player.pos.y + 0.5);
        this.throwRock(from, target, e.def.damage * 0.8 * e.dmgMul);
        this.audio.play('swipe', ctx.spatial(e.pos, 1));
      }
      if (e.stateT > 1.3) {
        e.state = 'chase';
        e.struck = false;
        e.rangedCd = 4 + Math.random() * 2;
      }
    }
    this._moveGround(e, dt, mx, mz, sp, ctx, 4);
    this._animate(e, dt, Math.hypot(e.vel.x, e.vel.z));
  }

  _warden(e, dt, ctx) {
    const player = ctx.player;
    if (e.bossPhase === 1 && e.hp < e.maxHp * 0.5) {
      e.bossPhase = 2;
      this.audio.play('roar', { vol: 1 });
      ctx.shake(e.pos, 0.8);
      ctx.announce('THE WARDEN IS ENRAGED');
      e.parts.iris.material.emissiveIntensity = 14;
    }
    const enraged = e.bossPhase === 2;
    // hover around the player
    e.orbitA += dt * 0.18 * e.side;
    const R = 15;
    const tx = Math.cos(e.orbitA) * Math.min(R, 20) + player.pos.x * 0.3;
    const tz = Math.sin(e.orbitA) * Math.min(R, 20) + player.pos.z * 0.3;
    const lim = ARENA_RADIUS - 4;
    const tl = Math.hypot(tx, tz);
    const fx = tl > lim ? (tx / tl) * lim : tx, fz = tl > lim ? (tz / tl) * lim : tz;
    let hoverY = 1.5 + Math.sin(e.phase * 0.8) * 0.4;
    let moveSpeed = e.speed;

    if (e.state === 'chase') {
      if (e.attackCd <= 0) {
        const attacks = ['barrage', 'nova', 'spiral', 'summon', 'barrage', 'nova'];
        e.state = attacks[e.attackIndex++ % attacks.length];
        if (e.state === 'summon' && ctx.aliveCount() > 14) e.state = 'barrage';
        e.stateT = 0;
        e.shots = 0;
      }
    } else if (e.state === 'barrage') {
      moveSpeed *= 0.4;
      const volleys = enraged ? 4 : 3;
      if (e.stateT > 0.5 + e.shots * 0.55 && e.shots < volleys) {
        e.shots++;
        const origin = _v.copy(e.hitWorld[0]);
        const toP = player.eye.sub(origin).normalize();
        const n = enraged ? 11 : 9;
        const spreadA = 1.1;
        const baseYaw = Math.atan2(toP.x, toP.z);
        const pitch = Math.asin(toP.y);
        for (let i = 0; i < n; i++) {
          const a = baseYaw + (i / (n - 1) - 0.5) * spreadA + (e.shots % 2 ? 0.05 : -0.05);
          const dir = new THREE.Vector3(Math.sin(a) * Math.cos(pitch), Math.sin(pitch), Math.cos(a) * Math.cos(pitch));
          this.fireOrb(origin, dir.multiplyScalar(enraged ? 17 : 14), e.def.damage * e.dmgMul, 0xff3030, 0.32);
        }
        this.audio.play('wispShot', ctx.spatial(e.pos, 1));
      }
      if (e.stateT > 0.6 + volleys * 0.55) this._wardenRest(e, enraged);
    } else if (e.state === 'nova') {
      moveSpeed = 0;
      if (e.stateT < 1.0) hoverY = 1.5 + e.stateT * 4;
      else hoverY = Math.max(0.2, 5.5 - (e.stateT - 1) * 30);
      if (e.stateT > 1.15 && !e.struck) {
        e.struck = true;
        this.nova(e.pos, e.def.damage * 1.6 * e.dmgMul, enraged ? 16 : 13);
        if (enraged) setTimeout(() => !e.dead && this.nova(e.pos, e.def.damage * 1.6 * e.dmgMul, 11), 600);
        this.fx.explosion(_v.copy(e.pos).setY(0.5), 4, 0xff3030);
        this.audio.play('slam', { vol: 1 });
        ctx.shake(e.pos, 1);
      }
      if (e.stateT > 2.2) {
        e.struck = false;
        this._wardenRest(e, enraged);
      }
    } else if (e.state === 'spiral') {
      moveSpeed *= 0.2;
      const rate = enraged ? 0.05 : 0.08;
      if (e.stateT > 0.4 && e.stateT - 0.4 > e.shots * rate && e.stateT < 3.4) {
        e.shots++;
        const origin = _v.copy(e.hitWorld[1]);
        for (let arm = 0; arm < 3; arm++) {
          const a = e.shots * 0.27 + (arm / 3) * Math.PI * 2;
          const dir = new THREE.Vector3(Math.sin(a), -0.08, Math.cos(a));
          this.fireOrb(origin, dir.multiplyScalar(11), e.def.damage * 0.8 * e.dmgMul, 0xff5040, 0.28);
        }
        if (e.shots % 4 === 0) this.audio.play('wispShot', ctx.spatial(e.pos, 0.5));
      }
      if (e.stateT > 3.8) this._wardenRest(e, enraged);
    } else if (e.state === 'summon') {
      moveSpeed = 0;
      if (e.stateT > 0.6 && !e.struck) {
        e.struck = true;
        ctx.summon(enraged ? 5 : 3);
        this.audio.play('roar', { vol: 0.7 });
      }
      if (e.stateT > 1.6) {
        e.struck = false;
        this._wardenRest(e, enraged);
      }
    }

    const s = this._steer(e, fx, fz);
    const k = 1 - Math.exp(-2 * dt);
    e.vel.x += (s.x * moveSpeed - e.vel.x) * k;
    e.vel.z += (s.z * moveSpeed - e.vel.z) * k;
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    e.pos.y += (hoverY - e.pos.y) * Math.min(1, dt * (e.state === 'nova' ? 12 : 3));
    const feet = _v.copy(e.pos);
    resolveActor(this.colliders, feet, e.radius, 1, 0, false);
    e.pos.x = feet.x;
    e.pos.z = feet.z;
    this._animate(e, dt, 0);
  }

  _wardenRest(e, enraged) {
    e.state = 'chase';
    e.stateT = 0;
    e.attackCd = enraged ? 1.0 : 1.8;
  }

  // --- procedural animation ------------------------------------------------------------
  _animate(e, dt, speed) {
    const P = e.parts;
    const t = e.phase;
    if (e.type === 'husk') {
      const w = t * (2 + speed * 1.4);
      const amp = Math.min(1, speed / 3);
      P.legs[0].hip.rotation.x = Math.sin(w) * 0.7 * amp;
      P.legs[1].hip.rotation.x = -Math.sin(w) * 0.7 * amp;
      P.legs[0].knee.rotation.x = Math.max(0, -Math.sin(w)) * 0.9 * amp + 0.15;
      P.legs[1].knee.rotation.x = Math.max(0, Math.sin(w)) * 0.9 * amp + 0.15;
      P.body.position.y = 0.95 + Math.abs(Math.sin(w)) * 0.06 * amp;
      P.torso.rotation.z = Math.sin(w) * 0.08 * amp;
      P.head.rotation.y = Math.sin(t * 1.7) * 0.25;
      P.jaw.rotation.x = 0.2 + Math.sin(t * 9) * 0.15;
      if (e.state === 'attack') {
        const k = e.stateT;
        const raise = k < 0.38 ? -2.4 * (k / 0.38) : -2.4 + Math.min(1, (k - 0.38) / 0.12) * 3.2;
        P.arms.forEach((a) => {
          a.sh.rotation.x = raise;
          a.el.rotation.x = -0.4;
        });
        P.torso.rotation.x = 0.45 + (k < 0.38 ? -0.2 : 0.3);
      } else {
        P.arms[0].sh.rotation.x = -Math.sin(w) * 0.5 * amp - 0.2;
        P.arms[1].sh.rotation.x = Math.sin(w) * 0.5 * amp - 0.2;
        P.arms.forEach((a) => (a.el.rotation.x = -0.5));
        P.torso.rotation.x = 0.45;
      }
      P.arms[0].sh.rotation.z = -0.15;
      P.arms[1].sh.rotation.z = 0.15;
    } else if (e.type === 'stalker') {
      const w = t * (4 + speed * 1.6);
      const amp = Math.min(1, speed / 3) + 0.15;
      P.legs.forEach((L) => {
        L.up.rotation.y = Math.sin(w + L.phase) * 0.35 * amp;
        L.up.rotation.z = L.side * (-0.9 + Math.max(0, Math.sin(w + L.phase + 1.5)) * 0.35 * amp);
      });
      P.body.position.y = 0.72 + Math.sin(w * 2) * 0.03;
      if (e.state === 'windup') {
        P.body.rotation.x = -0.35;
        P.body.position.y = 0.55;
      } else if (e.state === 'leap') P.body.rotation.x = 0.2;
      else P.body.rotation.x = 0;
      P.head.rotation.y = Math.sin(t * 3) * 0.3;
    } else if (e.type === 'wisp') {
      P.core.rotation.y += dt * 2;
      P.core.rotation.x += dt * 1.3;
      P.rings.forEach((r, i) => {
        r.rotation.x += dt * (0.8 + i * 0.5);
        r.rotation.y += dt * (1.1 - i * 0.3);
      });
      P.shards.forEach((s, i) => {
        const a = t * 1.8 + (i / 4) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.85, Math.sin(t * 2 + i) * 0.2, Math.sin(a) * 0.85);
        s.rotation.set(0, -a, Math.PI / 2);
      });
      P.tail.rotation.z = Math.sin(t * 2) * 0.3;
    } else if (e.type === 'brute') {
      const w = t * (1.5 + speed * 1.1);
      const amp = Math.min(1, speed / 2);
      P.legs[0].hip.rotation.x = Math.sin(w) * 0.5 * amp;
      P.legs[1].hip.rotation.x = -Math.sin(w) * 0.5 * amp;
      P.legs[0].knee.rotation.x = Math.max(0, -Math.sin(w)) * 0.6 * amp;
      P.legs[1].knee.rotation.x = Math.max(0, Math.sin(w)) * 0.6 * amp;
      P.torso.rotation.z = Math.sin(w) * 0.06 * amp;
      if (e.state === 'slam') {
        const k = e.stateT;
        const up = k < 0.9 ? -2.8 * (k / 0.9) : -2.8 + Math.min(1, (k - 0.9) / 0.1) * 3.6;
        P.arms.forEach((a) => {
          a.sh.rotation.x = up;
          a.el.rotation.x = -0.3;
        });
        P.torso.rotation.x = k < 0.9 ? 0.1 : 0.6;
      } else if (e.state === 'throw') {
        const k = e.stateT;
        P.arms[1].sh.rotation.x = k < 0.8 ? -3 * (k / 0.8) : -3 + (k - 0.8) * 8;
        P.arms[0].sh.rotation.x = -0.3;
        P.torso.rotation.x = 0.3;
      } else {
        P.arms[0].sh.rotation.x = -Math.sin(w) * 0.35 * amp;
        P.arms[1].sh.rotation.x = Math.sin(w) * 0.35 * amp;
        P.arms.forEach((a) => (a.el.rotation.x = -0.35));
        P.torso.rotation.x = 0.3 + Math.sin(t * 1.5) * 0.03;
      }
      P.arms[0].sh.rotation.z = -0.2;
      P.arms[1].sh.rotation.z = 0.2;
    } else if (e.type === 'warden') {
      const enraged = e.bossPhase === 2;
      P.halo.rotation.z += dt * (enraged ? 2.2 : 0.7);
      P.chest.rotation.y = Math.sin(t * 0.5) * 0.15;
      P.robe.rotation.y += dt * 0.3;
      P.tendrils.forEach((p, i) => {
        p.rotation.x = Math.sin(t * 1.4 + i) * 0.35;
        p.rotation.z = Math.cos(t * 1.1 + i * 1.7) * 0.35;
      });
      const raise = e.state === 'nova' ? -2.2 : e.state === 'summon' ? -2.8 : e.state === 'barrage' ? -1.2 : -0.2;
      P.arms.forEach((a, i) => {
        a.sh.rotation.x += (raise + Math.sin(t * 1.2 + i) * 0.2 - a.sh.rotation.x) * Math.min(1, dt * 5);
        a.el.rotation.x = -0.6 + Math.sin(t * 0.9 + i) * 0.2;
      });
      P.iris.position.x = Math.sin(t * 0.7) * 0.08;
    }
  }
}

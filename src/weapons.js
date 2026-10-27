// Weapon definitions, procedural viewmodels and firing logic.

import * as THREE from 'three';
import { glowTexture } from './textures.js';
import { rbox } from './shapes.js';
import { materials as pbr } from './pbr.js';
import { triplanar } from './triplanar.js';

export const WEAPONS = [
  {
    id: 'pistol', slot: 1, name: 'VESPER', desc: 'Sidearm. Reliable, infinite reserve.',
    damage: 26, pellets: 1, rate: 0.17, auto: false, mag: 12, reserve: Infinity, reload: 1.05,
    spread: 0.004, bloom: 0.012, maxBloom: 0.04, range: 120, recoil: 0.022, kick: 0.05,
    color: 0xffa040, tracer: 0xffc078, sound: 'pistol', cost: 0,
  },
  {
    id: 'shotgun', slot: 2, name: 'BREAKER', desc: 'Pump shotgun. Nine pellets of bad news.',
    damage: 12, pellets: 9, rate: 0.78, auto: false, mag: 6, reserve: 36, reload: 1.6,
    spread: 0.065, bloom: 0, maxBloom: 0, range: 60, recoil: 0.09, kick: 0.16,
    color: 0xff3a24, tracer: 0xff9060, sound: 'shotgun', cost: 70, knockback: 3.5,
  },
  {
    id: 'rifle', slot: 3, name: 'LANCER', desc: 'Automatic rifle. Steady, hungry.',
    damage: 16, pellets: 1, rate: 0.085, auto: true, mag: 32, reserve: 192, reload: 1.45,
    spread: 0.006, bloom: 0.004, maxBloom: 0.035, range: 120, recoil: 0.012, kick: 0.035,
    color: 0x4fe0ff, tracer: 0x9ff0ff, sound: 'rifle', cost: 140,
  },
  {
    id: 'rail', slot: 4, name: 'PALE LANCE', desc: 'Rail cannon. Pierces everything in a line.',
    damage: 190, pellets: 1, rate: 1.15, auto: false, mag: 4, reserve: 20, reload: 2.1,
    spread: 0, bloom: 0, maxBloom: 0, range: 200, recoil: 0.06, kick: 0.2, pierce: true,
    color: 0xbfe6ff, tracer: 0xbfe6ff, sound: 'rail', cost: 240, knockback: 6,
  },
  {
    id: 'launcher', slot: 5, name: 'CINDER', desc: 'Grenade launcher. Area denial, self-propulsion.',
    damage: 140, pellets: 1, rate: 0.85, auto: false, mag: 5, reserve: 20, reload: 2.0,
    spread: 0.002, bloom: 0, maxBloom: 0, range: 0, recoil: 0.07, kick: 0.18, projectile: true, splash: 4.8,
    color: 0xff7a2a, tracer: 0xff7a2a, sound: 'launcher', cost: 320,
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

// --- detailed procedural viewmodels ---------------------------------------------------------
function mats(accent) {
  const P = pbr();
  const std = (color, roughness = 1, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    gun: triplanar(std(0xe8ecf0, 1, 1), P.gun, { space: 'object', scale: 5, normalScale: 0.8 }),
    dark: triplanar(std(0x7a7e86, 1, 1), P.gun, { space: 'object', scale: 6, normalScale: 0.6 }),
    poly: triplanar(std(0xb0b0b0), P.grip, { space: 'object', scale: 9, normalScale: 1.3 }),
    trim: std(0x9a7a50, 0.35, 1),
    hole: std(0x020202, 1, 0),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1a24, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45 }),
    shell: std(0x7a1410, 0.55, 0),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: accent, emissiveIntensity: 2.2 }),
    sleeve: triplanar(std(0x6a6e78), P.cloth, { space: 'object', scale: 6, normalScale: 1.5 }),
    glove: triplanar(std(0x5a5a5e), P.grip, { space: 'object', scale: 14, normalScale: 0.8 }),
  };
}

const geoCache = new Map();
const memo = (k, f) => (geoCache.has(k) ? geoCache.get(k) : (geoCache.set(k, f()), geoCache.get(k)));
// Rounded box; cylinder/torus helpers oriented along Z (the barrel axis).
const RB = (w, h, d, r = null) => memo(`b${w},${h},${d},${r}`, () => rbox(w, h, d, r ?? Math.min(w, h, d) * 0.28));
const CZ = (r, len, seg = 24, rTop = r) => memo(`z${r},${len},${seg},${rTop}`, () => new THREE.CylinderGeometry(rTop, r, len, seg).rotateX(Math.PI / 2));
const RINGZ = (r, t, arc = Math.PI * 2) => memo(`r${r},${t},${arc}`, () => new THREE.TorusGeometry(r, t, 8, 32, arc));

function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

// Picatinny rail: a base with evenly spaced cross slots.
function rail(parent, M, x, y, z0, z1, w = 0.03) {
  const len = Math.abs(z1 - z0);
  part(parent, RB(w * 0.8, 0.008, len, 0.002), M.dark, x, y, (z0 + z1) / 2);
  for (let z = Math.min(z0, z1) + 0.006; z < Math.max(z0, z1); z += 0.01) part(parent, RB(w, 0.006, 0.006, 0.0015), M.dark, x, y + 0.006, z);
}

function triggerGroup(parent, M, y, z) {
  part(parent, RINGZ(0.025, 0.0045, Math.PI), M.dark, 0, y, z, 0, Math.PI / 2, Math.PI);
  const t = part(parent, RB(0.006, 0.026, 0.008, 0.002), M.dark, 0, y + 0.004, z + 0.002);
  t.rotation.x = 0.35;
}

function arm(M, parent, gripPos) {
  const hand = part(parent, RB(0.075, 0.09, 0.11, 0.03), M.glove, gripPos.x, gripPos.y, gripPos.z, 0.3);
  hand.scale.set(1, 1, 1);
  for (let k = 0; k < 3; k++) part(parent, memo('finger', () => new THREE.CapsuleGeometry(0.011, 0.045, 4, 8)), M.glove, gripPos.x - 0.025 + k * 0.016, gripPos.y - 0.01 - k * 0.018, gripPos.z - 0.05, 0, 0, Math.PI / 2);
  part(parent, memo('cuff', () => new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16)), M.glove, gripPos.x + 0.035, gripPos.y - 0.09, gripPos.z + 0.13, 1.15, 0, 0.35);
  part(parent, memo('fore', () => new THREE.CapsuleGeometry(0.052, 0.42, 4, 16)), M.sleeve, gripPos.x + 0.06, gripPos.y - 0.14, gripPos.z + 0.25, 1.15, 0, 0.35);
}

function buildModel(def) {
  const g = new THREE.Group();
  const M = mats(def.color);
  const muzzle = new THREE.Object3D();
  const coils = [];
  switch (def.id) {
    case 'pistol': {
      part(g, RB(0.056, 0.05, 0.24, 0.01), M.dark, 0, 0.012, -0.08);
      for (let k = 0; k < 4; k++) part(g, RB(0.05, 0.007, 0.006, 0.002), M.dark, 0, -0.016, -0.15 - k * 0.014);
      const slide = new THREE.Group();
      slide.name = 'slide';
      slide.position.set(0, 0.072, -0.09);
      g.add(slide);
      part(slide, RB(0.064, 0.058, 0.3, 0.012), M.gun);
      part(slide, RB(0.03, 0.004, 0.06, 0.0015), M.hole, 0, 0.029, -0.03);
      for (let k = 0; k < 7; k++) part(slide, RB(0.0665, 0.042, 0.003, 0.001), M.dark, 0, -0.002, 0.085 + k * 0.008);
      for (let k = 0; k < 5; k++) part(slide, RB(0.0665, 0.03, 0.003, 0.001), M.dark, 0, 0.004, -0.12 + k * 0.007);
      part(slide, RB(0.006, 0.012, 0.012, 0.002), M.dark, 0, 0.034, -0.135);
      part(slide, RB(0.05, 0.012, 0.012, 0.003), M.dark, 0, 0.034, 0.13);
      part(slide, memo('dot', () => new THREE.SphereGeometry(0.0025, 8, 6)), M.glow, 0, 0.041, -0.135);
      part(slide, memo('dot', () => new THREE.SphereGeometry(0.0025, 8, 6)), M.glow, -0.012, 0.041, 0.13);
      part(slide, memo('dot', () => new THREE.SphereGeometry(0.0025, 8, 6)), M.glow, 0.012, 0.041, 0.13);
      part(slide, RB(0.0655, 0.003, 0.14, 0.001), M.glow, 0, -0.018, -0.04);
      part(g, CZ(0.011, 0.02), M.dark, 0, 0.075, -0.245);
      part(g, CZ(0.0065, 0.022, 16), M.hole, 0, 0.075, -0.246);
      triggerGroup(g, M, -0.022, -0.015);
      part(g, RB(0.054, 0.14, 0.07, 0.016), M.poly, 0, -0.075, 0.035, 0.28);
      part(g, RB(0.046, 0.13, 0.012, 0.004), M.dark, 0, -0.068, 0.072, 0.28);
      part(g, RB(0.05, 0.012, 0.062, 0.004), M.dark, 0, -0.143, 0.057, 0.28);
      part(g, RB(0.012, 0.022, 0.014, 0.003), M.dark, 0, 0.06, 0.072, -0.4);
      part(g, memo('pin', () => new THREE.CylinderGeometry(0.004, 0.004, 0.06, 10).rotateZ(Math.PI / 2)), M.gun, 0, 0.0, -0.03);
      part(g, memo('pin', () => new THREE.CylinderGeometry(0.004, 0.004, 0.06, 10).rotateZ(Math.PI / 2)), M.gun, 0, 0.012, 0.05);
      arm(M, g, new THREE.Vector3(0, -0.07, 0.03));
      muzzle.position.set(0, 0.075, -0.26);
      break;
    }
    case 'shotgun': {
      part(g, RB(0.08, 0.1, 0.36, 0.014), M.gun, 0, 0, -0.04);
      part(g, RB(0.004, 0.034, 0.08, 0.001), M.hole, 0.04, 0.016, -0.05);
      part(g, CZ(0.022, 0.66), M.gun, 0, 0.03, -0.52);
      part(g, CZ(0.025, 0.025), M.dark, 0, 0.03, -0.84);
      part(g, CZ(0.016, 0.027, 16), M.hole, 0, 0.03, -0.842);
      part(g, memo('bead', () => new THREE.SphereGeometry(0.005, 10, 8)), M.trim, 0, 0.056, -0.83);
      part(g, RB(0.012, 0.006, 0.6, 0.002), M.dark, 0, 0.056, -0.52);
      for (let k = 0; k < 12; k++) part(g, RB(0.006, 0.006, 0.006, 0.001), M.dark, 0, 0.05, -0.24 - k * 0.05);
      part(g, CZ(0.019, 0.5), M.dark, 0, -0.025, -0.47);
      part(g, CZ(0.022, 0.03), M.gun, 0, -0.025, -0.735);
      part(g, RB(0.05, 0.07, 0.02, 0.005), M.dark, 0, 0.003, -0.7);
      const pump = new THREE.Group();
      pump.name = 'pump';
      pump.position.set(0, -0.025, -0.42);
      g.add(pump);
      part(pump, CZ(0.033, 0.18, 20), M.poly);
      for (let k = 0; k < 8; k++) part(pump, RINGZ(0.0335, 0.0035), M.dark, 0, 0, -0.07 + k * 0.02);
      triggerGroup(g, M, -0.06, 0.05);
      part(g, RB(0.05, 0.11, 0.06, 0.015), M.poly, 0, -0.085, 0.1, 0.3);
      part(g, RB(0.06, 0.09, 0.26, 0.02), M.poly, 0, -0.035, 0.25, -0.15);
      part(g, RB(0.064, 0.105, 0.02, 0.006), M.dark, 0, -0.055, 0.375, -0.15);
      part(g, RB(0.006, 0.05, 0.13, 0.002), M.dark, 0.043, 0.008, -0.04);
      for (let k = 0; k < 4; k++) {
        part(g, memo('shell', () => new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 16)), M.shell, 0.052, 0.012, -0.09 + k * 0.026);
        part(g, memo('shellBase', () => new THREE.CylinderGeometry(0.01, 0.01, 0.014, 16)), M.trim, 0.052, -0.02, -0.09 + k * 0.026);
      }
      part(g, RB(0.082, 0.004, 0.22, 0.001), M.glow, 0, -0.035, -0.05);
      arm(M, g, new THREE.Vector3(0, -0.085, 0.08));
      muzzle.position.set(0, 0.03, -0.86);
      break;
    }
    case 'rifle': {
      part(g, RB(0.058, 0.06, 0.22, 0.01), M.dark, 0, -0.015, -0.03);
      part(g, RB(0.064, 0.05, 0.3, 0.01), M.gun, 0, 0.035, -0.06);
      part(g, RB(0.004, 0.022, 0.06, 0.001), M.hole, 0.033, 0.03, -0.04);
      rail(g, M, 0, 0.062, -0.2, 0.08);
      part(g, RB(0.034, 0.02, 0.07, 0.005), M.dark, 0, 0.078, -0.06);
      part(g, RB(0.006, 0.05, 0.05, 0.002), M.dark, -0.02, 0.105, -0.07);
      part(g, RB(0.006, 0.05, 0.05, 0.002), M.dark, 0.02, 0.105, -0.07);
      part(g, RB(0.046, 0.006, 0.05, 0.002), M.dark, 0, 0.13, -0.07);
      part(g, RB(0.034, 0.036, 0.002, 0.0008), M.glass, 0, 0.11, -0.08);
      part(g, memo('ret', () => new THREE.TorusGeometry(0.006, 0.0007, 6, 24)), M.glow, 0, 0.11, -0.081);
      part(g, memo('dot', () => new THREE.SphereGeometry(0.0012, 8, 6)), M.glow, 0, 0.11, -0.081);
      part(g, RB(0.03, 0.01, 0.03, 0.003), M.dark, 0, 0.058, 0.11);
      part(g, RB(0.058, 0.058, 0.32, 0.012), M.gun, 0, 0.028, -0.37);
      for (let k = 0; k < 6; k++) {
        part(g, RB(0.0595, 0.012, 0.028, 0.004), M.hole, 0, 0.018, -0.26 - k * 0.042);
      }
      rail(g, M, 0, 0.06, -0.52, -0.22);
      part(g, CZ(0.011, 0.2), M.dark, 0, 0.026, -0.62);
      part(g, CZ(0.017, 0.065), M.dark, 0, 0.026, -0.74);
      for (let k = 0; k < 3; k++) part(g, RB(0.036, 0.006, 0.008, 0.002), M.hole, 0, 0.026, -0.722 - k * 0.016);
      const mag = new THREE.Group();
      mag.name = 'mag';
      mag.position.set(0, -0.12, -0.1);
      mag.rotation.x = 0.2;
      g.add(mag);
      part(mag, RB(0.048, 0.17, 0.08, 0.008), M.dark);
      for (let k = 0; k < 4; k++) part(mag, RB(0.05, 0.004, 0.06, 0.001), M.gun, 0, 0.06 - k * 0.04, 0);
      part(mag, RB(0.052, 0.012, 0.084, 0.003), M.poly, 0, -0.088, 0);
      triggerGroup(g, M, -0.055, 0.03);
      part(g, RB(0.04, 0.11, 0.055, 0.012), M.poly, 0, -0.075, 0.08, 0.35);
      part(g, CZ(0.016, 0.16), M.dark, 0, 0.012, 0.17);
      part(g, RB(0.05, 0.085, 0.14, 0.015), M.poly, 0, -0.005, 0.27);
      part(g, RB(0.05, 0.03, 0.08, 0.008), M.poly, 0, 0.045, 0.25);
      part(g, RB(0.0595, 0.004, 0.2, 0.001), M.glow, 0, -0.002, -0.38);
      arm(M, g, new THREE.Vector3(0, -0.07, 0.05));
      muzzle.position.set(0, 0.026, -0.78);
      break;
    }
    case 'rail': {
      part(g, RB(0.09, 0.12, 0.5, 0.018), M.gun, 0, 0, -0.05);
      for (let k = 0; k < 10; k++) part(g, RB(0.07, 0.028, 0.005, 0.0015), M.dark, 0, 0.074, 0.02 + k * 0.016);
      part(g, RB(0.05, 0.05, 0.78, 0.012), M.gun, 0, 0.035, -0.56);
      part(g, RB(0.05, 0.03, 0.72, 0.008), M.dark, 0, -0.035, -0.53);
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(memo('coil', () => new THREE.TorusGeometry(0.055, 0.012, 12, 40)), M.glow.clone());
        c.position.set(0, 0.0, -0.36 - i * 0.1);
        g.add(c);
        coils.push(c);
        part(g, RB(0.12, 0.012, 0.012, 0.003), M.dark, 0, 0, -0.36 - i * 0.1 - 0.035);
      }
      part(g, CZ(0.026, 0.15, 20), M.glass, 0.062, -0.01, -0.06);
      const cell = part(g, CZ(0.015, 0.13, 16), M.glow, 0.062, -0.01, -0.06);
      cell.scale.set(1, 1, 1);
      for (const z of [-0.14, 0.02]) part(g, CZ(0.03, 0.012, 20), M.dark, 0.062, -0.01, z);
      const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(0.062, -0.01, -0.14), new THREE.Vector3(0.07, -0.03, -0.24), new THREE.Vector3(0.04, -0.02, -0.34)]);
      part(g, memo('cable', () => new THREE.TubeGeometry(cable, 16, 0.006, 8, false)), M.dark);
      part(g, CZ(0.022, 0.18), M.gun, 0, 0.1, -0.02);
      part(g, CZ(0.026, 0.02), M.dark, 0, 0.1, -0.11);
      part(g, CZ(0.019, 0.004, 20), M.glass, 0, 0.1, -0.12);
      for (const z of [-0.07, 0.03]) part(g, RB(0.02, 0.03, 0.02, 0.004), M.dark, 0, 0.075, z);
      triggerGroup(g, M, -0.07, 0.05);
      part(g, RB(0.045, 0.11, 0.06, 0.014), M.poly, 0, -0.1, 0.1, 0.3);
      part(g, RB(0.07, 0.1, 0.26, 0.02), M.poly, 0, -0.02, 0.29);
      arm(M, g, new THREE.Vector3(0, -0.085, 0.09));
      muzzle.position.set(0, 0.0, -0.96);
      break;
    }
    case 'launcher': {
      part(g, RB(0.1, 0.12, 0.32, 0.018), M.gun, 0, 0, 0.02);
      const drum = new THREE.Group();
      drum.name = 'drum';
      drum.position.set(0, -0.01, -0.22);
      g.add(drum);
      part(drum, CZ(0.1, 0.18, 36), M.dark);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        part(drum, CZ(0.024, 0.182, 16), M.hole, Math.cos(a) * 0.058, Math.sin(a) * 0.058, 0);
        part(drum, RB(0.012, 0.012, 0.16, 0.003), M.gun, Math.cos(a + 0.52) * 0.1, Math.sin(a + 0.52) * 0.1, 0, 0, 0, a);
      }
      part(g, CZ(0.05, 0.36, 28), M.gun, 0, 0.02, -0.48);
      for (let k = 0; k < 6; k++) part(g, RINGZ(0.056, 0.007), M.dark, 0, 0.02, -0.34 - k * 0.05);
      part(g, RB(0.07, 0.012, 0.3, 0.004), M.dark, 0, 0.082, -0.48);
      part(g, CZ(0.062, 0.05, 28), M.trim, 0, 0.02, -0.66);
      part(g, CZ(0.044, 0.052, 20), M.hole, 0, 0.02, -0.662);
      for (let i = 0; i < 3; i++) part(g, RB(0.102, 0.004, 0.012, 0.001), M.glow, 0, 0.062, -0.05 - i * 0.05);
      part(g, RB(0.035, 0.1, 0.04, 0.012), M.poly, 0, -0.1, -0.45, 0.15);
      triggerGroup(g, M, -0.07, 0.07);
      part(g, RB(0.05, 0.11, 0.06, 0.015), M.poly, 0, -0.1, 0.12, 0.3);
      part(g, RB(0.07, 0.1, 0.2, 0.02), M.poly, 0, -0.04, 0.27);
      arm(M, g, new THREE.Vector3(0, -0.085, 0.1));
      muzzle.position.set(0, 0.02, -0.7);
      break;
    }
  }
  g.add(muzzle);
  g.scale.setScalar(0.85);
  return { group: g, muzzle, coils };
}

export class WeaponSystem {
  constructor(weaponScene, weaponCamera, audio) {
    this.scene = weaponScene;
    this.camera = weaponCamera;
    this.audio = audio;
    this.holder = new THREE.Group();
    this.camera.add(this.holder);
    this.models = {};
    for (const def of WEAPONS) {
      const m = buildModel(def);
      m.group.visible = false;
      this.holder.add(m.group);
      this.models[def.id] = m;
    }
    // Muzzle flash billboard
    const tex = glowTexture();
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.35, 0.35),
      new THREE.MeshBasicMaterial({ map: tex, color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.flash.visible = false;
    this.holder.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 3, 2);
    this.holder.add(this.flashLight);
    this.reset();
  }

  reset(owned = ['pistol']) {
    this.state = {};
    for (const def of WEAPONS) this.state[def.id] = { owned: false, mag: def.mag, reserve: def.reserve, tier: 0 };
    owned.forEach((id) => (this.state[id].owned = true));
    this.current = null;
    this.last = null;
    this.cooldown = 0;
    this.reloadTime = 0;
    this.switchTime = 0;
    this.bloom = 0;
    this.recoil = 0;
    this.recoilRot = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.flashTime = 0;
    this.prevTrigger = false;
    this.autoReloadDelay = 0;
    this.equip(owned[owned.length - 1], true);
  }

  get def() {
    return WEAPON_BY_ID[this.current];
  }

  get ammo() {
    return this.state[this.current];
  }

  magSize(def, mods) {
    return Math.round(def.mag * (mods.magMul || 1));
  }

  maxReserve(def, mods) {
    return def.reserve === Infinity ? Infinity : Math.round(def.reserve * (mods.ammoMul || 1));
  }

  unlock(id, mods) {
    const s = this.state[id];
    s.owned = true;
    const def = WEAPON_BY_ID[id];
    s.mag = this.magSize(def, mods);
    s.reserve = this.maxReserve(def, mods);
  }

  refill(mods, fraction = 1) {
    for (const def of WEAPONS) {
      const s = this.state[def.id];
      if (!s.owned || def.reserve === Infinity) continue;
      const max = this.maxReserve(def, mods);
      s.reserve = Math.min(max, s.reserve + Math.ceil(max * fraction));
    }
  }

  // Returns the ids of owned weapons that aren't full on reserve.
  needsAmmo(mods) {
    return WEAPONS.some((def) => {
      const s = this.state[def.id];
      return s.owned && def.reserve !== Infinity && s.reserve < this.maxReserve(def, mods) * 0.5;
    });
  }

  equip(id, instant = false) {
    if (!this.state[id] || !this.state[id].owned || id === this.current) return;
    if (this.current) this.last = this.current;
    this.current = id;
    for (const k in this.models) this.models[k].group.visible = k === id;
    this.reloadTime = 0;
    this.switchTime = instant ? 0 : 0.32;
    this.cooldown = Math.max(this.cooldown, instant ? 0 : 0.25);
    this.bloom = 0;
    if (!instant) this.audio.play('switch');
  }

  cycle(dir) {
    const owned = WEAPONS.filter((d) => this.state[d.id].owned).map((d) => d.id);
    const i = owned.indexOf(this.current);
    this.equip(owned[(i + dir + owned.length) % owned.length]);
  }

  startReload(mods) {
    const def = this.def;
    const s = this.ammo;
    if (this.reloadTime > 0 || this.switchTime > 0) return;
    if (s.mag >= this.magSize(def, mods) || s.reserve <= 0) return;
    this.reloadTime = def.reload / (mods.reloadMul || 1);
    this.reloadTotal = this.reloadTime;
    this.audio.play('reload');
  }

  // fire callback: (def, origin, dirs[], muzzleWorld) => void
  update(dt, input, player, mods, fire) {
    const def = this.def;
    const s = this.ammo;

    // Weapon selection
    for (const d of WEAPONS) if (input.hit('Digit' + d.slot)) this.equip(d.id);
    if (input.wheel) this.cycle(input.wheel > 0 ? 1 : -1);
    if (input.hit('KeyQ') && this.last) this.equip(this.last);
    if (input.hit('KeyR')) this.startReload(mods);

    this.cooldown -= dt;
    this.switchTime = Math.max(0, this.switchTime - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);

    if (this.reloadTime > 0) {
      this.reloadTime -= dt;
      if (this.reloadTime <= 0) {
        const need = this.magSize(def, mods) - s.mag;
        const take = Math.min(need, s.reserve);
        s.mag += take;
        if (s.reserve !== Infinity) s.reserve -= take;
        this.reloadTime = 0;
      }
    }

    if (this.autoReloadDelay > 0) {
      this.autoReloadDelay -= dt;
      if (this.autoReloadDelay <= 0 && s.mag === 0) this.startReload(mods);
    }

    const trigger = input.mouse[0];
    const wants = def.auto ? trigger : trigger && !this.prevTrigger;
    this.prevTrigger = trigger;
    if (wants && this.cooldown <= 0 && this.reloadTime <= 0 && this.switchTime <= 0) {
      if (s.mag > 0) {
        s.mag--;
        this.cooldown = def.rate / (mods.fireRateMul || 1);
        this._fire(def, player, mods, fire);
        if (s.mag === 0) this.autoReloadDelay = 0.25;
      } else if (s.reserve > 0) {
        this.startReload(mods);
      } else {
        this.audio.play('empty');
        this.cooldown = 0.25;
      }
    }

    this._animate(dt, input, player);
  }

  currentSpread(player) {
    const def = this.def;
    const move = Math.min(1, player.speed2d / 8) * 0.012;
    const air = player.onGround ? 0 : 0.02;
    return def.spread + this.bloom + (def.pellets > 1 ? 0 : move + air);
  }

  _fire(def, player, mods, fire) {
    const cam = player.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const spread = this.currentSpread(player);
    const dirs = [];
    for (let i = 0; i < def.pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      dirs.push(fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize());
    }
    this.bloom = Math.min(def.maxBloom, this.bloom + def.bloom);

    // muzzle world position: weapon camera space == main camera space
    const m = this.models[def.id];
    this.holder.updateMatrixWorld(true);
    const local = m.muzzle.getWorldPosition(new THREE.Vector3()); // in weapon-camera space (camera at origin)
    const muzzleWorld = local.applyMatrix4(cam.matrixWorld);

    fire(def, origin, dirs, muzzleWorld, fwd);

    this.audio.play(def.sound);
    this.recoil = Math.min(1.5, this.recoil + 1);
    this.recoilRot = def.kick;
    player.punch.x += def.recoil;
    player.punch.y += (Math.random() - 0.5) * def.recoil * 0.4;
    if (def.id === 'rifle') player.pitch += def.recoil * 0.12;
    this.flashTime = 0.05;
    this.flash.material.color.set(def.color);
    this.flash.rotation.z = Math.random() * Math.PI;
    const sc = def.id === 'shotgun' || def.id === 'launcher' ? 1.6 : def.id === 'rail' ? 2 : 1;
    this.flash.scale.setScalar(sc * (0.8 + Math.random() * 0.4));
    this.flashLight.color.set(def.color);
  }

  _animate(dt, input, player) {
    const def = this.def;
    const m = this.models[def.id];
    const g = m.group;
    // Sway lags behind mouse motion
    this.swayX += (-input.dx * 0.0006 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (input.dy * 0.0006 - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX));
    this.swayY = Math.max(-0.06, Math.min(0.06, this.swayY));
    this.recoil *= Math.exp(-dt * 14);
    this.recoilRot *= Math.exp(-dt * 12);

    const bobT = player.bobPhase;
    const bobA = player.bobAmount;
    let x = 0.2 + Math.cos(bobT) * 0.012 * bobA + this.swayX;
    let y = -0.2 + Math.abs(Math.sin(bobT)) * -0.014 * bobA + this.swayY - player.landDip * 0.25;
    let z = -0.52 + this.recoil * 0.06;
    let rx = this.recoilRot + this.swayY * 2;
    let rz = this.swayX * 2 + (player.dashTime > 0 ? 0.15 : 0);
    let ry = 0.045;

    if (this.reloadTime > 0) {
      const p = 1 - this.reloadTime / this.reloadTotal;
      const k = Math.sin(p * Math.PI);
      y -= k * 0.1;
      rx -= k * 0.5;
      rz += k * 0.6;
      const mag = g.getObjectByName('mag');
      if (mag) mag.position.y = -0.12 - Math.max(0, Math.sin(p * Math.PI * 2)) * 0.12;
      const drum = g.getObjectByName('drum');
      if (drum) drum.rotation.z += dt * 8;
    }
    if (this.switchTime > 0) {
      const k = this.switchTime / 0.32;
      y -= k * 0.35;
      rx -= k * 0.6;
    }
    // Shotgun pump after firing
    const pump = g.getObjectByName('pump');
    if (pump) {
      const t = this.cooldown / (def.rate || 1);
      pump.position.z = -0.42 + (t > 0 && t < 0.6 ? Math.sin((t / 0.6) * Math.PI) * 0.09 : 0);
    }
    const slide = g.getObjectByName('slide');
    if (slide) slide.position.z = -0.09 + this.recoil * 0.05;
    // Rail coils glow with readiness
    if (m.coils.length) {
      const ready = this.cooldown <= 0 && this.reloadTime <= 0 ? 1 : 0.25;
      const t = performance.now() * 0.006;
      m.coils.forEach((c, i) => {
        c.material.emissiveIntensity = (0.3 + 0.9 * ready) * (0.7 + 0.3 * Math.sin(t + i));
      });
    }
    // Idle breathing
    const breathe = Math.sin(performance.now() * 0.0015) * 0.004;
    g.position.set(x, y + breathe, z);
    g.rotation.set(rx, ry, rz);

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flash.visible = true;
      this.flash.position.copy(m.muzzle.position).multiplyScalar(g.scale.x).applyEuler(g.rotation).add(g.position);
      this.flashLight.position.copy(this.flash.position);
      this.flashLight.intensity = 6;
    } else {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
  }
}

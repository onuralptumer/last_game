// Weapon definitions, procedural viewmodels and firing logic.

import * as THREE from 'three';
import { glowTexture } from './textures.js';
import { rbox } from './shapes.js';

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

function mats(accent) {
  return {
    gun: new THREE.MeshStandardMaterial({ color: 0x5a616d, metalness: 0.45, roughness: 0.42 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x25282e, metalness: 0.2, roughness: 0.65 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x9a8268, metalness: 0.6, roughness: 0.35 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: accent, emissiveIntensity: 2.2 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.95 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.7, metalness: 0.1 }),
  };
}

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(rbox(w, h, d, Math.min(w, h, d) * 0.35), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function cyl(r, len, mat, x, y, z, parent, seg = 12, rTop = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, len, Math.max(24, seg)), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function arm(M, parent, gripPos) {
  // A gloved hand on the grip and a forearm running off-screen.
  const hand = box(0.075, 0.09, 0.11, M.glove, gripPos.x, gripPos.y, gripPos.z, parent);
  hand.rotation.x = 0.3;
  const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.42, 4, 16), M.sleeve);
  fore.position.set(gripPos.x + 0.06, gripPos.y - 0.14, gripPos.z + 0.25);
  fore.rotation.set(1.15, 0, 0.35);
  parent.add(fore);
}

function buildModel(def) {
  const g = new THREE.Group();
  const M = mats(def.color);
  const muzzle = new THREE.Object3D();
  let coils = [];
  switch (def.id) {
    case 'pistol': {
      box(0.06, 0.07, 0.28, M.gun, 0, 0.02, -0.08, g); // frame
      const slide = box(0.065, 0.055, 0.3, M.trim, 0, 0.078, -0.09, g);
      slide.name = 'slide';
      box(0.067, 0.008, 0.22, M.glow, 0, 0.06, -0.09, g);
      cyl(0.014, 0.05, M.gun, 0, 0.07, -0.26, g);
      const grip = box(0.055, 0.15, 0.08, M.dark, 0, -0.07, 0.02, g);
      grip.rotation.x = 0.28;
      box(0.012, 0.02, 0.012, M.glow, 0, 0.115, 0.04, g); // rear sight dot
      box(0.008, 0.02, 0.008, M.glow, 0, 0.115, -0.22, g); // front sight
      arm(M, g, new THREE.Vector3(0, -0.07, 0.03));
      muzzle.position.set(0, 0.075, -0.3);
      break;
    }
    case 'shotgun': {
      box(0.09, 0.11, 0.38, M.gun, 0, 0, -0.05, g); // receiver
      cyl(0.026, 0.62, M.trim, 0, 0.03, -0.5, g); // barrel
      cyl(0.022, 0.5, M.gun, 0, -0.03, -0.44, g); // mag tube
      const pump = box(0.075, 0.07, 0.18, M.dark, 0, -0.03, -0.42, g);
      pump.name = 'pump';
      box(0.07, 0.1, 0.25, M.dark, 0, -0.04, 0.24, g).rotation.x = -0.15; // stock
      box(0.092, 0.012, 0.3, M.glow, 0, 0.035, -0.05, g);
      box(0.012, 0.012, 0.012, M.glow, 0, 0.06, -0.8, g);
      for (let i = 0; i < 3; i++) box(0.02, 0.02, 0.02, M.glow, 0.047, -0.005, 0.05 - i * 0.05, g);
      arm(M, g, new THREE.Vector3(0, -0.08, 0.07));
      muzzle.position.set(0, 0.03, -0.82);
      break;
    }
    case 'rifle': {
      box(0.075, 0.1, 0.46, M.gun, 0, 0, -0.1, g);
      box(0.06, 0.06, 0.3, M.dark, 0, -0.01, -0.45, g); // handguard
      cyl(0.016, 0.22, M.trim, 0, 0.01, -0.68, g);
      const mag = box(0.05, 0.16, 0.08, M.dark, 0, -0.12, -0.1, g);
      mag.rotation.x = 0.2;
      mag.name = 'mag';
      box(0.06, 0.09, 0.22, M.dark, 0, -0.02, 0.22, g); // stock
      // holo sight
      box(0.05, 0.012, 0.09, M.gun, 0, 0.06, -0.05, g);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 10, 40), M.gun);
      frame.position.set(0, 0.095, -0.07);
      g.add(frame);
      box(0.006, 0.006, 0.002, M.glow, 0, 0.095, -0.07, g);
      box(0.077, 0.01, 0.3, M.glow, 0, -0.035, -0.12, g);
      arm(M, g, new THREE.Vector3(0, -0.07, 0.05));
      muzzle.position.set(0, 0.01, -0.8);
      break;
    }
    case 'rail': {
      box(0.09, 0.12, 0.5, M.gun, 0, 0, -0.05, g);
      box(0.05, 0.05, 0.75, M.trim, 0, 0.035, -0.55, g);
      box(0.05, 0.03, 0.7, M.dark, 0, -0.035, -0.52, g);
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 12, 40), M.glow.clone());
        c.position.set(0, 0.0, -0.32 - i * 0.11);
        g.add(c);
        coils.push(c);
      }
      box(0.07, 0.1, 0.26, M.dark, 0, -0.02, 0.28, g);
      box(0.03, 0.04, 0.16, M.gun, 0, 0.09, -0.02, g); // scope
      box(0.02, 0.02, 0.02, M.glow, 0, 0.09, -0.11, g);
      arm(M, g, new THREE.Vector3(0, -0.08, 0.08));
      muzzle.position.set(0, 0.0, -0.95);
      break;
    }
    case 'launcher': {
      box(0.1, 0.12, 0.34, M.gun, 0, 0, 0.02, g);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 32), M.trim);
      drum.rotation.x = Math.PI / 2;
      drum.position.set(0, -0.01, -0.22);
      drum.name = 'drum';
      g.add(drum);
      cyl(0.055, 0.36, M.gun, 0, 0.02, -0.48, g, 10);
      cyl(0.062, 0.05, M.trim, 0, 0.02, -0.66, g, 10);
      for (let i = 0; i < 3; i++) box(0.102, 0.006, 0.012, M.glow, 0, 0.062, -0.05 - i * 0.05, g);
      box(0.07, 0.1, 0.2, M.dark, 0, -0.04, 0.25, g);
      arm(M, g, new THREE.Vector3(0, -0.08, 0.06));
      muzzle.position.set(0, 0.02, -0.7);
      break;
    }
  }
  g.add(muzzle);
  g.scale.setScalar(0.85);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
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
      if (drum) drum.rotation.y += dt * 8;
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

// Game orchestration: state machine, waves, combat resolution, pickups, progression.

import * as THREE from 'three';
import { AudioEngine } from './audio.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { Input, Player } from './player.js';
import { WeaponSystem, WEAPONS } from './weapons.js';
import { EnemyManager, ENEMY_TYPES } from './enemies.js';
import { UI } from './ui.js';
import { Post } from './post.js';
import { raycastWorld, raySphere, groundHeight } from './physics.js';
import {
  PERKS, rollCards, loadSave, writeSave, loadSettings, writeSettings, baseMods, embersForRun,
} from './progression.js';

const PIXEL_RATIO = { high: 1.5, medium: 1, low: 0.75 };
const ROMAN = ['', 'I', 'II', 'III'];
const WAVE_FLAVOR = [
  'They come through the gates',
  'Hold the line',
  'The dark grows hungry',
  'Do not let the flame die',
  'The rain will not wash this away',
  'Stand. Fight. Endure.',
];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Game {
  constructor(container) {
    this.settings = loadSettings();
    this.save = loadSave();

    // Renderer
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO[this.settings.quality]));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    this.canvas = r.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Weapon overlay scene with its own lighting
    this.wScene = new THREE.Scene();
    this.wCamera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 10);
    this.wScene.add(this.wCamera);
    this.wScene.add(new THREE.HemisphereLight(0x7a8cb0, 0x1a120e, 1.4));
    const key = new THREE.DirectionalLight(0xffd2a8, 2.6);
    key.position.set(1, 2, 1.2);
    this.wScene.add(key);
    const rim = new THREE.DirectionalLight(0x6fe0ff, 0.9);
    rim.position.set(-1.5, 0.5, -1);
    this.wScene.add(rim);

    this.audio = new AudioEngine();
    this.ui = new UI(this.audio);
    this.input = new Input(this.canvas);

    this.world = new World(this.scene, r, this.settings.quality);
    this.world.build();
    this.world.onThunder = () => this.audio.play('thunder', { vol: 0.8, pan: Math.random() - 0.5 });
    this.wScene.environment = this.world.envMap;
    this.wScene.environmentIntensity = 0.8;

    this.fx = new Effects(this.scene, r);
    this.player = new Player(this.camera, this.audio);
    this.weapons = new WeaponSystem(this.wScene, this.wCamera, this.audio);
    this.enemies = new EnemyManager(this.scene, this.fx, this.audio);
    this.enemies.setColliders(this.world.colliders);
    this.enemies.onKill = (e, pos) => this.onKill(e, pos);

    // Flashlight
    this.flashlight = new THREE.SpotLight(0xdfe8ff, 0, 40, 0.5, 0.75, 1.7);
    this.scene.add(this.flashlight, this.flashlight.target);
    this.flashlightOn = true;

    this.post = new Post(r, this.scene, this.camera, this.wScene, this.wCamera);
    this.post.setQuality(this.settings.quality);
    this.post.setSize(window.innerWidth, window.innerHeight);

    this._initPickups();
    this.grenades = [];
    this.grenadeGeo = new THREE.SphereGeometry(0.13, 10, 8);
    this.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, emissive: 0xff6a20, emissiveIntensity: 3 });

    this.ctx = {
      player: this.player,
      damagePlayer: (d, from) => this.damagePlayer(d, from),
      spatial: (pos, vol) => this.spatial(pos, vol),
      shake: (pos, amt) => this.player.addTrauma(amt * Math.max(0.15, 1 - pos.distanceTo(this.player.pos) / 30)),
      announce: (t) => this.ui.banner(t, '', { boss: true, duration: 2 }),
      summon: (n) => this.summonAdds(n),
      aliveCount: () => this.enemies.list.length,
      burnDamage: (e, d) => this.applyDamage(e, d, { point: _v2.copy(e.pos).setY(e.pos.y + e.def.height * 0.6), burn: true }),
    };

    this.state = 'menu';
    this.timeScale = 1;
    this.menuAngle = 0.6;
    this.hurtFlash = 0;
    this.stats = this._freshStats();
    this.mods = baseMods(this.save);
    this.wave = 0;
    this.score = 0;
    this.shards = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.comboWindow = 3;

    this.input.onLockChange = (locked) => this._onLock(locked);
    this.ui.onAction = (a, el) => this._onAction(a, el);
    this.ui.bindSettings(this.settings, (k) => this._onSetting(k));
    this.ui.updateMenu(this.save);
    this.ui.show('menu');

    window.addEventListener('resize', () => this._resize());
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.locked) this.input.lock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && this.state === 'playing') this.flashlightOn = !this.flashlightOn;
      if (e.code === 'Escape' && this.ui.screenStack.length && ['settings', 'manual', 'reliquary'].includes(this.ui.current)) this._onAction('back');
    });
    // Start audio on the first gesture anywhere.
    const kick = () => {
      this.audio.init();
      this.audio.setVolumes(this.settings.sfx, this.settings.music);
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);

    this.last = performance.now();
    this._compileWarmup();
    this.ui.loaded();
    // ?manual disables the rAF loop so automated tests can step frames themselves.
    if (!new URLSearchParams(location.search).has('manual')) requestAnimationFrame((t) => this._loop(t));
    window.__game = this;
  }

  // Render once with one of each enemy so shader programs compile before play.
  _compileWarmup() {
    const tmp = Object.keys(ENEMY_TYPES).map((t, i) => this.enemies.spawn(t, new THREE.Vector3(i * 3 - 6, 0, 30), {}));
    this.fx.explosion(new THREE.Vector3(0, -20, 0), 1);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.wScene, this.wCamera);
    for (const e of tmp) this.scene.remove(e.root);
    this.enemies.clear();
  }

  _freshStats() {
    return { kills: 0, shots: 0, hits: 0, crits: 0, damage: 0, time: 0, bossKills: 0, wave: 0 };
  }

  // --- settings / screens -------------------------------------------------------------------
  _onSetting(k) {
    writeSettings(this.settings);
    if (k === 'sfx' || k === 'music') this.audio.setVolumes(this.settings.sfx, this.settings.music);
    if (k === 'quality') {
      const q = this.settings.quality;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO[q]));
      this.world.moon.castShadow = q !== 'low';
      this.post.setQuality(q);
      this._resize();
    }
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = this.wCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.wCamera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  _onLock(locked) {
    if (locked) {
      this.hadLock = true;
      this.ui.setResumeHint(false);
      if (this.state === 'paused') this._resume();
    } else if (this.state === 'playing' && this.hadLock) {
      this._pause();
    }
  }

  _pause() {
    this.state = 'paused';
    document.querySelector('#pause-sub').textContent = `Wave ${this.wave} · Score ${this.score.toLocaleString()}`;
    this.ui.show('pause');
  }

  _resume() {
    this.state = 'playing';
    this.ui.hideScreens();
    this.ui.screenStack = [];
    this.last = performance.now();
  }

  _onAction(a, el) {
    switch (a) {
      case 'start':
        this.startRun();
        break;
      case 'reliquary':
        this.ui.buildReliquary(this.save);
        this.ui.push('reliquary');
        break;
      case 'settings':
        this.ui.push('settings');
        break;
      case 'manual':
        this.ui.push('manual');
        break;
      case 'back':
        this.ui.pop();
        this.ui.updateMenu(this.save);
        break;
      case 'menu':
        this.toMenu();
        break;
      case 'resume':
        this.input.lock();
        // If pointer lock is refused (e.g. too soon after Esc), resume anyway; a click re-locks.
        setTimeout(() => {
          if (this.state === 'paused') {
            this._resume();
            if (!this.input.locked) this.ui.setResumeHint(true);
          }
        }, 250);
        break;
      case 'abandon':
        this.finishRun();
        break;
      case 'perk': {
        const p = PERKS.find((x) => x.id === el.dataset.id);
        const lvl = this.save.perks[p.id] || 0;
        const cost = p.cost(lvl);
        if (lvl < p.max && this.save.embers >= cost) {
          this.save.embers -= cost;
          this.save.perks[p.id] = lvl + 1;
          writeSave(this.save);
          this.audio.play('buy');
          this.ui.buildReliquary(this.save);
        }
        break;
      }
      case 'card':
        this.pickCard(parseInt(el.dataset.i, 10));
        break;
      case 'reroll':
        if (this.rerolls > 0 && !this.pickedCard) {
          this.rerolls--;
          this.cardChoices = rollCards(this.cardsTaken, 3, this.wave * 0.03);
          this.ui.renderCards(this);
        }
        break;
      case 'buy':
        this.buy(el.dataset.id);
        break;
      case 'next-wave':
        if (!this.pickedCard) return;
        this.ui.hideScreens();
        this.ui.setHud(true);
        this.state = 'playing';
        this.input.lock();
        this.beginWave(this.wave + 1);
        break;
    }
  }

  // --- run lifecycle -----------------------------------------------------------------------
  startRun() {
    this.audio.init();
    this.audio.setVolumes(this.settings.sfx, this.settings.music);
    this.mods = baseMods(this.save);
    this.player.reset(this.mods);
    this.player.armor = this.mods.startArmor;
    this.weapons.reset(this.mods.startWeapons);
    this.enemies.clear();
    this._clearPickups();
    this.grenades.forEach((g) => this.scene.remove(g.mesh));
    this.grenades = [];
    this.stats = this._freshStats();
    this.wave = 0;
    this.score = 0;
    this.shards = this.mods.startShards;
    this.combo = 0;
    this.cardsTaken = {};
    this.rerolls = this.mods.rerolls;
    this.queue = [];
    this.waveActive = false;
    this.timeScale = 1;
    this.deathT = 0;
    this.hurtFlash = 0;
    this.adrenal = 0;
    this.lastDash = 0;
    this.sinceHit = 99;
    this.heartbeat = 0;
    this.ui.clearTransient();
    this.ui.screenStack = [];
    this.ui.hideScreens();
    this.ui.setHud(true);
    this.state = 'playing';
    this.input.lock();
    this.ui.banner('THE VIGIL BEGINS', 'Keep the last light burning', { duration: 2.4 });
    this.startDelay = 2.6;
  }

  toMenu() {
    this.state = 'menu';
    this.enemies.clear();
    this._clearPickups();
    this.ui.setHud(false);
    this.ui.screenStack = [];
    this.ui.updateMenu(this.save);
    this.ui.show('menu');
    this.input.unlock();
  }

  finishRun() {
    this.stats.wave = this.wave;
    const embers = embersForRun(this.stats, this.mods);
    const newBest = this.wave > this.save.best;
    this.save.embers += embers;
    this.save.best = Math.max(this.save.best, this.wave);
    this.save.runs++;
    this.save.kills += this.stats.kills;
    this.save.bossKills += this.stats.bossKills;
    writeSave(this.save);
    this.ui.buildDeath(this, embers, newBest);
    this.ui.setHud(false);
    this.ui.screenStack = [];
    this.ui.show('death');
    this.state = 'over';
    this.input.unlock();
  }

  die() {
    this.player.dead = true;
    this.player.hp = 0;
    this.state = 'dead';
    this.deathT = 0;
    this.audio.play('death');
    this.ui.banner('THE LIGHT FADES', '', { duration: 2.5 });
  }

  // --- waves -------------------------------------------------------------------------------
  scaling(n) {
    const k = n - 1;
    return { hp: 1 + 0.13 * k + 0.006 * k * k, dmg: 1 + 0.05 * k, speed: 1 + Math.min(0.25, 0.012 * k) };
  }

  composeWave(n) {
    const q = [];
    const boss = n % 5 === 0;
    let budget = boss ? 6 + n * 2 : 9 + n * 4.2 + n * n * 0.25;
    const pool = [
      { t: 'husk', cost: 1, w: 5, min: 1 },
      { t: 'stalker', cost: 1.3, w: 3, min: 2 },
      { t: 'wisp', cost: 2.2, w: 2.4, min: 3 },
      { t: 'brute', cost: 7, w: n >= 8 ? 1.4 : 0.8, min: 4 },
    ].filter((p) => n >= p.min);
    while (budget > 0) {
      const tot = pool.reduce((a, p) => a + p.w, 0);
      let r = Math.random() * tot;
      let pick = pool[0];
      for (const p of pool) {
        if ((r -= p.w) <= 0) {
          pick = p;
          break;
        }
      }
      q.push(pick.t);
      budget -= pick.cost;
    }
    // shuffle, but keep brutes away from the very start
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    for (let i = 0; i < Math.min(4, q.length); i++) {
      if (q[i] !== 'brute') continue;
      const j = q.findIndex((t, k) => k >= 4 && t !== 'brute');
      if (j > 0) [q[i], q[j]] = [q[j], q[i]];
    }
    if (boss) q.unshift('warden');
    return q;
  }

  beginWave(n) {
    this.wave = n;
    this.queue = this.composeWave(n);
    this.waveTotal = this.queue.length;
    this.waveActive = true;
    this.spawnTimer = 1.2;
    this.windUsed = false;
    this.clearTimer = 0;
    const boss = n % 5 === 0;
    if (boss) this.ui.banner('THE WARDEN', 'Keeper of the gates descends', { boss: true, duration: 3 });
    else this.ui.banner(`WAVE ${n}`, WAVE_FLAVOR[(n - 1) % WAVE_FLAVOR.length], { duration: 2.4 });
    this.audio.play('waveStart');
    // Restock ammo crates on the platforms
    for (const spot of this.world.pickupSpots) {
      if (!this.pickups.some((p) => p.type === 'ammo' && p.pos.distanceTo(spot) < 1.5)) this.spawnPickup('ammo', spot.clone().setY(spot.y + 0.4), 1, true);
    }
    this.last = performance.now();
  }

  _spawnGate() {
    const gates = this.world.gates;
    const far = gates.map((g, i) => ({ i, d: g.pos.distanceTo(this.player.pos) })).filter((g) => g.d > 14);
    const pick = far.length ? far[Math.floor(Math.random() * far.length)].i : Math.floor(Math.random() * gates.length);
    return pick;
  }

  spawnEnemy(type) {
    const gi = this._spawnGate();
    const gate = this.world.gates[gi];
    const pos = gate.pos.clone();
    const side = new THREE.Vector3(-gate.dirIn.z, 0, gate.dirIn.x);
    pos.addScaledVector(side, (Math.random() - 0.5) * 2.4).addScaledVector(gate.dirIn, Math.random() * 1.5);
    if (type === 'warden') pos.addScaledVector(gate.dirIn, 4);
    this.world.pulseGate(gi);
    const e = this.enemies.spawn(type, pos, this.scaling(this.wave));
    this.fx.spawnBurst(pos, ENEMY_TYPES[type].glow);
    this.audio.play('spawn', this.spatial(pos, 0.8));
    return e;
  }

  summonAdds(n) {
    for (let i = 0; i < n; i++) this.spawnEnemy(Math.random() < 0.5 ? 'husk' : 'stalker');
  }

  _updateWave(dt) {
    if (this.startDelay > 0) {
      this.startDelay -= dt;
      if (this.startDelay <= 0) this.beginWave(1);
      return;
    }
    if (this.waveActive) {
      const maxAlive = Math.min(24, 7 + Math.floor(this.wave * 1.4));
      if (this.queue.length && this.enemies.list.length < maxAlive) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnEnemy(this.queue.shift());
          this.spawnTimer = Math.max(0.3, 1.25 - this.wave * 0.05) * (0.5 + Math.random());
        }
      }
      if (!this.queue.length && this.enemies.list.length === 0) this.waveCleared();
    } else if (this.clearTimer > 0) {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this.openIntermission();
    }
  }

  waveCleared() {
    this.waveActive = false;
    this.clearTimer = 3.2;
    const bonus = 10 + this.wave * 4;
    this.shards += bonus;
    const heal = Math.round(this.player.maxHp * 0.25);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    this.ui.banner('WAVE CLEARED', `+◆ ${bonus}  ·  +${heal} health`, { duration: 2.6 });
    this.audio.play('waveClear');
    this.collectAll = true;
  }

  openIntermission() {
    this.collectAll = false;
    for (const p of [...this.pickups]) if (p.type === 'shard') this._collect(p);
    this.state = 'intermission';
    this.ui.setHud(false);
    this.input.unlock();
    this.pickedCard = null;
    this.cardChoices = rollCards(this.cardsTaken, 3, this.wave * 0.03);
    this.ui.buildIntermission(this);
    this.ui.show('intermission');
  }

  pickCard(i) {
    if (this.pickedCard) return;
    const c = this.cardChoices[i];
    if (!c) return;
    c.apply(this.mods, this);
    this.cardsTaken[c.id] = (this.cardsTaken[c.id] || 0) + 1;
    this.pickedCard = c.id;
    this.audio.play('buy');
    this.ui.renderCards(this);
    this.ui.renderArmory(this);
  }

  armoryItems() {
    const items = [];
    for (const def of WEAPONS) {
      const s = this.weapons.state[def.id];
      const color = '#' + def.color.toString(16).padStart(6, '0');
      if (!s.owned) {
        items.push({ id: 'w_' + def.id, group: 'Weapons', name: def.name, desc: def.desc, cost: def.cost, color });
      }
    }
    for (const def of WEAPONS) {
      const s = this.weapons.state[def.id];
      if (!s.owned) continue;
      const color = '#' + def.color.toString(16).padStart(6, '0');
      items.push({
        id: 'u_' + def.id, group: 'Mastery', name: `${def.name} ${ROMAN[Math.min(3, s.tier + 1)]}`,
        desc: s.tier >= 3 ? 'Fully mastered' : '+20% damage with this weapon', cost: this.masteryCost(def, s.tier),
        done: s.tier >= 3, doneLabel: 'MAX', color,
      });
    }
    const p = this.player;
    items.push({ id: 'ammo', group: 'Supplies', name: 'Munitions', desc: 'Refill all reserve ammunition', cost: 18 + this.wave * 2, disabled: !this._anyAmmoMissing() });
    items.push({ id: 'armor', group: 'Supplies', name: 'Armor Plating', desc: `Restore armor to full (${p.maxArmor})`, cost: 22 + this.wave * 2, disabled: p.armor >= p.maxArmor });
    items.push({ id: 'heal', group: 'Supplies', name: 'Mending Rite', desc: 'Restore health to full', cost: 26 + this.wave * 3, disabled: p.hp >= p.maxHp });
    return items;
  }

  masteryCost(def, tier) {
    return Math.round(((def.cost || 60) * 0.5 + 45) * (tier + 1));
  }

  _anyAmmoMissing() {
    return WEAPONS.some((def) => {
      const s = this.weapons.state[def.id];
      return s.owned && def.reserve !== Infinity && s.reserve < this.weapons.maxReserve(def, this.mods);
    });
  }

  buy(id) {
    const item = this.armoryItems().find((i) => i.id === id);
    if (!item || item.done || item.disabled || this.shards < item.cost) {
      this.audio.play('deny');
      return;
    }
    this.shards -= item.cost;
    if (id.startsWith('w_')) {
      const wid = id.slice(2);
      this.weapons.unlock(wid, this.mods);
      this.weapons.equip(wid, true);
    } else if (id.startsWith('u_')) {
      this.weapons.state[id.slice(2)].tier++;
    } else if (id === 'ammo') this.weapons.refill(this.mods, 1);
    else if (id === 'armor') this.player.armor = this.player.maxArmor;
    else if (id === 'heal') this.player.hp = this.player.maxHp;
    this.audio.play('buy');
    this.ui.renderArmory(this);
  }

  waveLabel() {
    if (this.wave === 0) return 'PREPARE';
    return this.wave % 5 === 0 ? `WAVE ${this.wave} · THE WARDEN` : `WAVE ${this.wave}`;
  }

  waveSubLabel() {
    if (this.wave === 0) return 'The gates stir';
    if (!this.waveActive) return 'Cleared';
    const remaining = this.queue.length + this.enemies.list.length;
    return `${remaining} remain`;
  }

  // --- combat ------------------------------------------------------------------------------
  spatial(pos, vol = 1) {
    const cam = this.camera.position;
    const d = pos.distanceTo(cam);
    const v = vol * Math.max(0.06, Math.min(1, 1.15 - d / 40));
    const right = _v.set(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw));
    const dx = pos.x - cam.x, dz = pos.z - cam.z;
    const l = Math.hypot(dx, dz) || 1;
    return { vol: v, pan: ((dx * right.x + dz * right.z) / l) * 0.8 };
  }

  castRay(origin, dir, maxDist, pierce) {
    const w = raycastWorld(this.world.colliders, origin, dir, maxDist);
    const worldT = w ? w.t : maxDist;
    const normal = w ? w.normal.clone() : null;
    const hits = [];
    for (const e of this.enemies.list) {
      if (e.dead) continue;
      let best = Infinity, crit = false;
      for (let i = 0; i < e.hit.length; i++) {
        const hw = e.hitWorld[i];
        const t = raySphere(origin, dir, hw.x, hw.y, hw.z, e.hit[i].r * e.root.scale.x);
        if (t >= 0 && t < worldT) {
          if (t < best) best = t;
          if (e.hit[i].crit) crit = true;
        }
      }
      if (best < Infinity) hits.push({ e, t: best, crit });
    }
    hits.sort((a, b) => a.t - b.t);
    return { worldT, normal, worldHit: !!w, hits: pierce ? hits : hits.slice(0, 1) };
  }

  _weaponDamageMul(def) {
    const tier = this.weapons.state[def.id].tier;
    return (1 + tier * 0.2) * this.mods.damageMul * (this.adrenal > 0 ? 1 + this.mods.dashDamage : 1);
  }

  fire(def, origin, dirs, muzzle, fwd) {
    this.stats.shots++;
    this.fx.muzzle(muzzle, fwd, def.color);
    if (def.projectile) {
      this._launchGrenade(def, muzzle, dirs[0]);
      return;
    }
    let anyHit = false, anyCrit = false, anyKill = false;
    const mul = this._weaponDamageMul(def);
    dirs.forEach((dir, pi) => {
      const res = this.castRay(origin, dir, def.range, def.pierce);
      let endT = res.worldT;
      for (const h of res.hits) {
        anyHit = true;
        let dmg = def.damage * mul;
        if (h.crit) {
          dmg *= this.mods.critMul;
          anyCrit = true;
        }
        if (def.pellets > 1) dmg *= Math.max(0.35, Math.min(1, 1 - (h.t - 9) / 26));
        if (h.e.hp / h.e.maxHp < 0.35) dmg *= 1 + this.mods.executeMul;
        const point = origin.clone().addScaledVector(dir, h.t);
        const knock = def.knockback ? dir.clone().setY(0.15).multiplyScalar(def.knockback) : null;
        const killed = this.applyDamage(h.e, dmg, { crit: h.crit, point, knock });
        if (killed) anyKill = true;
        this.fx.impact(point, _v.copy(dir).negate(), h.e.type === 'wisp' || (h.crit && h.e.type === 'warden') ? 'energy' : 'flesh');
        if (!def.pierce) endT = h.t;
      }
      const end = origin.clone().addScaledVector(dir, endT);
      if (res.worldHit && (def.pierce || !res.hits.length)) this.fx.impact(end, res.normal, 'spark');
      if (def.id === 'rail') this.fx.beam(muzzle, end, def.tracer);
      else if (def.pellets === 1 || pi % 2 === 0) this.fx.tracer(muzzle, end, def.tracer, def.pellets > 1 ? 0.018 : 0.025, 0.06);
    });
    if (anyHit) {
      this.stats.hits++;
      if (anyCrit) this.stats.crits++;
      this.audio.play(anyCrit ? 'crit' : 'hit');
      this.ui.hitmarker(anyKill ? 'kill' : anyCrit ? 'crit' : 'hit');
    }
  }

  _launchGrenade(def, muzzle, dir) {
    const mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
    mesh.position.copy(muzzle);
    this.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(34).addScaledVector(UP, 2.5).add(this.player.vel.clone().multiplyScalar(0.3));
    this.grenades.push({ mesh, vel, life: 2.5, def });
  }

  _updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.life -= dt;
      g.vel.y -= 16 * dt;
      const p = g.mesh.position;
      const step = g.vel.length() * dt;
      const dir = _v.copy(g.vel).normalize();
      const hit = raycastWorld(this.world.colliders, p, dir, step);
      let explode = g.life <= 0;
      if (hit) {
        p.addScaledVector(dir, Math.max(0, hit.t - 0.05));
        explode = true;
      } else p.addScaledVector(g.vel, dt);
      if (!explode) {
        for (const e of this.enemies.list) {
          if (e.dead) continue;
          for (let k = 0; k < e.hit.length; k++) {
            if (e.hitWorld[k].distanceTo(p) < e.hit[k].r + 0.2) {
              explode = true;
              break;
            }
          }
          if (explode) break;
        }
      }
      this.fx.trail(p, new THREE.Color(2.5, 1.0, 0.3), 0.18, 0.25);
      if (explode) {
        this._explode(p.clone(), g.def);
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  _explode(pos, def) {
    const R = def.splash;
    this.fx.explosion(pos, R * 0.6, 0xff7a2a);
    this.audio.play('explosion', this.spatial(pos, 1));
    const mul = this._weaponDamageMul(def);
    let hitAny = false, killAny = false;
    for (const e of [...this.enemies.list]) {
      if (e.dead) continue;
      const c = _v2.copy(e.pos).setY(e.pos.y + (e.def.flying ? 0 : e.def.height * 0.45));
      const d = Math.max(0, c.distanceTo(pos) - e.radius);
      if (d > R) continue;
      const k = 1 - (d / R) * 0.65;
      let dmg = def.damage * mul * k;
      if (e.hp / e.maxHp < 0.35) dmg *= 1 + this.mods.executeMul;
      const knock = c.clone().sub(pos).setY(0.6).normalize().multiplyScalar(8 * k);
      if (this.applyDamage(e, dmg, { point: c.clone(), knock })) killAny = true;
      hitAny = true;
    }
    if (hitAny) {
      this.stats.hits++;
      this.ui.hitmarker(killAny ? 'kill' : 'hit');
    }
    // Self knockback (rocket jump) — no self damage.
    const pc = this.player.pos.clone().setY(this.player.pos.y + 0.9);
    const pd = pc.distanceTo(pos);
    if (pd < R) {
      const k = 1 - pd / R;
      const push = pc.sub(pos).normalize();
      this.player.vel.addScaledVector(push, 15 * k);
      this.player.vel.y += 6 * k;
      this.player.onGround = false;
    }
    this.player.addTrauma(Math.max(0, 0.5 - pd / 30));
  }

  // Central damage application to enemies. Returns true if it killed.
  applyDamage(e, dmg, { crit = false, point = null, knock = null, burn = false } = {}) {
    if (e.dead) return false;
    let burnDps = 0;
    if (!burn && this.mods.igniteChance > 0 && Math.random() < this.mods.igniteChance) burnDps = 10 + this.wave * 1.2;
    this.stats.damage += Math.min(dmg, e.hp);
    if (point) this.ui.damageNumber(point, dmg, burn ? 'burn' : crit ? 'crit' : '');
    return this.enemies.damage(e, dmg, { knock, burn: burnDps });
  }

  onKill(e, pos) {
    this.stats.kills++;
    this.combo++;
    this.comboTimer = this.comboWindow;
    const mult = 1 + Math.min(15, this.combo - 1) * 0.25;
    this.score += Math.round(e.def.score * mult);
    this.audio.play('gore', this.spatial(pos, 0.9));
    this.audio.play('kill', { vol: 0.6 });
    if (this.mods.lifeOnKill) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.mods.lifeOnKill);

    if (e.def.boss) {
      this.stats.bossKills++;
      this.timeScale = 0.25;
      this.slowmoT = 1.4;
      this.ui.banner('WARDEN FELLED', 'The gates tremble', { boss: true, duration: 3 });
      this.audio.play('roar', { vol: 0.8 });
      this.player.addTrauma(0.8);
    }

    // Chain Spark
    if (this.mods.chainDamage > 0 && (this.chainDepth || 0) < 4) {
      this.chainDepth = (this.chainDepth || 0) + 1;
      this.fx.explosion(pos, 1.8, 0x7fe8ff);
      for (const o of [...this.enemies.list]) {
        if (o === e || o.dead) continue;
        if (o.pos.distanceTo(pos) < 4.5 + o.radius) this.applyDamage(o, this.mods.chainDamage * this.mods.damageMul, { point: _v2.copy(o.pos).setY(o.pos.y + 1) });
      }
      this.chainDepth--;
    }

    // Drops
    const total = Math.max(1, Math.round(e.def.shards * this.mods.shardMul * (0.8 + Math.random() * 0.5)));
    const n = Math.min(total, e.def.boss ? 14 : 5);
    for (let i = 0; i < n; i++) this.spawnPickup('shard', pos, Math.ceil(total / n));
    const r = Math.random();
    const healthChance = e.type === 'brute' ? 0.4 : e.def.boss ? 1 : 0.09;
    const ammoChance = this.weapons.needsAmmo(this.mods) ? 0.28 : 0.1;
    if (r < healthChance) this.spawnPickup('health', pos, 25);
    else if (r < healthChance + ammoChance) this.spawnPickup('ammo', pos, 1);
    else if (r < healthChance + ammoChance + 0.05 || e.def.boss) this.spawnPickup('armor', pos, 25);
  }

  damagePlayer(dmg, from) {
    const p = this.player;
    if (p.dead || this.state !== 'playing') return;
    if (p.invuln > 0) return;
    const lethal = p.takeDamage(dmg);
    this.sinceHit = 0;
    this.hurtFlash = Math.min(1, 0.35 + dmg / 35);
    this.audio.play('hurt', { vol: 0.8 });
    const dx = from.x - p.pos.x, dz = from.z - p.pos.z;
    const f = -Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz;
    const r = Math.cos(p.yaw) * dx - Math.sin(p.yaw) * dz;
    this.ui.damageIndicator(Math.atan2(r, f));
    if (lethal) {
      if (this.mods.secondWind && !this.windUsed) {
        this.windUsed = true;
        p.hp = 30;
        p.invuln = 1.5;
        this.ui.banner('SECOND WIND', 'Not yet.', { duration: 1.6 });
        this.audio.play('secondWind');
      } else this.die();
    }
  }

  // --- pickups -----------------------------------------------------------------------------
  _initPickups() {
    this.pickups = [];
    const shardMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa030, emissiveIntensity: 4 });
    const healthMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9ff4ff, emissiveIntensity: 3.5 });
    const ammoBody = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.5, metalness: 0.7 });
    const ammoGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb040, emissiveIntensity: 3 });
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x0a1422, emissive: 0x3a8aff, emissiveIntensity: 2.5, metalness: 0.6, roughness: 0.3 });
    this.pickupTemplates = {
      shard: () => new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), shardMat),
      health: () => {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.13), healthMat));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.13), healthMat));
        return g;
      },
      ammo: () => {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.32), ammoBody));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.34), ammoGlow));
        return g;
      },
      armor: () => new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 6), armorMat),
    };
  }

  spawnPickup(type, pos, value, permanent = false) {
    const mesh = this.pickupTemplates[type]();
    mesh.position.copy(pos);
    mesh.position.y = Math.max(mesh.position.y, 0.5);
    this.scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const s = type === 'shard' ? 2 + Math.random() * 3 : 1.5;
    this.pickups.push({
      type, mesh, pos: mesh.position, value,
      vel: permanent ? new THREE.Vector3() : new THREE.Vector3(Math.cos(a) * s, 4 + Math.random() * 3, Math.sin(a) * s),
      life: permanent ? Infinity : type === 'shard' ? 30 : 25,
      t: Math.random() * 10,
      rest: permanent,
      age: 0,
    });
  }

  _clearPickups() {
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = [];
  }

  _canCollect(p) {
    const pl = this.player;
    if (p.type === 'health') return pl.hp < pl.maxHp;
    if (p.type === 'armor') return pl.armor < pl.maxArmor;
    if (p.type === 'ammo') return this._anyAmmoMissing();
    return true;
  }

  _collect(p) {
    const pl = this.player;
    if (p.type === 'shard') {
      this.shards += p.value;
      this.audio.play('shard', { vol: 0.6 });
    } else if (p.type === 'health') {
      pl.hp = Math.min(pl.maxHp, pl.hp + p.value);
      this.audio.play('pickup');
      this.ui.feed(`<span class="v" style="color:#9ff4ff">+${p.value}</span> health`);
    } else if (p.type === 'armor') {
      pl.armor = Math.min(pl.maxArmor, pl.armor + p.value);
      this.audio.play('pickup');
      this.ui.feed(`<span class="v" style="color:#7fc6ff">+${p.value}</span> armor`);
    } else if (p.type === 'ammo') {
      this.weapons.refill(this.mods, 0.35);
      this.audio.play('pickup');
      this.ui.feed(`<span class="v">+</span> ammunition`);
    }
    this.scene.remove(p.mesh);
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  _updatePickups(dt) {
    const pl = this.player;
    const center = _v.copy(pl.pos).setY(pl.pos.y + 0.9);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.age += dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
        continue;
      }
      const d = p.pos.distanceTo(center);
      const collectable = this._canCollect(p);
      const magnet = p.type === 'shard' ? this.mods.magnet : 2.2;
      if (collectable && p.age > 0.35 && (d < magnet || (this.collectAll && p.type === 'shard'))) {
        const pull = _v2.copy(center).sub(p.pos).normalize().multiplyScalar(Math.max(10, 24 - d));
        p.vel.lerp(pull, Math.min(1, dt * 8));
        p.pos.addScaledVector(p.vel, dt);
        p.rest = false;
        if (d < 0.9) {
          this._collect(p);
          continue;
        }
      } else if (!p.rest) {
        p.vel.y -= 18 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const g = groundHeight(this.world.colliders, p.pos.x, p.pos.z, 0.2, p.pos.y + 0.3) + 0.35;
        if (p.pos.y < g) {
          p.pos.y = g;
          if (Math.abs(p.vel.y) < 2) {
            p.rest = true;
            p.baseY = g;
          }
          p.vel.y *= -0.35;
          p.vel.x *= 0.5;
          p.vel.z *= 0.5;
        }
        if (Math.hypot(p.pos.x, p.pos.z) > 35) {
          const k = 35 / Math.hypot(p.pos.x, p.pos.z);
          p.pos.x *= k;
          p.pos.z *= k;
        }
      } else {
        if (p.baseY === undefined) p.baseY = p.pos.y;
        p.pos.y = p.baseY + 0.15 + Math.sin(p.t * 2.5) * 0.1;
      }
      p.mesh.rotation.y += dt * 2;
      if (p.type === 'shard') p.mesh.rotation.x += dt * 1.3;
      p.mesh.visible = p.life > 5 || Math.sin(p.life * 12) > 0;
    }
  }

  // --- main loop ---------------------------------------------------------------------------
  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 1 / 20);
    this.frame(dt);
  }

  frame(dt) {
    const s = this.state;
    if (s === 'playing' || s === 'dead') this._simulate(dt);
    else if (s === 'menu') this._menuCamera(dt);

    const live = s === 'playing' || s === 'dead' || s === 'paused' || s === 'intermission';
    this.world.update(dt * (s === 'paused' ? 0.2 : 1), this.camera.position);
    if (s !== 'paused') this.fx.update(dt * this.timeScale, (x, z, y) => groundHeight(this.world.colliders, x, z, 0.1, y));
    this._updateFlashlight(live && s !== 'over');

    this.audio.update(s === 'playing' && this.waveActive && this.enemies.list.length ? 1 : 0);
    const low = live ? Math.max(0, 1 - this.player.hp / this.player.maxHp / 0.35) : 0;
    this.post.render(dt, {
      damage: this.hurtFlash,
      low: Math.min(1, low),
      death: s === 'dead' ? Math.min(1, this.deathT / 2) : s === 'over' ? 1 : 0,
      weapon: s === 'playing' || s === 'paused' || s === 'intermission',
    });
    if (s === 'playing' || s === 'dead') this.ui.updateHUD(this, dt);
    this.input.endFrame();
  }

  _simulate(rawDt) {
    if (this.slowmoT > 0) {
      this.slowmoT -= rawDt;
      if (this.slowmoT <= 0) this.timeScale = 1;
    }
    const dt = rawDt * this.timeScale;
    const p = this.player;
    this.hurtFlash = Math.max(0, this.hurtFlash - rawDt * 1.8);

    if (this.state === 'dead') {
      this.deathT += rawDt;
      this.timeScale = Math.max(0.15, 1 - this.deathT);
      p.landDip = Math.min(1.2, p.landDip + rawDt * 0.9);
      p.pitch += (0.4 - p.pitch) * rawDt * 1.5;
      p.updateCamera(this.settings);
      this.camera.rotation.z = Math.min(0.5, this.deathT * 0.3);
      this.enemies.update(dt, this.ctx);
      if (this.deathT > 3) {
        this.timeScale = 1;
        this.finishRun();
      }
      return;
    }

    this.stats.time += dt;
    p.update(dt, this.input, this.world.colliders, this.settings);
    if (p.dashCount !== this.lastDash) {
      this.lastDash = p.dashCount;
      if (this.mods.dashDamage > 0) this.adrenal = 2;
    }
    this.adrenal = Math.max(0, (this.adrenal || 0) - dt);
    this.weapons.update(dt, this.input, p, this.mods, (def, o, dirs, m, f) => this.fire(def, o, dirs, m, f));
    this.enemies.update(dt, this.ctx);
    this._updateGrenades(dt);
    this._updatePickups(dt);
    this._updateWave(dt);

    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    this.sinceHit += dt;
    if (this.mods.armorRegen > 0 && this.sinceHit > 3) p.armor = Math.min(p.maxArmor, p.armor + this.mods.armorRegen * dt);

    if (p.hp / p.maxHp < 0.3 && !p.dead) {
      this.heartbeat -= dt;
      if (this.heartbeat <= 0) {
        this.audio.play('heartbeat', { vol: 0.8 });
        this.heartbeat = 0.7 + (p.hp / p.maxHp) * 2;
      }
    }
    this.world.setMonolithLife(Math.max(0, p.hp / p.maxHp));
  }

  _menuCamera(dt) {
    this.menuAngle += dt * 0.04;
    const a = this.menuAngle;
    this.camera.position.set(Math.cos(a) * 19, 4.2 + Math.sin(a * 0.7) * 0.8, Math.sin(a) * 19);
    this.camera.lookAt(Math.cos(a + 0.5) * 3, 6, Math.sin(a + 0.5) * 3);
    if (this.camera.fov !== 62) {
      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();
    }
    this.world.setMonolithLife(1);
  }

  _updateFlashlight(on) {
    const f = this.flashlight;
    f.intensity = on && this.flashlightOn ? 22 : 0;
    if (!f.intensity) return;
    const cam = this.camera;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    f.position.copy(cam.position).addScaledVector(right, 0.25).addScaledVector(UP, -0.15);
    f.target.position.copy(cam.position).addScaledVector(fwd, 12);
    f.target.updateMatrixWorld();
  }
}

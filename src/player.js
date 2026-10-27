// Input handling and the first-person player controller.

import * as THREE from 'three';
import { resolveActor, groundHeight } from './physics.js';

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouse = [false, false, false];
    this.mousePressed = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this.locked && ['Space', 'Tab', 'KeyF', 'KeyQ'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouse[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => (this.mouse[e.button] = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Guard against the occasional huge spike some browsers emit on lock.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true }
    );
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.keys.clear();
        this.mouse = [false, false, false];
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse = [false, false, false];
    });
  }

  lock() {
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        try { this.el.requestPointerLock(); } catch (e) { /* ignore */ }
      });
    } catch (e) {
      try { this.el.requestPointerLock(); } catch (e2) { /* ignore */ }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}

const EYE = 1.65;
const HEIGHT = 1.8;
const RADIUS = 0.42;

export class Player {
  constructor(camera, audio) {
    this.camera = camera;
    this.audio = audio;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = RADIUS;
    this.height = HEIGHT;
    this.reset({});
  }

  reset(stats) {
    this.pos.set(0, 0.5, 9);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.05;
    this.maxHp = stats.maxHp || 100;
    this.hp = this.maxHp;
    this.maxArmor = stats.maxArmor || 50;
    this.armor = 0;
    this.speedMul = stats.speedMul || 1;
    this.dashMax = stats.dashMax || 2;
    this.dashCooldown = stats.dashCooldown || 1.8;
    this.dashCharges = this.dashMax;
    this.dashRecharge = 0;
    this.dashTime = 0;
    this.dashCount = 0;
    this.dashDir = new THREE.Vector3();
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.stepSmooth = 0;
    this.stepDist = 0;
    this.punch = new THREE.Vector2();
    this.trauma = 0;
    this.fovKick = 0;
    this.dead = false;
    this.invuln = 0;
    this.speed2d = 0;
  }

  get eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  addTrauma(t) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  update(dt, input, colliders, settings) {
    // Look
    const sens = 0.0022 * settings.sensitivity;
    this.yaw -= input.dx * sens;
    this.pitch -= input.dy * sens * (settings.invertY ? -1 : 1);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));

    // Wish direction
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = new THREE.Vector3(-sin * f + cos * s, 0, -cos * f - sin * s);
    if (wish.lengthSq() > 0) wish.normalize();
    const maxSpeed = 8.2 * this.speedMul;

    // Dash
    if (this.dashCharges < this.dashMax) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= this.dashCooldown) {
        this.dashRecharge = 0;
        this.dashCharges++;
      }
    }
    if (input.hit('ShiftLeft') || input.hit('ShiftRight')) {
      if (this.dashCharges > 0 && this.dashTime <= 0) {
        this.dashCharges--;
        this.dashCount++;
        this.dashTime = 0.17;
        this.dashDir.copy(wish.lengthSq() > 0 ? wish : new THREE.Vector3(-sin, 0, -cos));
        this.audio.play('dash');
        this.fovKick = 1;
        this.invuln = 0.2;
      }
    }

    // Jump (buffered + coyote time)
    if (input.hit('Space')) this.jumpBuffer = 0.14;
    this.jumpBuffer -= dt;
    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = 8.4;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.audio.play('jump');
    }

    if (this.dashTime > 0) {
      this.dashTime -= dt;
      this.vel.x = this.dashDir.x * 26;
      this.vel.z = this.dashDir.z * 26;
      this.vel.y = Math.max(this.vel.y, 0);
      if (this.dashTime <= 0) {
        this.vel.x *= 0.45;
        this.vel.z *= 0.45;
      }
    } else {
      const rate = this.onGround ? 13 : wish.lengthSq() > 0 ? 3.2 : 0;
      const k = 1 - Math.exp(-rate * dt);
      // In the air, don't bleed speed the player already has (bunny-hop / rocket-jump friendly).
      let tx = wish.x * maxSpeed, tz = wish.z * maxSpeed;
      if (!this.onGround) {
        const hs = Math.hypot(this.vel.x, this.vel.z);
        if (hs > maxSpeed) {
          tx = wish.x * hs;
          tz = wish.z * hs;
        }
      }
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
      this.vel.y -= 24 * dt;
    }

    // Integrate & collide
    const prevY = this.pos.y;
    this.pos.addScaledVector(this.vel, dt);
    const stepped = resolveActor(colliders, this.pos, RADIUS, HEIGHT, 0.62, this.onGround || this.vel.y <= 0);
    if (stepped) {
      this.stepSmooth -= this.pos.y - prevY - this.vel.y * dt;
      this.vel.y = Math.max(0, this.vel.y);
    }
    const g = groundHeight(colliders, this.pos.x, this.pos.z, RADIUS, Math.max(this.pos.y, prevY));
    if (this.pos.y <= g) {
      if (!this.onGround && this.vel.y < -9) {
        this.landDip = Math.min(0.3, -this.vel.y * 0.018);
        this.audio.play('land');
      }
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > g + 0.06) {
      this.onGround = false;
    } else if (this.onGround) {
      this.pos.y = g;
    }

    // Footsteps & view bob
    this.speed2d = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && this.speed2d > 1) {
      this.bobPhase += dt * this.speed2d * 1.35;
      this.stepDist += this.speed2d * dt;
      if (this.stepDist > 2.6) {
        this.stepDist = 0;
        this.audio.play('step');
      }
    }
    const targetBob = this.onGround ? Math.min(1, this.speed2d / 8) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);

    this.landDip *= Math.exp(-dt * 9);
    this.stepSmooth *= Math.exp(-dt * 14);
    this.punch.multiplyScalar(Math.exp(-dt * 9));
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.fovKick = Math.max(0, this.fovKick - dt * 3.5);
    this.invuln = Math.max(0, this.invuln - dt);

    this.updateCamera(settings);
  }

  updateCamera(settings) {
    const cam = this.camera;
    const bob = Math.sin(this.bobPhase * 2) * 0.045 * this.bobAmount;
    const sway = Math.cos(this.bobPhase) * 0.03 * this.bobAmount;
    cam.position.set(this.pos.x, this.pos.y + EYE + bob - this.landDip + this.stepSmooth, this.pos.z);
    const sh = this.trauma * this.trauma * (settings.shake ?? 1);
    const t = performance.now() * 0.001;
    const shx = (Math.sin(t * 37.1) + Math.sin(t * 53.7)) * 0.5 * sh * 0.05;
    const shy = (Math.sin(t * 41.3) + Math.sin(t * 61.9)) * 0.5 * sh * 0.05;
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.punch.y + shy;
    cam.rotation.x = this.pitch + this.punch.x + shx;
    cam.rotation.z = sway * 0.3 + sh * Math.sin(t * 29) * 0.04;
    const fov = settings.fov + this.fovKick * 8;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  // Returns true if the hit was lethal.
  takeDamage(amount) {
    if (this.dead) return false;
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dmg * 0.6);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    this.addTrauma(Math.min(0.6, 0.15 + amount * 0.012));
    return this.hp <= 0;
  }
}

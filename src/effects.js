// Pooled visual effects: particles, tracers, beams, explosions, decals, gibs, dynamic lights.

import * as THREE from 'three';
import { glowTexture, decalTexture } from './textures.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

class ParticlePool {
  constructor(scene, max, blending, tex, pixelRatio) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.floor = new Uint8Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    const additive = blending === THREE.AdditiveBlending;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 400 * pixelRatio } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix*vec4(position,1.0);
          float dist = -mv.z;
          vColor = aColor;
          vAlpha = aAlpha * smoothstep(0.4, 2.0, dist);
          gl_PointSize = min(aSize * uScale / max(dist, 0.1), uScale * 0.35);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: additive
        ? /* glsl */ `uniform sampler2D uTex; varying vec3 vColor; varying float vAlpha;
           void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vColor*t.a*vAlpha, 1.0); }`
        : /* glsl */ `uniform sampler2D uTex; varying vec3 vColor; varying float vAlpha;
           void main(){ vec4 t = texture2D(uTex, gl_PointCoord); float a = t.a*vAlpha; if(a<0.01) discard; gl_FragColor = vec4(vColor, a); }`,
      transparent: true,
      blending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 4;
    scene.add(this.points);
  }

  spawn(px, py, pz, vx, vy, vz, r, g, b, size, life, { grav = 0, drag = 0, sizeEnd = null, alpha = 1, floor = true } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.s0[i] = size;
    this.s1[i] = sizeEnd === null ? size : sizeEnd;
    this.a0[i] = alpha;
    this.floor[i] = floor ? 1 : 0;
  }

  update(dt) {
    const { pos, vel, life, maxLife, size, alpha } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        if (alpha[i] !== 0) { alpha[i] = 0; size[i] = 0; }
        continue;
      }
      life[i] -= dt;
      const k = Math.max(0, life[i] / maxLife[i]);
      const d = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d - this.grav[i] * dt; vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (this.floor[i] && pos[i * 3 + 1] < 0.02) {
        pos[i * 3 + 1] = 0.02;
        vel[i * 3 + 1] *= -0.35;
        vel[i * 3] *= 0.6;
        vel[i * 3 + 2] *= 0.6;
      }
      size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * k;
      alpha[i] = this.a0[i] * Math.min(1, k * 1.5);
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, renderer) {
    this.scene = scene;
    const pr = renderer.getPixelRatio();
    const glow = glowTexture();
    this.glowTex = glow;
    this.add = new ParticlePool(scene, 5000, THREE.AdditiveBlending, glow, pr);
    this.smoke = new ParticlePool(scene, 1500, THREE.NormalBlending, glow, pr);

    // Tracers
    this.tracers = [];
    const tgeo = new THREE.BoxGeometry(1, 1, 1);
    tgeo.translate(0, 0, 0.5);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(
        tgeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
      );
      m.visible = false;
      m.renderOrder = 7;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0, w: 0 });
    }
    this.tracerIdx = 0;

    // Flash lights (fixed count to avoid shader recompiles)
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 18, 1.6);
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, peak: 0 });
    }
    this.lightIdx = 0;

    // Shockwave rings
    this.rings = [];
    const rgeo = new THREE.RingGeometry(0.85, 1, 64);
    rgeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(
        rgeo,
        new THREE.MeshBasicMaterial({ color: 0xff5522, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      m.visible = false;
      m.renderOrder = 6;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, r0: 0, r1: 1 });
    }
    this.ringIdx = 0;

    // Explosion fireballs
    this.balls = [];
    const bgeo = new THREE.IcosahedronGeometry(1, 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        bgeo,
        new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      m.visible = false;
      scene.add(m);
      this.balls.push({ mesh: m, life: 0, max: 1, r: 1 });
    }
    this.ballIdx = 0;

    // Decals
    const dgeo = new THREE.PlaneGeometry(1, 1);
    this.decals = new THREE.InstancedMesh(
      dgeo,
      new THREE.MeshStandardMaterial({
        map: decalTexture(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        roughness: 0.9,
      }),
      300
    );
    this.decals.count = 0;
    this.decals.renderOrder = 2;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
    this.decalIdx = 0;

    // Gibs
    this.gibs = [];
    const ggeos = [new THREE.TetrahedronGeometry(0.18, 0), new THREE.BoxGeometry(0.22, 0.12, 0.16), new THREE.OctahedronGeometry(0.14, 0)];
    this.gibMat = new THREE.MeshStandardMaterial({ color: 0x15100f, roughness: 0.5, metalness: 0.3, emissive: 0xff3010, emissiveIntensity: 0.6 });
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(ggeos[i % 3], this.gibMat);
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      this.gibs.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, scale: 1 });
    }
    this.gibIdx = 0;
  }

  flashLight(pos, color, intensity, duration, distance = 18) {
    const L = this.lights[this.lightIdx];
    this.lightIdx = (this.lightIdx + 1) % this.lights.length;
    L.light.position.copy(pos);
    L.light.color.set(color);
    L.light.distance = distance;
    L.peak = intensity;
    L.life = L.max = duration;
    L.light.intensity = intensity;
  }

  tracer(from, to, color, width = 0.03, life = 0.07) {
    const T = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.01) return;
    T.mesh.position.copy(from);
    T.mesh.lookAt(to);
    T.mesh.scale.set(width, width, len);
    T.mesh.material.color.set(color);
    T.mesh.material.opacity = 1;
    T.mesh.visible = true;
    T.life = T.max = life;
    T.w = width;
  }

  beam(from, to, color = 0xbfe6ff) {
    this.tracer(from, to, color, 0.09, 0.45);
    this.tracer(from, to, 0xffffff, 0.03, 0.25);
    const dir = _v.subVectors(to, from);
    const len = dir.length();
    dir.normalize();
    const c = new THREE.Color(color);
    const steps = Math.min(120, len * 2.5);
    for (let i = 0; i < steps; i++) {
      const t = Math.random() * len;
      const a = Math.random() * Math.PI * 2;
      this.add.spawn(
        from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t,
        Math.cos(a) * 0.6, Math.sin(a) * 0.6 + 0.3, Math.sin(a + 1) * 0.6,
        c.r * 1.5, c.g * 1.5, c.b * 1.5, 0.09, 0.4 + Math.random() * 0.5, { drag: 2, floor: false }
      );
    }
  }

  muzzle(pos, dir, color) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 8; i++) {
      const s = 2 + Math.random() * 6;
      this.add.spawn(
        pos.x, pos.y, pos.z,
        dir.x * s + (Math.random() - 0.5) * 2, dir.y * s + (Math.random() - 0.5) * 2, dir.z * s + (Math.random() - 0.5) * 2,
        c.r * 2, c.g * 1.6, c.b * 1.2, 0.05, 0.1 + Math.random() * 0.1, { drag: 8, floor: false }
      );
    }
    this.flashLight(pos, color, 25, 0.06, 12);
  }

  impact(point, normal, kind = 'spark') {
    if (kind === 'spark') {
      for (let i = 0; i < 9; i++) {
        _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4).add(normal).normalize();
        const s = 3 + Math.random() * 7;
        this.add.spawn(point.x, point.y, point.z, _v.x * s, _v.y * s, _v.z * s, 2.2, 1.3, 0.5, 0.045, 0.2 + Math.random() * 0.35, { grav: 14, drag: 1 });
      }
      for (let i = 0; i < 3; i++) {
        this.smoke.spawn(
          point.x + normal.x * 0.1, point.y + normal.y * 0.1, point.z + normal.z * 0.1,
          normal.x * 0.6 + (Math.random() - 0.5) * 0.5, normal.y * 0.6 + Math.random() * 0.6, normal.z * 0.6 + (Math.random() - 0.5) * 0.5,
          0.13, 0.13, 0.15, 0.25, 0.6 + Math.random() * 0.5, { sizeEnd: 0.9, drag: 2, alpha: 0.45, floor: false }
        );
      }
      this.decal(point, normal, 0.16 + Math.random() * 0.08);
    } else if (kind === 'flesh') {
      for (let i = 0; i < 10; i++) {
        _v.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).multiplyScalar(1.6).add(normal).normalize();
        const s = 2 + Math.random() * 5;
        this.add.spawn(point.x, point.y, point.z, _v.x * s, _v.y * s, _v.z * s, 2.4, 0.35, 0.12, 0.06, 0.3 + Math.random() * 0.4, { grav: 12, drag: 1.5 });
      }
      for (let i = 0; i < 4; i++) {
        _v.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5);
        this.smoke.spawn(point.x, point.y, point.z, _v.x * 3, _v.y * 3, _v.z * 3, 0.06, 0.01, 0.01, 0.12, 0.5 + Math.random() * 0.4, { grav: 10, drag: 1, sizeEnd: 0.05, alpha: 0.9 });
      }
    } else if (kind === 'energy') {
      for (let i = 0; i < 12; i++) {
        _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const s = 2 + Math.random() * 5;
        this.add.spawn(point.x, point.y, point.z, _v.x * s, _v.y * s, _v.z * s, 1.4, 0.5, 2.4, 0.08, 0.3 + Math.random() * 0.3, { drag: 3, floor: false });
      }
    }
  }

  decal(point, normal, size) {
    _q.setFromUnitVectors(Z, normal);
    _m.compose(_v.copy(point).addScaledVector(normal, 0.01), _q, _s.set(size, size, size));
    // random spin around the normal for variety
    _m.multiply(new THREE.Matrix4().makeRotationZ(Math.random() * Math.PI * 2));
    this.decals.setMatrixAt(this.decalIdx, _m);
    this.decalIdx = (this.decalIdx + 1) % 300;
    this.decals.count = Math.min(300, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  ring(pos, r0, r1, duration, color = 0xff5522) {
    const R = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % this.rings.length;
    R.mesh.position.set(pos.x, Math.max(0.08, pos.y + 0.08), pos.z);
    R.mesh.material.color.set(color);
    R.mesh.visible = true;
    R.r0 = r0;
    R.r1 = r1;
    R.life = R.max = duration;
    R.mesh.scale.setScalar(r0);
  }

  explosion(pos, radius, color = 0xff7a2a) {
    const B = this.balls[this.ballIdx];
    this.ballIdx = (this.ballIdx + 1) % this.balls.length;
    B.mesh.position.copy(pos);
    B.mesh.visible = true;
    B.mesh.material.color.set(color);
    B.life = B.max = 0.35;
    B.r = radius;
    this.flashLight(pos, color, 220, 0.5, radius * 6);
    this.ring(pos, 0.5, radius * 1.4, 0.45, color);
    const c = new THREE.Color(color);
    for (let i = 0; i < 70; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      const s = 4 + Math.random() * 14;
      this.add.spawn(pos.x, pos.y, pos.z, _v.x * s, _v.y * s + 3, _v.z * s, c.r * 2.5, c.g * 2, c.b * 1.5, 0.08 + Math.random() * 0.1, 0.4 + Math.random() * 0.9, { grav: 9, drag: 1.2 });
    }
    for (let i = 0; i < 18; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      const s = 1 + Math.random() * 3;
      this.smoke.spawn(pos.x, pos.y, pos.z, _v.x * s, _v.y * s, _v.z * s, 0.08, 0.075, 0.08, 0.6, 1.5 + Math.random() * 1.2, { sizeEnd: 3.2, drag: 1.4, alpha: 0.55, floor: false });
    }
    if (pos.y < 0.6) this.decal(_v.set(pos.x, 0.0, pos.z), UP, radius * 0.9);
  }

  spawnBurst(pos, color = 0xff3018) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.2;
      this.add.spawn(pos.x + Math.cos(a) * r, pos.y + Math.random() * 2.5, pos.z + Math.sin(a) * r, Math.cos(a) * 0.5, 1 + Math.random() * 3, Math.sin(a) * 0.5,
        c.r * 2, c.g * 2, c.b * 2, 0.08, 0.5 + Math.random() * 0.7, { drag: 1, floor: false });
    }
    this.ring(pos, 0.2, 2.5, 0.6, color);
    this.flashLight(_v.copy(pos).setY(pos.y + 1.5), color, 60, 0.4, 10);
  }

  gibBurst(pos, color, count = 8, scale = 1, force = 1) {
    this.gibMat.emissive.set(color);
    for (let i = 0; i < count; i++) {
      const G = this.gibs[this.gibIdx];
      this.gibIdx = (this.gibIdx + 1) % this.gibs.length;
      G.mesh.position.set(pos.x + (Math.random() - 0.5) * 0.5 * scale, pos.y + Math.random() * scale, pos.z + (Math.random() - 0.5) * 0.5 * scale);
      G.vel.set((Math.random() - 0.5) * 8, 3 + Math.random() * 6, (Math.random() - 0.5) * 8).multiplyScalar(force);
      G.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      G.life = 2.5 + Math.random() * 1.5;
      G.scale = scale * (0.7 + Math.random() * 0.8);
      G.mesh.scale.setScalar(G.scale);
      G.mesh.visible = true;
    }
  }

  deathBurst(pos, color, scale = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 40 * scale; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      const s = 2 + Math.random() * 6 * scale;
      this.add.spawn(pos.x, pos.y, pos.z, _v.x * s, _v.y * s, _v.z * s, c.r * 2.4, c.g * 2.4, c.b * 2.4, 0.07 * Math.sqrt(scale), 0.4 + Math.random() * 0.8, { grav: 6, drag: 1.5 });
    }
    // rising embers
    for (let i = 0; i < 16 * scale; i++) {
      this.add.spawn(pos.x + (Math.random() - 0.5) * scale, pos.y + Math.random() * scale, pos.z + (Math.random() - 0.5) * scale,
        (Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6,
        c.r * 1.6, c.g * 1.6, c.b * 1.6, 0.05, 1.2 + Math.random() * 1.2, { drag: 0.5, floor: false });
    }
    for (let i = 0; i < 8 * scale; i++) {
      this.smoke.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.05, 0.04, 0.05, 0.5 * scale, 1.2, { sizeEnd: 1.8 * scale, drag: 1.5, alpha: 0.6, floor: false });
    }
    this.flashLight(pos, color, 40 * scale, 0.3, 10);
  }

  trail(pos, color, size = 0.12, life = 0.35) {
    const c = color;
    this.add.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, c.r, c.g, c.b, size, life, { sizeEnd: 0, floor: false });
  }

  update(dt, groundAt, camPos) {
    this.add.update(dt);
    this.smoke.update(dt);
    for (const T of this.tracers) {
      if (T.life <= 0) continue;
      T.life -= dt;
      const k = Math.max(0, T.life / T.max);
      T.mesh.material.opacity = k;
      T.mesh.scale.x = T.mesh.scale.y = T.w * (0.4 + 0.6 * k);
      if (T.life <= 0) T.mesh.visible = false;
    }
    for (const L of this.lights) {
      if (L.life <= 0) continue;
      L.life -= dt;
      const k = Math.max(0, L.life / L.max);
      L.light.intensity = L.peak * k * k;
    }
    for (const R of this.rings) {
      if (R.life <= 0) continue;
      R.life -= dt;
      const k = 1 - Math.max(0, R.life / R.max);
      R.mesh.scale.setScalar(R.r0 + (R.r1 - R.r0) * (1 - (1 - k) * (1 - k)));
      R.mesh.material.opacity = (1 - k) * 1.2;
      if (R.life <= 0) R.mesh.visible = false;
    }
    for (const B of this.balls) {
      if (B.life <= 0) continue;
      B.life -= dt;
      const k = 1 - Math.max(0, B.life / B.max);
      B.mesh.scale.setScalar(B.r * (0.3 + 0.9 * Math.sqrt(k)));
      B.mesh.material.opacity = (1 - k) * 1.5;
      if (B.life <= 0) B.mesh.visible = false;
    }
    for (const G of this.gibs) {
      if (G.life <= 0) continue;
      G.life -= dt;
      G.vel.y -= 20 * dt;
      const m = G.mesh;
      m.position.addScaledVector(G.vel, dt);
      const gy = groundAt ? groundAt(m.position.x, m.position.z, m.position.y) : 0;
      if (m.position.y < gy + 0.05) {
        m.position.y = gy + 0.05;
        G.vel.y *= -0.3;
        G.vel.x *= 0.6;
        G.vel.z *= 0.6;
        G.spin.multiplyScalar(0.6);
      }
      m.rotation.x += G.spin.x * dt;
      m.rotation.y += G.spin.y * dt;
      m.rotation.z += G.spin.z * dt;
      if (G.life < 0.6) m.scale.setScalar(G.scale * (G.life / 0.6));
      m.visible = G.life > 0 && !(camPos && m.position.distanceToSquared(camPos) < 0.8 * 0.8);
    }
  }
}

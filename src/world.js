// The Crucible: a ruined, rain-soaked arena under a broken dome.

import * as THREE from 'three';
import { boxCollider, cylCollider, WALL_RADIUS } from './physics.js';
import { puddleMap, runeTexture } from './textures.js';
import { materials as pbr } from './pbr.js';
import { triplanar } from './triplanar.js';
import { rbox, taper, merged, pebble, flutedShaft, lathe, iBeam, jerseyBarrier, sandbag, oilDrum } from './shapes.js';

const MOON_DIR = new THREE.Vector3(-0.35, 0.62, -0.7).normalize();

class PartialCurve extends THREE.Curve {
  constructor(curve, end) {
    super();
    this.curve = curve;
    this.end = end;
  }
  getPoint(t, target = new THREE.Vector3()) {
    return this.curve.getPoint(t * this.end, target);
  }
}

const NOISE_GLSL = /* glsl */ `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.-2.*f);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=.5;} return v; }
`;

export class World {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.colliders = [];
    this.gates = [];
    this.flickerLights = [];
    this.shafts = [];
    this.banners = [];
    this.pickupSpots = [];
    this.time = 0;
    this.flash = 0;
    this.nextLightning = 8 + Math.random() * 10;
    this.onThunder = null;
    this.monolithLife = 1;
  }

  build() {
    const scene = this.scene;
    scene.background = new THREE.Color(0x020306);
    scene.fog = new THREE.FogExp2(0x070a10, 0.021);

    this._buildEnvironment();
    this._buildSky();
    this._buildLights();
    this._buildFloor();
    this._buildWall();
    this._buildRoof();
    this._buildCenter();
    this._buildPillars();
    this._buildCover();
    this._buildPlatforms();
    this._buildGates();
    this._buildLamps();
    this._buildBanners();
    this._buildRubble();
    this._buildWallDetail();
    this._buildFloorDetail();
    this._flushBatches();
    this._buildRain();
    this._buildDust();
  }

  // --- static detail batching: many small parts merged into one mesh per material ----------
  _batch(mat, geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, cast = true) {
    if (!this.batches) this.batches = new Map();
    const key = mat.uuid + (cast ? 'c' : 'n');
    if (!this.batches.has(key)) this.batches.set(key, { mat, cast, parts: [] });
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(sx, sy, sz)
    );
    this.batches.get(key).parts.push({ geo, matrix: m });
    return m;
  }

  // Adds parts in a local frame (origin + yaw) — handy for objects placed around the ring.
  _batchLocal(mat, geo, frame, lx, ly, lz, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, cast = true) {
    const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
    const x = frame.x + lx * c + lz * s, z = frame.z - lx * s + lz * c;
    return this._batch(mat, geo, x, frame.y + ly, z, rx, ry + frame.yaw, rz, sx, sy, sz, cast);
  }

  _flushBatches() {
    for (const { mat, cast, parts } of this.batches.values()) {
      const mesh = new THREE.Mesh(merged(parts), mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    this.batches.clear();
  }

  // --- materials -------------------------------------------------------------------
  _materials() {
    if (this.mats) return this.mats;
    const P = pbr();
    const std = (color, roughness = 1, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    // Ashlar masonry for the architecture (4 m tile), darker variant for trims and arches.
    const concrete = triplanar(std(0xffffff), P.ashlar, { scale: 0.16, normalScale: 1.2, grime: true });
    const darkStone = triplanar(std(0xd6d0c6), P.ashlar, { scale: 0.22, normalScale: 1.2, grime: true });
    // Board-formed cast concrete for barriers, stairs and slabs (3 m tile).
    const cast = triplanar(std(0xf0f0ea), P.concrete, { scale: 0.33, normalScale: 1.0, grime: true });
    const metal = triplanar(std(0xffffff, 1, 1), P.metal, { scale: 0.5, normalScale: 1.0 });
    const rust = triplanar(std(0xffffff, 1, 1), P.rustRed, { scale: 0.6, normalScale: 1.0 });
    const crate = triplanar(std(0xc8d8b0, 1, 1), P.metal, { scale: 0.7, normalScale: 1.2 });
    const plate = triplanar(std(0xffffff, 1, 1), P.plate, { scale: 0.85, normalScale: 1.0 });
    const redGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2414, emissiveIntensity: 4 });
    const amberGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a2a, emissiveIntensity: 5 });
    const cyanGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x4fe0ff, emissiveIntensity: 4 });
    this.mats = { concrete, darkStone, cast, metal, rust, crate, plate, redGlow, amberGlow, cyanGlow };
    return this.mats;
  }

  _mesh(geo, mat, x, y, z, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    this.scene.add(m);
    return m;
  }

  // Dim, moody environment map so metals and puddles have something to reflect.
  _buildEnvironment() {
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x020306);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(100, 100, 100),
      new THREE.MeshBasicMaterial({ color: 0x030408, side: THREE.BackSide })
    );
    envScene.add(box);
    const panel = (color, scale, pos, size) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(scale), side: THREE.DoubleSide })
      );
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    panel(0x6f86c0, 1.2, MOON_DIR.clone().multiplyScalar(45), [40, 40]);
    panel(0xff3018, 1.5, new THREE.Vector3(45, -5, 0), [60, 5]);
    panel(0xff3018, 1.5, new THREE.Vector3(-45, -5, 0), [60, 5]);
    panel(0xff9a40, 2.5, new THREE.Vector3(15, 30, 15), [6, 6]);
    panel(0xff9a40, 2.5, new THREE.Vector3(-15, 30, -15), [6, 6]);
    panel(0x4fd8ff, 1.5, new THREE.Vector3(0, -10, 45), [10, 40]);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(envScene, 0.03).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.8;
    pmrem.dispose();
  }

  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uMoon: { value: MOON_DIR } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uFlash; uniform vec3 uMoon;
        varying vec3 vDir;
        ${NOISE_GLSL}
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(vec3(0.004,0.005,0.009), vec3(0.018,0.024,0.045), smoothstep(-0.05,0.7,h));
          vec2 uv = d.xz/(max(d.y,0.02)+0.3)*1.2 + vec2(uTime*0.012, uTime*0.004);
          float c = fbm(uv*1.4);
          float c2 = fbm(uv*3.1 + 7.0);
          float clouds = smoothstep(0.38, 0.8, c*0.7 + c2*0.35);
          float m = max(dot(d, uMoon), 0.0);
          vec3 moonCol = vec3(0.65,0.75,1.0);
          float disk = smoothstep(0.9993, 0.9996, m);
          vec3 moon = moonCol * (disk*6.0 + pow(m, 80.0)*0.5 + pow(m, 8.0)*0.06);
          col += moon * (1.0 - clouds*0.85);
          vec3 cloudCol = vec3(0.025,0.03,0.045) + moonCol*pow(m,10.0)*0.25;
          col = mix(col, cloudCol, clouds*smoothstep(-0.05,0.25,h));
          col += uFlash * vec3(0.55,0.6,0.8) * (0.15 + clouds*1.2) * smoothstep(-0.1,0.4,h);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.scene.add(sky);
  }

  _buildLights() {
    const scene = this.scene;
    this.hemi = new THREE.HemisphereLight(0x3a4c70, 0x16110c, 0.9);
    scene.add(this.hemi);

    const moon = (this.moon = new THREE.DirectionalLight(0x9db2e6, 1.5));
    moon.position.copy(MOON_DIR).multiplyScalar(60);
    moon.target.position.set(0, 0, 0);
    moon.castShadow = this.quality !== 'low';
    const ss = this.quality === 'high' ? 4096 : 2048;
    moon.shadow.mapSize.set(ss, ss);
    const sc = moon.shadow.camera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 1; sc.far = 140;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.04;
    scene.add(moon, moon.target);
    this.moonBase = 1.5;
  }

  _buildFloor() {
    // Flagstones (8.2 m tile) with a non-tiling puddle roughness map across the arena.
    const flag = pbr().flag;
    const map = flag.albedo.clone();
    const normalMap = flag.normal.clone();
    map.repeat.set(9.5, 9.5);
    normalMap.repeat.set(9.5, 9.5);
    const mat = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(1.3, 1.3),
      roughnessMap: puddleMap(),
      roughness: 1,
      metalness: 0.05,
      color: 0xd8d8d8,
      envMapIntensity: 1.6,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(39, 96), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;
  }

  _buildWall() {
    const { concrete, redGlow } = this._materials();
    const segs = 64;
    const R = WALL_RADIUS + 0.75;
    const w = ((Math.PI * 2 * R) / segs) * 1.04;
    const wallMat = concrete;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const blocks = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const h = 13 + Math.abs(Math.sin(i * 1.7) * 5) + (i % 7 === 0 ? -4 : 0);
      p.set(Math.cos(a) * R, h / 2, Math.sin(a) * R);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      blocks.push({ geo: rbox(w, h, 1.5, 0.5, 3), matrix: new THREE.Matrix4().compose(p, q, s) });
    }
    const wall = new THREE.Mesh(merged(blocks), wallMat);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.scene.add(wall);

    // Buttresses
    const bcount = 16;
    const bparts = [];
    for (let i = 0; i < bcount; i++) {
      const a = ((i + 0.5) / bcount) * Math.PI * 2;
      const rr = R - 1.4;
      const bh = 15 + (i % 3) * 1.5;
      p.set(Math.cos(a) * rr, bh / 2, Math.sin(a) * rr);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      bparts.push({ geo: taper(rbox(2.2, bh, 3.2, 0.7, 4), 0.75), matrix: new THREE.Matrix4().compose(p, q, s) });
      // Two cylinders approximate the buttress footprint so the player can't walk into it.
      const tx = -Math.sin(a), tz = Math.cos(a);
      const cr = rr - 0.75;
      for (const off of [-0.55, 0.55]) {
        this.colliders.push(cylCollider(Math.cos(a) * cr + tx * off, Math.sin(a) * cr + tz * off, 0.85, 0, 15));
      }
    }
    const binst = new THREE.Mesh(merged(bparts), concrete);
    binst.castShadow = binst.receiveShadow = true;
    this.scene.add(binst);

    // Emissive strips running around the base of the wall.
    const ring = (y, h, rr, intensity) => {
      const mat = redGlow.clone();
      mat.emissiveIntensity = intensity;
      mat.side = THREE.BackSide;
      const g = new THREE.CylinderGeometry(rr, rr, h, 160, 1, true);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.y = y;
      this.scene.add(mesh);
      return mesh;
    };
    ring(1.2, 0.03, WALL_RADIUS - 0.04, 1.4);
  }

  _buildRoof() {
    const { darkStone, metal } = this._materials();
    const ribs = 12;
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2 + 0.13;
      const R = WALL_RADIUS;
      const start = new THREE.Vector3(Math.cos(a) * R, 15, Math.sin(a) * R);
      const ctrl = new THREE.Vector3(Math.cos(a) * R * 0.55, 30, Math.sin(a) * R * 0.55);
      const end = new THREE.Vector3(Math.cos(a) * 8, 27, Math.sin(a) * 8);
      const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);
      const broken = [2, 5, 9].includes(i) ? 0.45 + (i % 3) * 0.08 : 1;
      const tube = new THREE.TubeGeometry(new PartialCurve(curve, broken), 48, 0.7, 14, false);
      const mesh = new THREE.Mesh(tube, darkStone);
      mesh.castShadow = true;
      this.scene.add(mesh);
    }
    const crown = new THREE.Mesh(new THREE.TorusGeometry(8, 0.8, 16, 96, Math.PI * 1.45), darkStone);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 27;
    crown.castShadow = true;
    this.scene.add(crown);
    // Hanging chains from the crown
    for (let i = 0; i < 5; i++) {
      const a = i * 1.1;
      const len = 4 + (i % 3) * 3;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 8), metal);
      c.position.set(Math.cos(a) * 8, 27 - len / 2, Math.sin(a) * 8);
      this.scene.add(c);
    }
  }

  _buildCenter() {
    const { darkStone, metal, cyanGlow } = this._materials();
    // Dais
    const daisProfile = [
      new THREE.Vector2(0, 0.5), new THREE.Vector2(5.75, 0.5), new THREE.Vector2(5.98, 0.46), new THREE.Vector2(6.12, 0.36),
      new THREE.Vector2(6.22, 0.2), new THREE.Vector2(6.28, 0.06), new THREE.Vector2(6.3, 0),
    ];
    const dais = this._mesh(new THREE.LatheGeometry(daisProfile, 96), darkStone, 0, 0, 0);
    dais.castShadow = false;
    this.colliders.push(cylCollider(0, 0, 6.15, 0, 0.5));
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.04, 8, 128), cyanGlow);
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = 0.52;
    this.scene.add(inlay);
    this.inlay = inlay;

    // Monolith — the Last Light.
    const runes = runeTexture();
    const monoMat = new THREE.MeshStandardMaterial({
      color: 0x0a0b0e,
      roughness: 0.25,
      metalness: 0.6,
      emissive: 0x58e6ff,
      emissiveMap: runes,
      emissiveIntensity: 3,
    });
    const mono = new THREE.Mesh(taper(rbox(2.2, 9, 2.2, 0.45, 5), 0.58), monoMat);
    mono.position.y = 5;
    mono.castShadow = true;
    mono.receiveShadow = true;
    this.scene.add(mono);
    this.monoMat = monoMat;
    this.colliders.push(boxCollider(-1.05, 0, -1.05, 1.05, 9.5, 1.05));

    // Floating capstone and orbiting rings
    const cap = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.75, 3),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9ff0ff, emissiveIntensity: 6 })
    );
    cap.position.y = 11;
    this.scene.add(cap);
    this.capstone = cap;
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.2 + i * 0.7, 0.03, 8, 128), cyanGlow);
      r.position.y = 6 + i * 1.6;
      this.scene.add(r);
      this.rings.push(r);
    }
    // Fragments orbiting
    this.fragments = [];
    const fragGeo = new THREE.IcosahedronGeometry(0.2, 1);
    for (let i = 0; i < 14; i++) {
      const f = new THREE.Mesh(fragGeo, metal);
      f.userData = { a: Math.random() * Math.PI * 2, r: 2.4 + Math.random() * 2, y: 3 + Math.random() * 7, s: 0.2 + Math.random() * 0.4 };
      f.castShadow = true;
      this.scene.add(f);
      this.fragments.push(f);
    }

    this.monoLight = new THREE.PointLight(0x4fd8ff, 70, 30, 1.6);
    this.monoLight.position.set(0, 7, 0);
    this.scene.add(this.monoLight);

    // A pale column of moonlight falling through the broken crown.
    const shaft = this._shaft(7, 26, 0x8fb4ff, 0.06);
    shaft.position.set(0, 13, 0);
  }

  _buildPillars() {
    const { concrete, darkStone, cast, metal } = this._materials();
    const baseProfile = lathe([[0, 0], [1.62, 0], [1.62, 0.1], [1.55, 0.14], [1.55, 0.22], [1.6, 0.3], [1.58, 0.42], [1.45, 0.5], [1.38, 0.52],
      [1.34, 0.6], [1.4, 0.68], [1.38, 0.76], [1.3, 0.8], [1.27, 0.86], [0, 0.86]], 64);
    const capProfile = lathe([[0, 0], [1.16, 0], [1.2, 0.05], [1.18, 0.12], [1.22, 0.18], [1.45, 0.42], [1.6, 0.55], [1.62, 0.62], [0, 0.62]], 64);
    const plinth = rbox(3.2, 0.7, 3.2, 0.12);
    const abacus = rbox(3.3, 0.38, 3.3, 0.1);
    const band = new THREE.TorusGeometry(1.2, 0.035, 8, 64);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 21, z = Math.sin(a) * 21;
      const broken = i === 3 || i === 6;
      const shaftH = broken ? 5 + i * 0.3 : 14.6;
      this._batch(darkStone, plinth, x, 0.35, z, 0, a);
      this._batch(darkStone, baseProfile, x, 0.7, z, 0, a);
      const shaft = flutedShaft(1.22, broken ? 1.12 : 1.02, shaftH, { flutes: 20, depth: 0.045, jagged: broken ? 1.2 : 0, seed: i });
      this._batch(cast, shaft, x, 1.56 + shaftH / 2, z, 0, a);
      // drum joints: thin recessed bands where the stone drums meet
      for (let y = 3.2; y < 1.56 + shaftH - 0.6; y += 2.4) {
        const t = (y - 1.56) / shaftH;
        const r = 1.22 + (1.0 - 1.22) * t;
        this._batch(darkStone, band, x, y, z, Math.PI / 2, 0, 0, r / 1.2, r / 1.2, 1);
      }
      if (!broken) {
        this._batch(darkStone, capProfile, x, 1.56 + shaftH, z, 0, a);
        this._batch(darkStone, abacus, x, 1.56 + shaftH + 0.8, z, 0, a);
        // iron tie-band
        this._batch(metal, new THREE.TorusGeometry(1.13, 0.06, 8, 48), x, 11, z, Math.PI / 2);
      } else {
        // fallen drums of the broken column, plus loose fragments
        const fx = x + Math.cos(a + 1.4) * 2.6, fz = z + Math.sin(a + 1.4) * 2.6;
        const drum = flutedShaft(1.08, 1.05, 3.4, { flutes: 20, depth: 0.045, jagged: 0.5, seed: i + 4 });
        this._batch(cast, drum, fx, 1.05, fz, 0, a + 0.4, Math.PI / 2);
        const ax = -Math.sin(a + 0.4), az = Math.cos(a + 0.4);
        for (const off of [-1.15, 0, 1.15]) {
          this.colliders.push(cylCollider(fx + ax * off, fz + az * off, 1.1, 0, 2.15));
        }
        for (let k = 0; k < 7; k++) {
          const ang = a + k * 0.9, rr = 1.8 + (k % 3) * 0.5;
          this._batch(concrete, pebble(0.25 + (k % 3) * 0.12, k + i), x + Math.cos(ang) * rr, 0.12, z + Math.sin(ang) * rr, k, k * 2, 0);
        }
      }
      this.colliders.push(cylCollider(x, z, 1.5, 0, 1.56 + shaftH));
    }
  }

  _buildCover() {
    const { cast, metal, rust, crate, amberGlow } = this._materials();
    const canvas = triplanar(new THREE.MeshStandardMaterial({ color: 0x8a7a5c, roughness: 1 }), pbr().cloth, { scale: 1.6, normalScale: 1.5 });
    const jersey = jerseyBarrier(1.95);
    const bags = [sandbag(1), sandbag(2), sandbag(3)];
    // Barricades on the cardinal axes: three jersey barriers topped with sandbags.
    const addBarricade = (cx, cz, alongZ) => {
      const w = alongZ ? 1 : 6, d = alongZ ? 6 : 1;
      const yaw = alongZ ? Math.PI / 2 : 0;
      const f = { x: cx, y: 0, z: cz, yaw };
      for (let k = -1; k <= 1; k++) {
        this._batchLocal(cast, jersey, f, k * 2.0, 0, 0, 0, (k * 0.03), 0);
        // lifting loops
        this._batchLocal(metal, new THREE.TorusGeometry(0.06, 0.012, 6, 12), f, k * 2.0 + 0.6, 0.84, 0);
        this._batchLocal(metal, new THREE.TorusGeometry(0.06, 0.012, 6, 12), f, k * 2.0 - 0.6, 0.84, 0);
      }
      // two staggered courses of sandbags on top
      for (let row = 0; row < 2; row++) {
        const n = row === 0 ? 9 : 8;
        for (let j = 0; j < n; j++) {
          const lx = -2.65 + j * 0.64 + row * 0.32 + Math.sin(j * 3.1 + cx) * 0.04;
          this._batchLocal(canvas, bags[(j + row) % 3], f, lx, 0.92 + row * 0.18, Math.sin(j * 1.7 + cz) * 0.03, 0, Math.sin(j * 2.3) * 0.12, Math.sin(j * 5.1) * 0.05);
        }
      }
      // a small warning lamp on one end
      this._batchLocal(metal, rbox(0.14, 0.16, 0.14, 0.03), f, 2.7, 0.9, 0);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 10), amberGlow);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      lamp.position.set(cx + 2.7 * c, 1.02, cz - 2.7 * s);
      this.scene.add(lamp);
      this.colliders.push(boxCollider(cx - w / 2, 0, cz - d / 2, cx + w / 2, 1.4, cz + d / 2));
    };
    addBarricade(12, 0, true);
    addBarricade(-12, 0, true);
    addBarricade(0, 12, false);
    addBarricade(0, -12, false);

    // Industrial crates: panelled steel boxes with edge frames and corner castings.
    const body = rbox(1.5, 1.5, 1.5, 0.04);
    const railH = rbox(1.62, 0.09, 0.09, 0.02);
    const corner = rbox(0.16, 0.16, 0.16, 0.03);
    const rib = rbox(0.06, 1.42, 0.05, 0.015);
    const addCrate = (x, z, y = 0, rot = 0) => {
      const f = { x, y, z, yaw: rot };
      this._batchLocal(crate, body, f, 0, 0.8, 0);
      for (const sy of [0.06, 1.54]) {
        for (const [lx, lz, ry] of [[0, 0.77, 0], [0, -0.77, 0], [0.77, 0, Math.PI / 2], [-0.77, 0, Math.PI / 2]]) {
          this._batchLocal(metal, railH, f, lx, sy, lz, 0, ry, 0);
        }
      }
      for (const lx of [-0.77, 0.77]) for (const lz of [-0.77, 0.77]) {
        this._batchLocal(metal, rbox(0.09, 1.5, 0.09, 0.02), f, lx, 0.8, lz);
        this._batchLocal(metal, corner, f, lx, 0.1, lz);
        this._batchLocal(metal, corner, f, lx, 1.5, lz);
      }
      // corrugation ribs on two faces
      for (let k = -2; k <= 2; k++) {
        this._batchLocal(metal, rib, f, k * 0.25, 0.8, 0.765);
        this._batchLocal(metal, rib, f, k * 0.25, 0.8, -0.765);
      }
      this.colliders.push(boxCollider(x - 0.85, y, z - 0.85, x + 0.85, y + 1.6, z + 0.85));
    };
    addCrate(-13, 26, 0, 0.1);
    addCrate(-11.3, 26.3, 0, -0.05);
    addCrate(-12.2, 26.1, 1.6, 0.3);
    addCrate(27, -11, 0, 0.2);
    addCrate(-27, 11, 0, -0.15);
    addCrate(12, -27, 0, 0.05);
    addCrate(13.7, -27.2, 0, 0.1);
    addCrate(4, 30, 0, 0.3);
    addCrate(-30, -4, 0, 0.12);
    addCrate(-29.6, -2.3, 0, -0.1);

    // Rusted oil drums, one knocked over.
    const drum = oilDrum();
    const drums = [[28.2, -8.9], [28.6, -8.2], [-25.4, 12.7], [6.0, 30.4], [-31.2, -5.6], [14.4, -25.6]];
    drums.forEach(([x, z], i) => {
      if (i === 2) {
        this._batch(rust, drum, x, 0.29, z, 0, 0.6, Math.PI / 2, 1, 1, 1);
        this.colliders.push(cylCollider(x, z, 0.5, 0, 0.6));
      } else {
        this._batch(i % 2 ? rust : metal, drum, x, 0, z, 0, i);
        this.colliders.push(cylCollider(x, z, 0.32, 0, 0.88));
      }
    });
  }

  _buildPlatforms() {
    const { cast, darkStone, metal, plate, amberGlow } = this._materials();
    const post = iBeam(0.22, 0.16, 3.0);
    const beam = iBeam(0.28, 0.16, 8.0);
    const railPost = new THREE.CylinderGeometry(0.035, 0.035, 1.05, 12);
    const rail = new THREE.CylinderGeometry(0.03, 0.03, 8.0, 12);
    const toe = rbox(8.0, 0.12, 0.02, 0.008);
    const build = (cx, cz, dir) => {
      const s = 8, h = 3;
      // Cast-concrete core inset under a steel frame and tread-plate deck.
      this._batch(cast, rbox(s - 0.6, h - 0.25, s - 0.6, 0.2), cx, (h - 0.25) / 2, cz);
      this._batch(plate, rbox(s + 0.1, 0.08, s + 0.1, 0.03), cx, h + 0.16, cz);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        this._batch(metal, post, cx + ox * 3.88, h / 2, cz + oz * 3.88);
        this._batch(metal, rbox(0.36, 0.06, 0.36, 0.015), cx + ox * 3.88, 0.03, cz + oz * 3.88);
      }
      for (const o of [-1, 1]) {
        this._batch(metal, beam, cx, h - 0.02, cz + o * 3.94, Math.PI / 2, Math.PI / 2, 0);
        this._batch(metal, beam, cx + o * 3.94, h - 0.02, cz, Math.PI / 2, 0, 0);
        // cross bracing
        this._batch(metal, new THREE.CylinderGeometry(0.03, 0.03, 4.6, 8), cx + o * 3.98, h / 2, cz, 0.62 * o, 0, 0);
      }
      // Guard rails on the three sides away from the stairs.
      const sides = [[0, 1], [0, -1], [dir, 0]];
      for (const [sx, sz] of sides) {
        const along = sx === 0; // rail runs along X
        const ex = cx + sx * 3.95, ez = cz + sz * 3.95;
        for (let k = -4; k <= 4; k += 2) {
          const px = along ? cx + k * 0.97 : ex, pz = along ? ez : cz + k * 0.97;
          this._batch(metal, railPost, px, h + 0.72, pz);
        }
        for (const ry of [h + 1.22, h + 0.72]) {
          this._batch(metal, rail, ex, ry, ez, along ? 0 : Math.PI / 2, 0, along ? Math.PI / 2 : 0);
        }
        this._batch(metal, toe, ex, h + 0.26, ez, 0, along ? 0 : Math.PI / 2, 0);
      }
      this.colliders.push(boxCollider(cx - s / 2, 0, cz - s / 2, cx + s / 2, h + 0.2, cz + s / 2));
      // corner beacons
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), amberGlow);
        b.position.set(cx + ox * 3.88, h + 0.3, cz + oz * 3.88);
        this.scene.add(b);
      }
      // Stairs: cast steps with steel nosing, descending toward the centre along X.
      const edge = cx - dir * (s / 2);
      const steps = 5, rise = 0.5, run = 0.85;
      for (let k = 1; k <= steps; k++) {
        const len = run * (steps + 1 - k);
        const x0 = dir > 0 ? edge - len : edge;
        const x1 = dir > 0 ? edge : edge + len;
        const y = k * rise + 0.2;
        const zc = cz - dir * 1.2;
        this._batch(darkStone, rbox(x1 - x0, y, 4, 0.06), (x0 + x1) / 2, y / 2, zc, 0, 0, 0, 1, 1, 1, k === 1);
        const noseX = dir > 0 ? x0 : x1;
        this._batch(metal, rbox(0.08, 0.05, 3.9, 0.015), noseX + dir * 0.04, y + 0.02, zc);
        this.colliders.push(boxCollider(x0, 0, zc - 2, x1, y, zc + 2));
      }
      this.pickupSpots.push(new THREE.Vector3(cx, h + 0.2, cz));
    };
    build(20.5, 20.5, 1);
    build(-20.5, -20.5, -1);
  }

  _buildGates() {
    const { cast: darkStone, metal } = this._materials();
    const portalMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uPulse; varying vec2 vUv;
        ${NOISE_GLSL}
        void main(){
          vec2 p = vUv*2.-1.; p.y = p.y*1.0;
          float r = length(p*vec2(1.0,0.75));
          float a = atan(p.y,p.x);
          float sw = fbm(vec2(a*2.0 + uTime*0.6 + r*3.0, r*4.0 - uTime*1.5));
          float edge = smoothstep(1.0, 0.75, r);
          float rim = smoothstep(0.75, 0.95, r) * edge;
          vec3 col = vec3(1.0,0.10,0.04) * (sw*1.4) * edge + vec3(1.0,0.35,0.15) * rim * 2.0;
          col *= 0.5 + uPulse*2.5;
          gl_FragColor = vec4(col, edge);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.portalMat = portalMat;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const dirIn = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
      const R = WALL_RADIUS - 0.5;
      const base = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
      const group = new THREE.Group();
      group.position.copy(base);
      group.lookAt(0, 0, 0);
      this.scene.add(group);
      // Arch: jamb stones in courses, a semicircular ring of wedge voussoirs and a keystone.
      const f = { x: base.x, y: 0, z: base.z, yaw: Math.atan2(-base.x, -base.z) };
      for (const sx of [-2.15, 2.15]) {
        for (let k = 0; k < 6; k++) {
          const wide = k % 2 === 0;
          this._batchLocal(darkStone, rbox(wide ? 0.95 : 0.8, 0.66, 1.0, 0.06), f, sx + (wide ? Math.sign(sx) * 0.07 : 0), 0.34 + k * 0.68, 0.2);
        }
        this._batchLocal(darkStone, rbox(1.1, 0.3, 1.15, 0.05), f, sx, 4.22, 0.2); // impost
      }
      const voussoir = rbox(0.62, 0.9, 1.0, 0.06);
      const n = 11;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const ang = Math.PI * (1 - t);
        const key = k === (n - 1) / 2;
        const rr = 2.15 + (key ? 0.06 : 0);
        this._batchLocal(darkStone, key ? rbox(0.72, 1.15, 1.12, 0.06) : voussoir, f, Math.cos(ang) * rr, 4.37 + Math.sin(ang) * rr, 0.2, 0, 0, ang - Math.PI / 2);
      }
      // Raised portcullis: iron bars and cross straps under the arch.
      for (let k = -4; k <= 4; k++) {
        this._batchLocal(metal, new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8), f, k * 0.42, 5.3, 0.65);
        this._batchLocal(metal, new THREE.ConeGeometry(0.05, 0.22, 8), f, k * 0.42, 4.1, 0.65, Math.PI);
      }
      for (const yy of [4.5, 5.4, 6.2]) this._batchLocal(metal, rbox(3.6, 0.08, 0.05, 0.015), f, 0, yy, 0.65);
      // Threshold grate
      this._batchLocal(metal, rbox(4.2, 0.08, 1.4, 0.03), f, 0, 0.04, 0.6);
      for (let k = -6; k <= 6; k++) this._batchLocal(metal, rbox(0.04, 0.03, 1.36, 0.01), f, k * 0.3, 0.09, 0.6);
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.4), portalMat.clone());
      portal.position.set(0, 3.2, 0.05);
      group.add(portal);
      const light = new THREE.PointLight(0xff2a14, 18, 18, 1.5);
      light.position.copy(base).addScaledVector(dirIn, 2.6).setY(3.6);
      this.scene.add(light);
      this.gates.push({ pos: base.clone().addScaledVector(dirIn, 2.2), dirIn, portal, light, pulse: 0 });
    }
  }

  _shaft(radius, height, color, strength) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main(){
          vH = uv.y;
          vec4 wp = modelMatrix*vec4(position,1.); vW = wp.xyz;
          vN = normalize(mat3(modelMatrix)*normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uStrength; uniform float uTime;
        varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vW;
        ${NOISE_GLSL}
        void main(){
          float f = abs(dot(normalize(vN), normalize(vV)));
          float n = 0.6 + 0.4*fbm(vec2(vW.x*0.4+vW.z*0.4, vW.y*0.3 - uTime*0.2));
          float a = pow(f, 2.0) * smoothstep(0.0, 0.5, vH) * pow(vH, 0.6) * uStrength * n;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.25, radius, height, 32, 1, true), mat);
    m.renderOrder = 5;
    this.scene.add(m);
    this.shafts.push(m);
    return m;
  }

  _buildLamps() {
    const { metal, amberGlow } = this._materials();
    const spots = [
      [12, 4], [-12, -4], [4, -14], [-4, 14],
    ];
    spots.forEach(([x, z], i) => {
      const y = 9.5;
      const chainLen = 26 - y;
      // Forged chain: alternating links all the way up to the crown.
      const link = new THREE.TorusGeometry(0.06, 0.016, 6, 12);
      link.scale(1, 1.6, 1);
      for (let k = 0; k < chainLen / 0.15; k++) {
        this._batch(metal, link, x, y + 0.75 + k * 0.15, z, 0, (k % 2) * Math.PI / 2, 0, 1, 1, 1, false);
      }
      // Industrial shade with a rolled rim, a socket, and a wire guard around the bulb.
      const shade = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), metal.clone());
      shade.material.side = THREE.DoubleSide;
      shade.position.set(x, y - 0.12, z);
      shade.scale.set(1, 0.75, 1);
      this.scene.add(shade);
      this._batch(metal, new THREE.TorusGeometry(0.62, 0.025, 8, 48), x, y + 0.12, z, Math.PI / 2);
      this._batch(metal, new THREE.CylinderGeometry(0.1, 0.12, 0.25, 16), x, y + 0.55, z);
      this._batch(metal, new THREE.TorusGeometry(0.28, 0.008, 6, 32), x, y - 0.1, z, Math.PI / 2, 0, 0, 1, 1, 1, false);
      for (let k = 0; k < 6; k++) {
        const g = new THREE.TorusGeometry(0.28, 0.008, 6, 24, Math.PI);
        this._batch(metal, g, x, y + 0.12, z, Math.PI, (k / 6) * Math.PI, 0, 1, 1, 1, false);
      }
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), amberGlow.clone());
      bulb.position.set(x, y - 0.05, z);
      this.scene.add(bulb);
      const light = new THREE.PointLight(0xff9a48, 90, 26, 1.5);
      light.position.set(x, y - 0.4, z);
      this.scene.add(light);
      const shaft = this._shaft(3.4, y - 0.2, 0xffa860, 0.11);
      shaft.position.set(x, (y - 0.2) / 2, z);
      this.flickerLights.push({ light, bulb, shaft, base: 90, seed: i * 13.7, bad: i === 1 });
    });
  }

  _buildBanners() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 384;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 384);
    g.addColorStop(0, '#3a0a0c');
    g.addColorStop(1, '#1a0405');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 384);
    ctx.strokeStyle = '#a0742c';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, 112, 330);
    ctx.beginPath();
    ctx.arc(64, 120, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(64, 70);
    ctx.lineTo(64, 230);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(44, 120);
    ctx.lineTo(84, 120);
    ctx.stroke();
    // tattered bottom
    ctx.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < 128; x += 6) {
      const h = 20 + Math.random() * 60;
      ctx.fillRect(x, 384 - h, 4 + Math.random() * 4, h);
    }
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 128, 150 + Math.random() * 180, 3 + Math.random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });
    for (let i = 0; i < 6; i++) {
      const a = ((i + 0.5) / 6) * Math.PI * 2;
      const R = WALL_RADIUS - 0.4;
      const geo = new THREE.PlaneGeometry(2.4, 7.2, 6, 14);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * R, 8.5, Math.sin(a) * R);
      m.lookAt(0, 8.5, 0);
      m.castShadow = true;
      this.scene.add(m);
      this.banners.push({ mesh: m, base: geo.attributes.position.array.slice(), phase: i * 1.3 });
    }
  }

  _buildRubble() {
    const { concrete } = this._materials();
    const geo = pebble(0.4);
    const count = 140;
    const inst = new THREE.InstancedMesh(geo, concrete, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      let a, r;
      if (i < 90) {
        a = Math.random() * Math.PI * 2;
        r = 33 + Math.random() * 3;
      } else {
        // around pillars
        const k = Math.floor(Math.random() * 8);
        a = (k / 8) * Math.PI * 2 + Math.PI / 8 + (Math.random() - 0.5) * 0.25;
        r = 21 + (Math.random() - 0.5) * 5;
      }
      const sc = 0.3 + Math.random() * 1.2;
      p.set(Math.cos(a) * r, sc * 0.15, Math.sin(a) * r);
      e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      q.setFromEuler(e);
      s.set(sc, sc * (0.5 + Math.random() * 0.5), sc);
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.scene.add(inst);
  }

  _buildWallDetail() {
    const { concrete, darkStone, metal, rust } = this._materials();
    const Rw = WALL_RADIUS;
    // Continuous mouldings around the inner face: plinth, string course and cornice.
    const ring = (profile) => this._batch(darkStone, lathe(profile, 256), 0, 0, 0);
    ring([[Rw + 0.2, 0.9], [Rw - 0.25, 0.9], [Rw - 0.35, 0.8], [Rw - 0.35, 0.12], [Rw - 0.42, 0.05], [Rw - 0.42, 0], [Rw + 0.2, 0]].reverse());
    ring([[Rw + 0.2, 4.5], [Rw - 0.2, 4.5], [Rw - 0.25, 4.42], [Rw - 0.25, 4.25], [Rw - 0.2, 4.2], [Rw + 0.2, 4.2]].reverse());
    ring([[Rw + 0.2, 9.4], [Rw - 0.5, 9.4], [Rw - 0.55, 9.3], [Rw - 0.45, 9.1], [Rw - 0.3, 8.95], [Rw - 0.25, 8.8], [Rw + 0.2, 8.8]].reverse());

    // Pipe runs between the gates with wall brackets and flanged joints.
    const gap = 0.16; // radians kept clear around each gate
    for (let k = 0; k < 6; k++) {
      const start = (k / 6) * Math.PI * 2 + gap;
      const arc = Math.PI / 3 - gap * 2;
      for (const [yy, r, tube] of [[5.25, Rw - 0.32, 0.13], [5.62, Rw - 0.26, 0.07]]) {
        this._batch(k % 2 ? rust : metal, new THREE.TorusGeometry(r, tube, 10, 96, arc), 0, yy, 0, Math.PI / 2, -start, 0);
      }
      const steps = 7;
      for (let j = 0; j <= steps; j++) {
        const ang = start + (arc * j) / steps;
        const cx = Math.cos(ang), cz = Math.sin(ang);
        const yaw = Math.atan2(-cx, -cz);
        this._batch(metal, rbox(0.12, 0.62, 0.36, 0.02), cx * (Rw - 0.2), 5.42, cz * (Rw - 0.2), 0, yaw);
        if (j % 2 === 1) {
          this._batch(metal, new THREE.CylinderGeometry(0.17, 0.17, 0.08, 20), cx * (Rw - 0.32), 5.25, cz * (Rw - 0.32), Math.PI / 2, yaw + Math.PI / 2, 0);
        }
      }
      // A vertical downpipe into a drain at the end of each run.
      const ang = start + arc;
      const cx = Math.cos(ang), cz = Math.sin(ang);
      this._batch(rust, new THREE.CylinderGeometry(0.09, 0.09, 5.2, 14), cx * (Rw - 0.3), 2.6, cz * (Rw - 0.3));
      this._batch(rust, new THREE.TorusGeometry(0.12, 0.09, 10, 20, Math.PI / 2), cx * (Rw - 0.42), 5.2, cz * (Rw - 0.42), 0, Math.atan2(-cx, -cz) + Math.PI / 2, 0);
    }

    // Stone caps on the buttresses.
    for (let i = 0; i < 16; i++) {
      const a = ((i + 0.5) / 16) * Math.PI * 2;
      const bh = 15 + (i % 3) * 1.5;
      const rr = Rw + 0.75 - 1.4;
      this._batch(concrete, taper(rbox(2.0, 1.2, 2.6, 0.3), 0.35), Math.cos(a) * rr, bh + 0.5, Math.sin(a) * rr, 0, Math.atan2(-Math.cos(a), -Math.sin(a)));
    }
  }

  _buildFloorDetail() {
    const { darkStone, metal, concrete } = this._materials();
    // Round iron drain covers set into the flagstones.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 9, z = Math.sin(a) * 9;
      this._batch(darkStone, lathe([[0.62, 0], [0.62, 0.02], [0.55, 0.035], [0.5, 0.01], [0, 0.01]], 48), x, 0, z, 0, 0, 0, 1, 1, 1, false);
      this._batch(metal, new THREE.TorusGeometry(0.46, 0.035, 8, 48), x, 0.015, z, Math.PI / 2, 0, 0, 1, 1, 1, false);
      for (let j = -4; j <= 4; j++) {
        const len = 2 * Math.sqrt(Math.max(0, 0.44 * 0.44 - (j * 0.1) ** 2));
        if (len > 0.05) this._batch(metal, rbox(0.04, 0.03, len, 0.01), x + j * 0.1, 0.02, z, 0, a, 0, 1, 1, 1, false);
      }
    }
    // Scattered debris: broken bricks and stone chips.
    const brick = rbox(0.22, 0.07, 0.1, 0.02);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 140; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 7 + rnd() * 27;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 7 && Math.abs(z) < 7) continue;
      if (rnd() < 0.45) this._batch(concrete, brick, x, 0.035, z, 0, rnd() * 6, rnd() < 0.2 ? 0.3 : 0, 0.7 + rnd() * 0.6, 1, 1, false);
      else this._batch(concrete, pebble(0.05 + rnd() * 0.09, k), x, 0.03, z, rnd(), rnd() * 6, 0, 1, 1, 1, false);
    }
  }

  _buildRain() {
    const count = this.quality === 'low' ? 2500 : 6000;
    const off = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 60, y = Math.random() * 32, z = Math.random() * 60;
      for (let k = 0; k < 2; k++) {
        off.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(off, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uFlash: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset; attribute float aEnd;
        uniform float uTime; uniform vec3 uCenter;
        varying float vA;
        void main(){
          vec3 box = vec3(60.0, 32.0, 60.0);
          vec3 p;
          p.y = mod(aOffset.y - uTime*26.0, box.y);
          p.x = uCenter.x + mod(aOffset.x - uCenter.x + uTime*1.5, box.x) - box.x*0.5;
          p.z = uCenter.z + mod(aOffset.z - uCenter.z, box.z) - box.z*0.5;
          p.y += aEnd*0.9;
          p.x -= aEnd*0.06;
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          float d = -mv.z;
          vA = (1.0 - aEnd*0.9) * smoothstep(32.0, 4.0, d) * smoothstep(0.0, 1.5, d);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uFlash; varying float vA;
        void main(){ gl_FragColor = vec4(vec3(0.6,0.68,0.85)*(1.0+uFlash*3.0), vA*0.32); }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const rain = new THREE.LineSegments(geo, this.rainMat);
    rain.frustumCulled = false;
    this.scene.add(rain);
  }

  _buildDust() {
    const count = 700;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 34;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 12;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: this.renderer.getPixelRatio() } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uPR; varying float vA; varying float vWarm;
        void main(){
          vec3 p = position;
          p.x += sin(uTime*0.2 + aSeed)*0.8;
          p.z += cos(uTime*0.17 + aSeed*1.3)*0.8;
          p.y = mod(p.y + uTime*0.15*(0.5+fract(aSeed)), 12.0);
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          float d = -mv.z;
          vA = smoothstep(28.0, 3.0, d) * (0.4 + 0.6*sin(uTime*1.5 + aSeed*7.0)*0.5+0.3);
          vWarm = step(0.7, fract(aSeed*3.7));
          gl_PointSize = uPR * (40.0 / max(d, 0.5)) * (0.5 + fract(aSeed*1.7));
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vWarm;
        void main(){
          vec2 c = gl_PointCoord - 0.5; float r = dot(c,c);
          float a = smoothstep(0.25, 0.0, r) * vA;
          vec3 col = mix(vec3(0.5,0.6,0.8), vec3(1.0,0.5,0.2), vWarm);
          gl_FragColor = vec4(col*a*0.6, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, this.dustMat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  pulseGate(i) {
    this.gates[i].pulse = 1;
  }

  setMonolithLife(f) {
    this.monolithLife = f;
  }

  update(dt, camPos) {
    const t = (this.time += dt);
    this.skyMat.uniforms.uTime.value = t;
    this.rainMat.uniforms.uTime.value = t;
    this.rainMat.uniforms.uCenter.value.copy(camPos);
    this.dustMat.uniforms.uTime.value = t;

    // Lightning
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      this.nextLightning = 14 + Math.random() * 22;
      this.flash = 1;
      this._flashSeq = [0.0, 0.08, 0.22, 0.3];
      if (this.onThunder) setTimeout(() => this.onThunder(), 600 + Math.random() * 1400);
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.2);
    }
    const strobe = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(t * 60)) : 0;
    this.skyMat.uniforms.uFlash.value = strobe;
    this.rainMat.uniforms.uFlash.value = strobe;
    this.moon.intensity = this.moonBase + strobe * 5;
    this.hemi.intensity = 0.9 + strobe * 1.5;

    // Monolith breathing, dims with the player's life
    const life = this.monolithLife;
    const breath = 0.75 + 0.25 * Math.sin(t * 1.6);
    this.monoMat.emissiveIntensity = (0.6 + life * 3) * breath;
    this.monoLight.intensity = (15 + life * 70) * breath;
    this.capstone.position.y = 11 + Math.sin(t * 0.9) * 0.3;
    this.capstone.rotation.y = t * 0.6;
    this.capstone.material.emissiveIntensity = 2 + life * 5;
    this.rings.forEach((r, i) => {
      r.rotation.x = Math.PI / 2 + Math.sin(t * 0.4 + i) * 0.3;
      r.rotation.y = t * (0.2 + i * 0.1) * (i % 2 ? -1 : 1);
    });
    this.fragments.forEach((f) => {
      const u = f.userData;
      u.a += dt * u.s;
      f.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(t + u.a) * 0.3, Math.sin(u.a) * u.r);
      f.rotation.x += dt;
      f.rotation.y += dt * 0.7;
    });

    // Lamps
    for (const l of this.flickerLights) {
      let k = 0.9 + 0.1 * Math.sin(t * 13 + l.seed) * Math.sin(t * 7.1 + l.seed);
      if (l.bad) {
        const n = Math.sin(t * 3.1 + Math.sin(t * 11.0) * 2.0);
        if (n > 0.85) k *= Math.random() < 0.5 ? 0.1 : 0.6;
      }
      l.light.intensity = l.base * k;
      l.bulb.material.emissiveIntensity = 5 * k;
      l.shaft.material.uniforms.uStrength.value = 0.11 * k;
    }
    for (const s of this.shafts) s.material.uniforms.uTime.value = t;

    // Gates
    for (const g of this.gates) {
      g.pulse = Math.max(0, g.pulse - dt * 0.7);
      g.portal.material.uniforms.uTime.value = t;
      g.portal.material.uniforms.uPulse.value = g.pulse;
      g.light.intensity = 24 + 8 * Math.sin(t * 2 + g.pos.x) + g.pulse * 90;
    }

    // Banners sway
    for (const b of this.banners) {
      const pos = b.mesh.geometry.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        const y = b.base[i + 1];
        const w = (3.6 - y) / 7.2; // 0 at top, 1 at bottom
        arr[i + 2] = b.base[i + 2] + Math.sin(t * 1.3 + b.phase + y * 0.6) * 0.35 * w * w + Math.sin(t * 3.7 + b.base[i] * 2) * 0.05 * w;
      }
      pos.needsUpdate = true;
    }
  }
}

// The Crucible: a ruined, rain-soaked arena under a broken dome.

import * as THREE from 'three';
import { boxCollider, cylCollider, WALL_RADIUS } from './physics.js';
import { floorTextures, wallTextures, runeTexture, crateTexture } from './textures.js';

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
    this._buildRain();
    this._buildDust();
  }

  // --- materials -------------------------------------------------------------------
  _materials() {
    if (this.mats) return this.mats;
    const wall = wallTextures();
    const concrete = new THREE.MeshStandardMaterial({
      map: wall.map,
      bumpMap: wall.bump,
      bumpScale: 2.2,
      color: 0x9aa0ad,
      roughness: 0.9,
      metalness: 0.0,
    });
    const darkStone = concrete.clone();
    darkStone.color = new THREE.Color(0x6a6f7a);
    const metal = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.42, metalness: 0.85 });
    const rust = new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.7, metalness: 0.5 });
    const crate = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.65, metalness: 0.45, color: 0xaaaaaa });
    const redGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2414, emissiveIntensity: 4 });
    const amberGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a2a, emissiveIntensity: 5 });
    const cyanGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x4fe0ff, emissiveIntensity: 4 });
    this.mats = { concrete, darkStone, metal, rust, crate, redGlow, amberGlow, cyanGlow };
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
    this.scene.environmentIntensity = 0.55;
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
    this.hemi = new THREE.HemisphereLight(0x2a3a5c, 0x0b0907, 0.55);
    scene.add(this.hemi);

    const moon = (this.moon = new THREE.DirectionalLight(0x9db2e6, 0.85));
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
    this.moonBase = 0.85;
  }

  _buildFloor() {
    const t = floorTextures();
    t.map.repeat.set(9.5, 9.5);
    t.bump.repeat.set(9.5, 9.5);
    const mat = new THREE.MeshStandardMaterial({
      map: t.map,
      bumpMap: t.bump,
      bumpScale: 0.7,
      roughnessMap: t.rough,
      roughness: 1,
      metalness: 0.05,
      color: 0xb8bcc6,
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
    const wallMat = concrete.clone();
    wallMat.map = concrete.map.clone();
    wallMat.map.repeat.set(1, 2.5);
    wallMat.map.needsUpdate = true;
    wallMat.bumpMap = concrete.bumpMap.clone();
    wallMat.bumpMap.repeat.set(1, 2.5);
    wallMat.bumpMap.needsUpdate = true;
    const geo = new THREE.BoxGeometry(w, 1, 1.5);
    geo.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(geo, wallMat, segs);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const h = 13 + Math.abs(Math.sin(i * 1.7) * 5) + (i % 7 === 0 ? -4 : 0);
      p.set(Math.cos(a) * R, 0, Math.sin(a) * R);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      s.set(1, h, 1);
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.scene.add(inst);

    // Buttresses
    const bgeo = new THREE.BoxGeometry(2.2, 1, 3.2);
    bgeo.translate(0, 0.5, 0);
    const bcount = 16;
    const binst = new THREE.InstancedMesh(bgeo, concrete, bcount);
    for (let i = 0; i < bcount; i++) {
      const a = ((i + 0.5) / bcount) * Math.PI * 2;
      const rr = R - 1.4;
      p.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      s.set(1, 15 + (i % 3) * 1.5, 1);
      m.compose(p, q, s);
      binst.setMatrixAt(i, m);
    }
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
    ring(2.6, 0.06, WALL_RADIUS - 0.05, 5);
    ring(0.35, 0.04, WALL_RADIUS - 0.05, 2.5);
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
      const tube = new THREE.TubeGeometry(new PartialCurve(curve, broken), 28, 0.7, 4, false);
      const mesh = new THREE.Mesh(tube, darkStone);
      mesh.castShadow = true;
      this.scene.add(mesh);
    }
    const crown = new THREE.Mesh(new THREE.TorusGeometry(8, 0.8, 6, 48, Math.PI * 1.45), darkStone);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 27;
    crown.castShadow = true;
    this.scene.add(crown);
    // Hanging chains from the crown
    for (let i = 0; i < 5; i++) {
      const a = i * 1.1;
      const len = 4 + (i % 3) * 3;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 4), metal);
      c.position.set(Math.cos(a) * 8, 27 - len / 2, Math.sin(a) * 8);
      this.scene.add(c);
    }
  }

  _buildCenter() {
    const { darkStone, metal, cyanGlow } = this._materials();
    // Dais
    const dais = this._mesh(new THREE.CylinderGeometry(6, 6.3, 0.5, 48), darkStone, 0, 0.25, 0);
    dais.castShadow = false;
    this.colliders.push(cylCollider(0, 0, 6.15, 0, 0.5));
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.04, 6, 96), cyanGlow);
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
    const mono = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.3, 9, 4, 1), monoMat);
    mono.rotation.y = Math.PI / 4;
    mono.position.y = 5;
    mono.castShadow = true;
    mono.receiveShadow = true;
    this.scene.add(mono);
    this.monoMat = monoMat;
    this.colliders.push(boxCollider(-1.05, 0, -1.05, 1.05, 9.5, 1.05));

    // Floating capstone and orbiting rings
    const cap = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.9, 0),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x9ff0ff, emissiveIntensity: 6 })
    );
    cap.position.y = 11;
    this.scene.add(cap);
    this.capstone = cap;
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2.2 + i * 0.7, 0.03, 6, 96), cyanGlow);
      r.position.y = 6 + i * 1.6;
      this.scene.add(r);
      this.rings.push(r);
    }
    // Fragments orbiting
    this.fragments = [];
    const fragGeo = new THREE.TetrahedronGeometry(0.25, 0);
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
    const { concrete, darkStone } = this._materials();
    const geo = new THREE.CylinderGeometry(1.1, 1.25, 17, 8);
    const base = new THREE.BoxGeometry(3, 1.2, 3);
    const capital = new THREE.BoxGeometry(2.8, 0.9, 2.8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 21, z = Math.sin(a) * 21;
      const broken = i === 3 || i === 6;
      const h = broken ? 6.5 + i * 0.3 : 17;
      const p = this._mesh(broken ? new THREE.CylinderGeometry(1.0, 1.25, h, 8) : geo, concrete, x, h / 2, z);
      p.rotation.y = a;
      const b = this._mesh(base, darkStone, x, 0.6, z);
      b.rotation.y = a;
      if (!broken) {
        const c = this._mesh(capital, darkStone, x, 16.6, z);
        c.rotation.y = a;
      } else {
        // fallen chunk next to the broken pillar
        const chunk = this._mesh(new THREE.CylinderGeometry(1.05, 1.1, 3.4, 8), concrete, x + Math.cos(a + 1.4) * 2.6, 1.05, z + Math.sin(a + 1.4) * 2.6);
        chunk.rotation.set(Math.PI / 2, 0, a + 0.4);
        this.colliders.push(cylCollider(chunk.position.x, chunk.position.z, 1.3, 0, 2.1));
      }
      this.colliders.push(cylCollider(x, z, 1.5, 0, h));
    }
  }

  _buildCover() {
    const { darkStone, metal, crate, amberGlow } = this._materials();
    // Low barricades on the cardinal axes.
    const addWall = (cx, cz, alongZ) => {
      const w = alongZ ? 1 : 6, d = alongZ ? 6 : 1, h = 1.4;
      this._mesh(new THREE.BoxGeometry(w, h, d), darkStone, cx, h / 2, cz);
      const trim = this._mesh(new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.1), metal, cx, h + 0.06, cz);
      trim.castShadow = false;
      const glow = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 1.02 : 5.2, 0.05, alongZ ? 5.2 : 1.02), amberGlow);
      glow.position.set(cx, 0.9, cz);
      this.scene.add(glow);
      this.colliders.push(boxCollider(cx - w / 2, 0, cz - d / 2, cx + w / 2, h + 0.12, cz + d / 2));
    };
    addWall(12, 0, true);
    addWall(-12, 0, true);
    addWall(0, 12, false);
    addWall(0, -12, false);

    const crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const addCrate = (x, z, y = 0, rot = 0) => {
      const c = this._mesh(crateGeo, crate, x, y + 0.8, z);
      c.rotation.y = rot;
      // Collider is the axis-aligned footprint (crates are rotated little).
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
  }

  _buildPlatforms() {
    const { concrete, darkStone, metal, amberGlow } = this._materials();
    const build = (cx, cz, dir) => {
      const s = 8, h = 3;
      this._mesh(new THREE.BoxGeometry(s, h, s), concrete, cx, h / 2, cz);
      const top = this._mesh(new THREE.BoxGeometry(s + 0.3, 0.2, s + 0.3), metal, cx, h + 0.1, cz);
      top.castShadow = false;
      this.colliders.push(boxCollider(cx - s / 2, 0, cz - s / 2, cx + s / 2, h + 0.2, cz + s / 2));
      // corner beacons
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.25), amberGlow);
        b.position.set(cx + ox * (s / 2 - 0.2), h + 0.45, cz + oz * (s / 2 - 0.2));
        this.scene.add(b);
      }
      // Stairs descending toward the arena centre along X.
      const edge = cx - dir * (s / 2);
      const steps = 5, rise = 0.5, run = 0.85;
      for (let k = 1; k <= steps; k++) {
        const len = run * (steps + 1 - k);
        const x0 = dir > 0 ? edge - len : edge;
        const x1 = dir > 0 ? edge : edge + len;
        const y = k * rise + 0.2;
        const zc = cz - dir * 1.2;
        const st = this._mesh(new THREE.BoxGeometry(x1 - x0, y, 4), darkStone, (x0 + x1) / 2, y / 2, zc);
        st.castShadow = k === 1;
        this.colliders.push(boxCollider(x0, 0, zc - 2, x1, y, zc + 2));
      }
      this.pickupSpots.push(new THREE.Vector3(cx, h + 0.2, cz));
    };
    build(20.5, 20.5, 1);
    build(-20.5, -20.5, -1);
  }

  _buildGates() {
    const { darkStone, metal } = this._materials();
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
      // Arch frame
      const colGeo = new THREE.BoxGeometry(0.8, 6, 0.9);
      for (const sx of [-2.1, 2.1]) {
        const c = new THREE.Mesh(colGeo, darkStone);
        c.position.set(sx, 3, 0.2);
        c.castShadow = true;
        group.add(c);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.9, 1.0), darkStone);
      lintel.position.set(0, 6.3, 0.2);
      lintel.castShadow = true;
      group.add(lintel);
      const grate = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.15, 1.2), metal);
      grate.position.set(0, 0.07, 0.4);
      group.add(grate);
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 5.6), portalMat.clone());
      portal.position.set(0, 2.9, 0.05);
      group.add(portal);
      const light = new THREE.PointLight(0xff2a14, 18, 16, 1.7);
      light.position.copy(base).addScaledVector(dirIn, 2).setY(2.8);
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
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, chainLen, 4), metal);
      chain.position.set(x, y + chainLen / 2, z);
      this.scene.add(chain);
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.8, 0.6, 8, 1, true), metal);
      housing.position.set(x, y + 0.2, z);
      housing.material.side = THREE.DoubleSide;
      this.scene.add(housing);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), amberGlow.clone());
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
    const geo = new THREE.DodecahedronGeometry(0.4, 0);
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
    this.hemi.intensity = 0.55 + strobe * 1.5;

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
      g.light.intensity = 14 + 6 * Math.sin(t * 2 + g.pos.x) + g.pulse * 90;
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

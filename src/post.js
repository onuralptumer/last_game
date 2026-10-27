// Post-processing: weapon overlay pass, bloom, colour grade, film grain, damage effects.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uLow: { value: 0 },
    uAberr: { value: 0.0015 },
    uVignette: { value: 0.55 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uDeath: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uDamage, uLow, uAberr, uVignette, uDeath; uniform vec2 uRes;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float ab = uAberr + uDamage*0.008 + uDeath*0.01;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c*ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c*ab).b;
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      // cool shadows, slightly warm highlights
      col = mix(col, col*vec3(0.88,0.96,1.15), smoothstep(0.35, 0.0, l)*0.6);
      col = mix(col, col*vec3(1.06,1.0,0.92), smoothstep(0.6, 2.0, l)*0.4);
      // low health: drain colour, push red
      float desat = clamp(uLow*0.6 + uDeath, 0.0, 1.0);
      col = mix(col, vec3(l)*vec3(1.25,0.55,0.5), desat*0.7);
      // vignette
      float v = smoothstep(0.9, 0.2, length(c*vec2(1.0, 0.8)));
      col *= mix(1.0 - uVignette - uDeath*0.4, 1.0, v);
      col += vec3(0.5,0.0,0.0) * uDamage * (1.0 - v) * 1.4;
      // grain
      col += (rand(uv*uRes + fract(uTime)*100.0) - 0.5) * 0.04 * (0.25 + l);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, wScene, wCamera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.mainPass = new RenderPass(scene, camera);
    this.weaponPass = new RenderPass(wScene, wCamera);
    this.weaponPass.clear = false;
    this.weaponPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.85, 0.55, 0.82);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.mainPass);
    this.composer.addPass(this.weaponPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
    this.showWeapon = true;
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w, h);
  }

  setQuality(q) {
    this.bloom.enabled = q !== 'low';
  }

  render(dt, { damage = 0, low = 0, death = 0, weapon = true }) {
    const u = this.grade.uniforms;
    u.uTime.value += dt;
    u.uDamage.value = damage;
    u.uLow.value = low;
    u.uDeath.value = death;
    this.weaponPass.enabled = weapon;
    this.composer.render(dt);
  }
}

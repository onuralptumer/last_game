// Loads the procedural PBR texture sets, generating them in parallel Web Workers.

import * as THREE from 'three';
import { GENERATORS } from './pbr-gen.js';

let cache = null;

function texture(data, S, srgb) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function toSet(r) {
  return { albedo: texture(r.albedo, r.S, true), normal: texture(r.normal, r.S, false), orm: texture(r.orm, r.S, false) };
}

// Resolves once every material is ready. onProgress(done, total).
export async function loadMaterials(onProgress = () => {}) {
  if (cache) return cache;
  const names = Object.keys(GENERATORS);
  const out = {};
  let done = 0;
  const t0 = performance.now();
  try {
    const n = Math.max(1, Math.min(names.length, (navigator.hardwareConcurrency || 4) - 1, 6));
    const queue = [...names].sort((a, b) => (a === 'flag' || a === 'ashlar' ? -1 : 0) - (b === 'flag' || b === 'ashlar' ? -1 : 0));
    await Promise.all(
      Array.from({ length: n }, () =>
        new Promise((resolve, reject) => {
          const w = new Worker(new URL('./pbr-worker.js', import.meta.url), { type: 'module' });
          const next = () => {
            const name = queue.shift();
            if (!name) {
              w.terminate();
              resolve();
              return;
            }
            w.postMessage({ name });
          };
          w.onmessage = ({ data }) => {
            out[data.name] = toSet(data);
            onProgress(++done, names.length);
            next();
          };
          w.onerror = (e) => {
            w.terminate();
            reject(e);
          };
          next();
        })
      )
    );
  } catch (e) {
    // Workers unavailable: generate whatever is missing on the main thread.
    console.warn('PBR workers failed, generating on main thread', e);
    for (const name of names) {
      if (out[name]) continue;
      out[name] = toSet(GENERATORS[name]());
      onProgress(++done, names.length);
    }
  }
  cache = out;
  cache.ms = performance.now() - t0;
  window.__pbrMs = cache.ms;
  return cache;
}

export function materials() {
  if (!cache) throw new Error('loadMaterials() must complete first');
  return cache;
}

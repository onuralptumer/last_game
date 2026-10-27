// Shared rounded geometry helpers: everything in the game uses soft, bevelled forms.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Box with rounded edges. `r` defaults to a fraction of the smallest side.
export function rbox(w, h, d, r = null, segments = 3) {
  const min = Math.min(w, h, d);
  let radius = r === null ? min * 0.22 : r;
  radius = Math.max(0.001, Math.min(radius, min / 2 - 1e-4));
  return new RoundedBoxGeometry(w, h, d, segments, radius);
}

// Capsule aligned with Y, total length `len` (including the rounded caps).
export function capsule(r, len, radial = 12) {
  return new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 4, radial);
}

// Narrows a geometry toward its top: x/z scaled from 1 at the bottom to `top` at the top.
export function taper(geo, top) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / (max.y - min.y);
    const s = 1 + (top - 1) * t;
    pos.setX(i, pos.getX(i) * s);
    pos.setZ(i, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}

// Merge many transformed copies into a single geometry (one draw call).
export function merged(parts) {
  const geos = parts.map(({ geo, matrix }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  return mergeGeometries(geos, false);
}

// A smooth, lumpy stone: a subdivided sphere with low-frequency bumps.
export function pebble(r, seed = 1) {
  const base = new THREE.IcosahedronGeometry(r, 2);
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const geo = mergeVertices(base);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 7.1 + seed) * Math.sin(v.y * 6.3 + seed * 2) * Math.sin(v.z * 5.7 + seed * 3);
    v.multiplyScalar(1 + n * 0.28);
    pos.setXYZ(i, v.x, v.y * 0.8, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

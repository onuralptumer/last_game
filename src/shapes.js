// Shared rounded geometry helpers: everything in the game uses soft, bevelled forms.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Box with rounded edges. `r` defaults to a fraction of the smallest side.
// Bevel resolution scales with the bevel size: tiny parts don't need smooth arcs.
export function rbox(w, h, d, r = null, segments = null) {
  const min = Math.min(w, h, d);
  let radius = r === null ? min * 0.22 : r;
  radius = Math.max(0.001, Math.min(radius, min / 2 - 1e-4));
  const seg = segments ?? (radius > 0.2 ? 3 : radius > 0.05 ? 2 : 1);
  return new RoundedBoxGeometry(w, h, d, seg, radius);
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
    const g = geo.clone();
    // Keep index buffers (3x fewer vertices); give non-indexed geometry a trivial index.
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
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

// Fluted column shaft (classical grooves), optionally with a jagged broken top.
export function flutedShaft(rBottom, rTop, h, { flutes = 20, depth = 0.05, jagged = 0, seed = 1 } = {}) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, flutes * 6, Math.max(8, Math.round(h * 2)), false);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.z);
    if (r < 1e-4) {
      if (jagged && v.y > 0) v.y -= jagged * 0.6;
      pos.setXYZ(i, v.x, v.y, v.z);
      continue;
    }
    const a = Math.atan2(v.z, v.x);
    const groove = Math.pow(Math.max(0, Math.cos(a * flutes)), 0.6);
    let k = 1 - depth * groove;
    if (jagged && v.y > h / 2 - 1e-3 - 0.0) {
      const n = Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 7 + seed * 2) * 0.3 + Math.sin(a * 13 + seed) * 0.2;
      v.y -= jagged * (0.5 + n * 0.5);
    }
    pos.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  geo.deleteAttribute('normal');
  const m = mergeVertices(geo.deleteAttribute('uv'));
  m.computeVertexNormals();
  return m;
}

// Surface of revolution from [radius, y] pairs.
export function lathe(points, segments = 64) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

// Steel I-beam of length `len` along Y.
export function iBeam(h = 0.3, w = 0.2, len = 3, flange = 0.03, web = 0.02) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2 + flange);
  s.lineTo(web / 2, -h / 2 + flange);
  s.lineTo(web / 2, h / 2 - flange);
  s.lineTo(w / 2, h / 2 - flange);
  s.lineTo(w / 2, h / 2);
  s.lineTo(-w / 2, h / 2);
  s.lineTo(-w / 2, h / 2 - flange);
  s.lineTo(-web / 2, h / 2 - flange);
  s.lineTo(-web / 2, -h / 2 + flange);
  s.lineTo(-w / 2, -h / 2 + flange);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateX(Math.PI / 2);
  return g;
}

// Concrete "jersey" traffic barrier segment, length along X.
export function jerseyBarrier(len = 1.95) {
  const s = new THREE.Shape();
  const pts = [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.2, 0.3], [0.1, 0.82], [-0.1, 0.82], [-0.2, 0.3], [-0.3, 0.08]];
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(len - 0.08) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// A slumped sandbag: rounded pillow with gentle lumps.
export function sandbag(seed = 1) {
  const g = rbox(0.62, 0.2, 0.36, 0.09, 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 9 + seed) * Math.sin(z * 11 + seed * 1.7) * 0.025;
    const sag = (1 - (x / 0.31) ** 2) * 0.04 * Math.sign(y);
    pos.setXYZ(i, x * (1 - Math.abs(y) * 0.6), y + n + sag * 0.5, z * (1 - Math.abs(y) * 0.4));
  }
  g.computeVertexNormals();
  return g;
}

// 200 L oil drum with rolling hoops and rims.
export function oilDrum() {
  const r = 0.29, h = 0.88;
  const p = [[0, 0], [r - 0.02, 0], [r, 0.015], [r, 0.03], [r - 0.006, 0.05]];
  for (const hy of [0.29, 0.59]) p.push([r - 0.006, hy - 0.03], [r + 0.012, hy - 0.012], [r + 0.012, hy + 0.012], [r - 0.006, hy + 0.03]);
  p.push([r - 0.006, h - 0.05], [r, h - 0.03], [r, h - 0.015], [r - 0.02, h], [r - 0.03, h - 0.012], [0, h - 0.012]);
  return lathe(p, 40);
}

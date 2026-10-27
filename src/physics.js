// Lightweight analytic collision: vertical cylinders and axis-aligned boxes.
// Actors are vertical cylinders (feet position + radius + height).

import * as THREE from 'three';

export const ARENA_RADIUS = 36; // walkable radius
export const WALL_RADIUS = 37.2; // radius of the visual/ballistic wall

export function boxCollider(minX, minY, minZ, maxX, maxY, maxZ) {
  return { type: 'box', minX, minY, minZ, maxX, maxY, maxZ, bottom: minY, top: maxY };
}

export function cylCollider(x, z, r, bottom, top) {
  return { type: 'cyl', x, z, r, bottom, top };
}

// Pushes the actor out of colliders. If canStep, low obstacles are climbed instead.
// Returns true if the actor stepped up onto something.
export function resolveActor(colliders, pos, r, h, stepH, canStep) {
  let stepped = false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (pos.y >= c.top - 1e-3 || pos.y + h <= c.bottom) continue;
    if (c.type === 'box') {
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      let dx = pos.x - cx;
      let dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (canStep && c.top - pos.y <= stepH) {
        pos.y = c.top;
        stepped = true;
        continue;
      }
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        // Centre is inside the footprint: exit via the shallowest side.
        const pl = pos.x - c.minX, pr = c.maxX - pos.x, pb = pos.z - c.minZ, pf = c.maxZ - pos.z;
        const m = Math.min(pl, pr, pb, pf);
        if (m === pl) pos.x = c.minX - r;
        else if (m === pr) pos.x = c.maxX + r;
        else if (m === pb) pos.z = c.minZ - r;
        else pos.z = c.maxZ + r;
      }
    } else {
      let dx = pos.x - c.x;
      let dz = pos.z - c.z;
      const minD = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      if (canStep && c.top - pos.y <= stepH) {
        pos.y = c.top;
        stepped = true;
        continue;
      }
      let d = Math.sqrt(d2);
      if (d < 1e-5) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      pos.x = c.x + (dx / d) * minD;
      pos.z = c.z + (dz / d) * minD;
    }
  }
  const lim = ARENA_RADIUS - r;
  const d = Math.hypot(pos.x, pos.z);
  if (d > lim) {
    pos.x *= lim / d;
    pos.z *= lim / d;
  }
  return stepped;
}

// Highest surface under the actor's footprint that is at or below feetY (+ tolerance).
export function groundHeight(colliders, x, z, r, feetY) {
  let g = 0;
  const rr = r * 0.6;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.top > feetY + 0.06 || c.top <= g) continue;
    if (c.type === 'box') {
      const cx = Math.max(c.minX, Math.min(x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < rr * rr) g = c.top;
    } else {
      const minD = rr + c.r;
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < minD * minD) g = c.top;
    }
  }
  return g;
}

const _hit = { t: 0, normal: new THREE.Vector3() };

// Ray vs static world. Returns {t, normal} (shared object) or null.
export function raycastWorld(colliders, o, d, maxT) {
  let best = maxT;
  let nx = 0, ny = 0, nz = 0;
  let found = false;

  // Floor
  if (d.y < -1e-6) {
    const t = -o.y / d.y;
    if (t > 0 && t < best) {
      best = t; nx = 0; ny = 1; nz = 0; found = true;
    }
  }
  // Arena wall (from inside)
  {
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-9) {
      const b = 2 * (o.x * d.x + o.z * d.z);
      const c = o.x * o.x + o.z * o.z - WALL_RADIUS * WALL_RADIUS;
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const t = (-b + Math.sqrt(disc)) / (2 * a);
        if (t > 0 && t < best && o.y + d.y * t < 18) {
          best = t;
          const px = o.x + d.x * t, pz = o.z + d.z * t;
          nx = -px / WALL_RADIUS; ny = 0; nz = -pz / WALL_RADIUS; found = true;
        }
      }
    }
  }

  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.type === 'box') {
      let tmin = -Infinity, tmax = Infinity, ax = -1, sgn = 0;
      const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
      const mins = [c.minX, c.minY, c.minZ], maxs = [c.maxX, c.maxY, c.maxZ];
      let miss = false;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(ds[k]) < 1e-9) {
          if (os[k] < mins[k] || os[k] > maxs[k]) { miss = true; break; }
          continue;
        }
        let t1 = (mins[k] - os[k]) / ds[k];
        let t2 = (maxs[k] - os[k]) / ds[k];
        let s = -1;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
        if (t1 > tmin) { tmin = t1; ax = k; sgn = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { miss = true; break; }
      }
      if (miss || tmin < 0 || tmin >= best) continue;
      best = tmin;
      nx = ax === 0 ? sgn : 0; ny = ax === 1 ? sgn : 0; nz = ax === 2 ? sgn : 0;
      found = true;
    } else {
      // side
      const ox = o.x - c.x, oz = o.z - c.z;
      const a = d.x * d.x + d.z * d.z;
      if (a > 1e-9) {
        const b = 2 * (ox * d.x + oz * d.z);
        const cc = ox * ox + oz * oz - c.r * c.r;
        const disc = b * b - 4 * a * cc;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / (2 * a);
          if (t > 0 && t < best) {
            const y = o.y + d.y * t;
            if (y >= c.bottom && y <= c.top) {
              best = t;
              nx = (ox + d.x * t) / c.r; ny = 0; nz = (oz + d.z * t) / c.r; found = true;
            }
          }
        }
      }
      // top cap
      if (d.y < -1e-6) {
        const t = (c.top - o.y) / d.y;
        if (t > 0 && t < best) {
          const px = ox + d.x * t, pz = oz + d.z * t;
          if (px * px + pz * pz <= c.r * c.r) {
            best = t; nx = 0; ny = 1; nz = 0; found = true;
          }
        }
      }
    }
  }
  if (!found) return null;
  _hit.t = best;
  _hit.normal.set(nx, ny, nz);
  return _hit;
}

// Ray vs sphere: returns entry distance or -1.
export function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t >= 0 ? t : -1;
}

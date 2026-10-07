import * as THREE from 'three';

/**
 * Things standing on the ground that the walkable world does not hold: lamp
 * posts and parked bicycles. Each is an upright circle on the plan; people
 * and bicycles are pushed out of them the way they are pushed apart from each
 * other, so nobody walks or rides through a lamp post or a parked bicycle.
 */
export type Post = { x: number; y: number; z: number; r: number; bike?: unknown };

/** The push that moves a circle of `radius` at a point out of every post. */
export function pushOut(x: number, y: number, z: number, radius: number, posts: Iterable<Post>, out: THREE.Vector3) {
  out.set(0, 0, 0);
  for (const p of posts) {
    const min = radius + p.r, dx = x + out.x - p.x, dz = z + out.z - p.z;
    if (dx > min || dx < -min || dz > min || dz < -min || Math.abs(y - p.y) > 1.8) continue;
    const d = Math.hypot(dx, dz);
    if (d >= min) continue;
    if (d < 1e-4) { out.x += min; continue; }
    out.x += dx / d * (min - d); out.z += dz / d * (min - d);
  }
  return out;
}

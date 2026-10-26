/** Edge distance for a polygon outline. Positive inside, negative outside, in metres. */
export function createBoundary(loops: number[][][], offsetX = 0, offsetZ = 0) {
  const polys = loops.map(loop => loop.map(([x, z]) => [x + offsetX, z + offsetZ]));
  const edgeOf = (x: number, z: number) => {
    let inside = false, best = Infinity;
    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, az] = poly[j], [bx, bz] = poly[i];
        if ((bz > z) !== (az > z) && x < (ax - bx) * (z - bz) / (az - bz) + bx) inside = !inside;
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        const ex = x - ax - t * dx, ez = z - az - t * dz, d2 = ex * ex + ez * ez;
        if (d2 < best) best = d2;
      }
    }
    return inside ? Math.sqrt(best) : -Math.sqrt(best);
  };
  return { edgeOf, polys };
}
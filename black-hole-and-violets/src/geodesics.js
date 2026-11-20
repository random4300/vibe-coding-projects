const columns = 2048;
const rows = 513;
const maximumAngle = 3 * Math.PI;
const end = Math.sqrt(7.5);
const criticalImpact = 3 * Math.sqrt(3);

// In units G = c = M = 1, a null geodesic in its orbital plane satisfies
// u'' + u = 3u², where u = 1/r and the incident direction starts at phi = 0.
// The first lookup row stores the escape angle. The other rows store u(phi).
export function generateGeodesics() {
  const table = new Float32Array(columns * rows);
  const step = maximumAngle / (rows - 2);
  const acceleration = u => u * (3 * u - 1);
  for (let x = 0; x < columns; x++) {
    const q = x / (columns - 1) * (1 + end) - 1;
    const b = Math.max(0.012, 1 + Math.sign(q) * q * q) * criticalImpact;
    let u = 0;
    let v = 1 / b;
    let boundary = 0;
    let escape = -1;
    for (let y = 1; y < rows; y++) {
      table[y * columns + x] = boundary || u;
      if (boundary) continue;
      const a = acceleration(u);
      const v2 = v + a * step / 2;
      const a2 = acceleration(u + v * step / 2);
      const v3 = v + a2 * step / 2;
      const a3 = acceleration(u + v2 * step / 2);
      const v4 = v + a3 * step;
      const a4 = acceleration(u + v3 * step);
      const next = u + (v + 2 * v2 + 2 * v3 + v4) * step / 6;
      v += (a + 2 * a2 + 2 * a3 + a4) * step / 6;
      if (next > 0.5) boundary = 0.53;
      if (next < 0) {
        escape = (y - 1 + u / (u - next)) * step;
        boundary = -0.05;
      }
      u = next;
    }
    table[x] = escape;
  }
  return { table, columns, rows, maximumAngle, end };
}

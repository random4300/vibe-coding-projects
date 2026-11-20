import { add, clamp, cross, lerp, scale, sub, TAU, unit } from './math.js';

export class MeshBuilder {
  vertices = [];
  indices = [];

  surface(stepsU, stepsV, point, material, orientation = 1) {
    const start = this.vertices.length / 9;
    const stride = stepsV + 1;
    const epsilon = 0.002;
    for (let i = 0; i <= stepsU; i++) {
      for (let j = 0; j <= stepsV; j++) {
        const u = i / stepsU;
        const v = j / stepsV;
        const nu = clamp(u, 2 * epsilon, 1 - 2 * epsilon);
        const nv = clamp(v, 2 * epsilon, 1 - 2 * epsilon);
        const du = sub(point(nu + epsilon, nv), point(nu - epsilon, nv));
        const dv = sub(point(nu, nv + epsilon), point(nu, nv - epsilon));
        const normal = scale(unit(cross(du, dv)), orientation);
        this.vertices.push(...point(u, v), ...normal, material, u, v);
        if (i < stepsU && j < stepsV) {
          const a = start + i * stride + j;
          this.indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
        }
      }
    }
  }

  ellipsoid(center, radii, material, sides = 24, rings = 12, power = 1) {
    const signedPower = a => Math.sign(a) * Math.pow(Math.abs(a), power);
    this.surface(sides, rings, (u, v) => {
      const theta = u * TAU;
      const phi = lerp(0.001, Math.PI - 0.001, v);
      return [
        center[0] + radii[0] * signedPower(Math.sin(phi) * Math.cos(theta)),
        center[1] + radii[1] * signedPower(Math.cos(phi)),
        center[2] + radii[2] * signedPower(Math.sin(phi) * Math.sin(theta)),
      ];
    }, material);
  }

  tube(a, b, radiusA, radiusB, material, sides = 10, rings = 3, bulge = 0) {
    const along = unit(sub(b, a));
    const tangent = unit(cross(along, Math.abs(along[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0]));
    const bitangent = cross(along, tangent);
    this.surface(sides, rings, (u, v) => {
      const angle = u * TAU;
      const radius = lerp(radiusA, radiusB, v) + Math.sin(v * Math.PI) * bulge;
      const offset = add(scale(tangent, radius * Math.cos(angle)), scale(bitangent, radius * Math.sin(angle)));
      return add(a.map((x, i) => lerp(x, b[i], v)), offset);
    }, material);
  }

  torus(center, radius, thickness, material, axis = 'y', sides = 28, rings = 6, aspect = 1) {
    this.surface(sides, rings, (u, v) => {
      const a = u * TAU;
      const b = v * TAU;
      const r = radius + Math.cos(b) * thickness;
      const q = [Math.cos(a) * r, Math.sin(b) * thickness, Math.sin(a) * r * aspect];
      const p = axis === 'x' ? [q[1], -q[0], q[2]] : axis === 'z' ? [q[0], -q[2], q[1]] : q;
      return add(center, p);
    }, material, -1);
  }

  finish() {
    return {
      vertices: new Float32Array(this.vertices),
      indices: new Uint16Array(this.indices),
    };
  }
}

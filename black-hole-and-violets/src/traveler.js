import { add, clamp, cross, lerp, scale, sub, TAU, unit } from './math.js';
import { MeshBuilder } from './mesh.js';

export const travelerPosition = [0.87, -0.01, -16.35];

export const travelerMaterials = {
  rubber: 2, alloy: 3, visor: 4, seal: 5, indicator: 6, harness: 7,
  helmet: 8, ceramic: 9, graphite: 10, bronze: 11, hose: 12, pressure: 13,
};
const M = travelerMaterials;

const leftArm = [[-0.305, 1.561, -0.137], [-0.332, 1.336, -0.280], [-0.313, 1.062, -0.202]];
const rightArm = [[0.308, 1.562, -0.136], [0.336, 1.333, -0.277], [0.316, 1.062, -0.189]];
const helmetFit = { from: [0, 1.689, 0.019], to: [0, 1.681, 0.006], scale: [0.906, 0.899, 0.905] };
const packFit = { from: [0, 1.241, 0.228], to: [0, 1.219, 0.195], scale: [0.839, 0.876, 0.752] };

function fitted(point, { from, to, scale }) {
  return point.map((value, i) => to[i] + scale[i] * (value - from[i]));
}

export const equipmentCenters = {
  neck: helmetFit.to,
  helmet: fitted([0, 1.870, 0.014], helmetFit),
  pack: fitted([0, 1.265, 0.345], packFit),
};

function fitEquipment(mesh, start, fit) {
  for (let i = start; i < mesh.vertices.length; i += 9) {
    const position = fitted(mesh.vertices.slice(i, i + 3), fit);
    const normal = unit(fit.scale.map((factor, axis) => mesh.vertices[i + 3 + axis] / factor));
    for (let axis = 0; axis < 3; axis++) {
      mesh.vertices[i + axis] = position[axis];
      mesh.vertices[i + 3 + axis] = normal[axis];
    }
  }
}

// The gloved hand inherits the elbow and shoulder, with each pivot in the
// suit's rest space. The renderer uses these same matrices for both shadows.
function joint(matrices, index, parent, pivot, pitch, yaw, roll) {
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const sr = Math.sin(roll), cr = Math.cos(roll);
  const x = [cy * cr, cy * sr, sy];
  const y = [-sy * sp * cr - cp * sr, cp * cr - sy * sp * sr, cy * sp];
  const z = [sp * sr - sy * cp * cr, -sy * cp * sr - sp * cr, cy * cp];
  const origin = pivot.map((value, i) => value - (x[i] * pivot[0] + y[i] * pivot[1] + z[i] * pivot[2]));
  const columns = [x, y, z, origin];
  const destination = 16 * index, basis = 16 * parent;
  for (let column = 0; column < 4; column++) {
    const point = columns[column];
    const translation = column === 3;
    const offset = destination + 4 * column;
    for (let row = 0; row < 3; row++) {
      matrices[offset + row] = parent < 0 ? point[row]
        : matrices[basis + row] * point[0] + matrices[basis + 4 + row] * point[1]
          + matrices[basis + 8 + row] * point[2] + (translation ? matrices[basis + 12 + row] : 0);
    }
    matrices[offset + 3] = translation ? 1 : 0;
  }
}

export function poseTraveler(time, pose, arms) {
  const inhale = 0.5 - 0.5 * Math.cos(TAU * (time / 6.63 + 0.18 + 0.035 * Math.sin(0.22 * time)));
  const weight = Math.sin(time * 0.123 - 0.36 + 0.28 * Math.sin(time * 0.071));
  const gaze = Math.sin(time * 0.168 + 0.64);

  pose.set([
    0.008 + 0.012 * weight, -0.004 * weight, 0.005 * weight, -0.097 + 0.009 * weight,
    -0.092 + 0.017 * gaze, 0.146 + 0.015 * gaze + 0.007 * inhale, -0.009 + 0.014 * weight,
    -0.026 + 0.007 * weight,
    inhale, 0.012 + 0.016 * weight, 0, 0,
  ]);

  // Rest the elbows below the shoulders. Only breathing and a small
  // weight transfer disturb the hands.
  joint(arms, 0, -1, leftArm[0], -0.415 + 0.010 * inhale, 0.007, -0.087 + 0.009 * weight);
  joint(arms, 1, 0, leftArm[1], 0.577 + 0.007 * weight, -0.012, 0.021);
  joint(arms, 2, 1, leftArm[2], 0.016, 0.031, -0.010);
  joint(arms, 3, -1, rightArm[0], -0.472 + 0.012 * inhale, -0.027, 0.129 - 0.009 * weight);
  joint(arms, 4, 3, rightArm[1], 0.566 - 0.008 * weight, 0.021, -0.028);
  joint(arms, 5, 4, rightArm[2], 0.028, -0.044, 0.008);
}


// Molded enclosures have planar panels and a fixed bevel around corners.
function enclosure(mesh, center, extent, radius, material) {
  const inner = extent.map(half => half - radius);
  function coordinate(axis, t) {
    const edge = extent[axis], flat = inner[axis];
    const stops = [-edge, -edge + 0.17 * radius, -edge + 0.43 * radius, -edge + 0.72 * radius,
      -flat, flat, edge - 0.72 * radius, edge - 0.43 * radius, edge - 0.17 * radius, edge];
    const i = Math.min(8, Math.floor(t * 9));
    return lerp(stops[i], stops[i + 1], t * 9 - i);
  }
  for (let axis = 0; axis < 3; axis++) {
    const across = (axis + 1) % 3, upright = (axis + 2) % 3;
    for (const side of [-1, 1]) {
      mesh.surface(9, 9, (u, v) => {
        const p = [0, 0, 0];
        p[axis] = side * extent[axis];
        p[across] = coordinate(across, u);
        p[upright] = coordinate(upright, v);
        const q = p.map((value, i) => clamp(value, -inner[i], inner[i]));
        return add(center, add(q, scale(unit(sub(p, q)), radius)));
      }, material, side);
    }
  }
}

function cubic(points, t) {
  const a = (1 - t) ** 3;
  const b = 3 * t * (1 - t) ** 2;
  const c = 3 * t * t * (1 - t);
  const d = t ** 3;
  return points[0].map((x, i) => a * x + b * points[1][i] + c * points[2][i] + d * points[3][i]);
}

function duct(mesh, points, radius) {
  mesh.surface(14, 68, (u, v) => {
    const p = cubic(points, v);
    const direction = unit(sub(cubic(points, Math.min(1, v + 0.002)), cubic(points, Math.max(0, v - 0.002))));
    const tangent = unit(cross(direction, [0, 0, 1]));
    const around = u * TAU;
    const corrugation = radius + 0.0018 * Math.cos(TAU * 18 * v);
    const radial = add(scale(tangent, Math.cos(around)), scale(cross(direction, tangent), Math.sin(around)));
    return add(p, scale(radial, corrugation));
  }, M.hose);
}

function lifeSupport(mesh) {
  const start = mesh.vertices.length;
  enclosure(mesh, [0, 1.260, 0.262], [0.255, 0.293, 0.068], 0.041, M.seal);
  enclosure(mesh, [-0.005, 1.262, 0.344], [0.233, 0.273, 0.107], 0.039, M.ceramic);
  enclosure(mesh, [0, 1.303, 0.441], [0.204, 0.169, 0.021], 0.017, M.graphite);
  enclosure(mesh, [-0.054, 1.326, 0.461], [0.125, 0.125, 0.011], 0.010, M.ceramic);
  enclosure(mesh, [0.124, 1.327, 0.467], [0.037, 0.118, 0.012], 0.010, M.seal);
  for (let i = 0; i < 6; i++) {
    enclosure(mesh, [0.124, 1.250 + 0.029 * i, 0.477], [0.023, 0.0038, 0.0055], 0.0032, M.alloy);
  }
  enclosure(mesh, [-0.010, 1.087, 0.431], [0.186, 0.056, 0.042], 0.031, M.graphite);
  enclosure(mesh, [0.094, 1.098, 0.472], [0.034, 0.021, 0.0055], 0.0050, M.seal);
  enclosure(mesh, [0.097, 1.101, 0.478], [0.009, 0.0032, 0.0013], 0.0011, M.indicator);

  for (const side of [-1, 1]) {
    enclosure(mesh, [side * 0.220, 1.263, 0.364], [0.028, 0.193, 0.065], 0.019, M.graphite);
    for (const y of [1.103, 1.437]) {
      enclosure(mesh, [side * 0.206, y, 0.424], [0.023, 0.033, 0.027], 0.009, M.alloy);
    }
    enclosure(mesh, [side * 0.181, 1.501, 0.387], [0.032, 0.017, 0.021], 0.007, M.alloy);
  }
  fitEquipment(mesh, start, packFit);

  for (const side of [-1, 1]) {
    const shoulder = [fitted([side * 0.181, 1.480, 0.389], packFit), [side * 0.212, 1.530, 0.256],
      [side * 0.273, 1.704, 0.168], [side * 0.286, 1.636, 0.035]];
    mesh.surface(10, 26, (u, v) => {
      const p = cubic(shoulder, v);
      const cross = 2 * u - 1;
      const cushion = 0.007 * (1 - cross * cross) * Math.sin(Math.PI * v);
      return [p[0] + lerp(0.021, 0.026, v) * cross, p[1] + cushion, p[2] + cushion];
    }, M.harness);
  }
  const supply = fitted([-0.228, 1.466, 0.298], packFit);
  duct(mesh, [supply, [-0.333, 1.510, 0.267],
    [-0.299, 1.348, 0.170], [-0.249, 1.307, 0.157]], 0.016);
  mesh.ellipsoid(supply, [0.028, 0.024, 0.023], M.bronze, 18, 9, 0.65);
  duct(mesh, [fitted([0.214, 1.137, 0.351], packFit), [0.320, 1.147, 0.311],
    [0.311, 1.053, 0.191], [0.247, 1.025, 0.143]], 0.015);
  mesh.ellipsoid([0.247, 1.025, 0.143], [0.024, 0.023, 0.019], M.graphite, 18, 9, 0.63);
}

function neckGaiter(mesh) {
  mesh.surface(64, 20, (u, v) => {
    const angle = TAU * u, ribs = 0.0034 * Math.sin(4 * TAU * v) * Math.sin(Math.PI * v);
    const width = lerp(0.232, 0.156, v) + ribs;
    const depth = lerp(0.208, 0.143, v) + ribs;
    const rise = 0.024 * Math.abs(Math.cos(angle)) * (1 - v);
    return [width * Math.cos(angle), lerp(1.588, 1.683, v) + rise, lerp(0.017, 0.006, v) + depth * Math.sin(angle)];
  }, M.rubber, -1);
}

function helmetPoint(angle, latitude, lift = 0) {
  const t = Math.sin(latitude), crown = Math.cos(latitude);
  const jaw = 0.91 + 0.09 * Math.sqrt(Math.max(0, 1 + crown));
  const fore = Math.cos(angle);
  const depth = lerp(0.195, 0.244, 0.5 + 0.5 * fore) + lift;
  return [
    (0.223 + lift) * Math.sin(angle) * t * jaw,
    1.881 + (0.226 + lift) * crown - 0.019 * fore * t * t,
    0.014 - fore * depth * t * jaw,
  ];
}

function helmet(mesh) {
  const start = mesh.vertices.length;
  mesh.surface(88, 43, (u, v) => helmetPoint(TAU * u, lerp(0.001, 2.54, v)), M.helmet);
  for (const [material, width, extension, lift] of [
    [M.seal, 1.943, 0.078, 0.0045],
    [M.visor, 1.895, 0.0, 0.0078],
  ]) {
    mesh.surface(56, 25, (u, v) => {
      const side = 2 * u - 1;
      const curve = Math.pow(Math.abs(side), 2.7);
      return helmetPoint(side * width, lerp(0.76 + 0.220 * curve - extension, 2.26 - 0.436 * curve + extension, v), lift);
    }, material);
  }
  mesh.torus([0, 1.688, 0.019], 0.173, 0.021, M.seal, 'y', 66, 10, 1.06);
  mesh.torus([0, 1.713, 0.019], 0.179, 0.0105, M.alloy, 'y', 66, 9, 1.02);
  for (const side of [-1, 1]) {
    mesh.ellipsoid([0.208 * side, 1.819, 0.058], [0.026, 0.058, 0.056], M.graphite, 32, 18, 0.70);
    mesh.ellipsoid([0.232 * side, 1.825, 0.047], [0.009, 0.032, 0.031], M.alloy, 27, 14, 0.83);
    mesh.ellipsoid([0.239 * side, 1.824, 0.047], [0.004, 0.010, 0.010], M.seal, 16, 9);
  }
  enclosure(mesh, [-0.036, 1.765, 0.184], [0.067, 0.024, 0.023], 0.016, M.graphite);
  enclosure(mesh, [0.001, 1.769, 0.210], [0.016, 0.005, 0.0020], 0.0018, M.bronze);
  fitEquipment(mesh, start, helmetFit);
}

export function buildTraveler(body) {
  if (body.byteLength < 12) throw new Error('Incomplete pressure suit mesh');
  const header = new DataView(body);
  const signature = header.getUint32(0, true);
  const boundSleeves = signature === 0x32415645;
  const count = header.getUint32(4, true), indexCount = header.getUint32(8, true);
  const indexOffset = 12 + count * 36;
  const partOffset = indexOffset + indexCount * 2;
  if ((!boundSleeves && signature !== 0x31415645) || partOffset + (boundSleeves ? count : 0) !== body.byteLength ||
      count < 1 || indexCount < 3 || indexCount % 3 !== 0) {
    throw new Error('Invalid pressure suit mesh');
  }

  const equipment = new MeshBuilder();
  neckGaiter(equipment);
  const neckEnd = equipment.vertices.length / 9;
  helmet(equipment);
  const sealEnd = equipment.vertices.length / 9;
  lifeSupport(equipment);
  const extraCount = equipment.vertices.length / 9;
  if (count + extraCount > 65536) throw new Error('The pressure suit mesh exceeds the 16-bit index range');
  const vertices = new Float32Array(9 * (count + extraCount));
  const indices = new Uint16Array(indexCount + equipment.indices.length);
  const parts = new Int8Array(count + extraCount);
  vertices.set(new Float32Array(body, 12, count * 9));
  vertices.set(equipment.vertices, count * 9);
  indices.set(new Uint16Array(body, indexOffset, indexCount));
  for (let i = 0; i < equipment.indices.length; i++) indices[indexCount + i] = count + equipment.indices[i];
  if (boundSleeves) parts.set(new Int8Array(body, partOffset, count));
  parts.fill(2, count + neckEnd, count + sealEnd);
  parts.fill(3, count + sealEnd);
  return { vertices, indices, parts };
}

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, decoder, imageLibrary] = process.argv.slice(2);
if (!source || !decoder || !imageLibrary) {
  throw new Error('Usage: node design/prepare-eva.mjs NASA-Z2.glb path/to/draco3dgltf.js path/to/sharp');
}
const require = createRequire(import.meta.url);
const draco = require(resolve(decoder));
const sharp = require(resolve(imageLibrary));
const assetDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');
const sourceFile = await readFile(source);
const jsonSize = sourceFile.readUInt32LE(12);
const data = JSON.parse(sourceFile.toString('utf8', 20, 20 + jsonSize));
function view(id) {
  const region = data.bufferViews[id], offset = 28 + jsonSize + (region.byteOffset ?? 0);
  return sourceFile.subarray(offset, offset + region.byteLength);
}
const compressed = data.meshes[0].primitives[0].extensions.KHR_draco_mesh_compression;
const d = await draco.createDecoderModule();
const parse = new d.Decoder(), box = new d.DecoderBuffer(), mesh = new d.Mesh();
const bytes = view(compressed.bufferView);
box.Init(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength);
const status = parse.DecodeBufferToMesh(box, mesh);
assert.ok(status.ok(), status.error_msg());
function attribute(name) {
  const a = parse.GetAttributeByUniqueId(mesh, compressed.attributes[name]);
  const values = new d.DracoFloat32Array();
  parse.GetAttributeFloatForAllPoints(mesh, a, values);
  const result = Float32Array.from({ length: values.size() }, (_, i) => values.GetValue(i));
  d.destroy(values);
  return result;
}
const positions = attribute('POSITION'), normals = attribute('NORMAL'), uv = attribute('TEXCOORD_0');
const count = mesh.num_points();
const triangles = new Uint32Array(mesh.num_faces() * 3);
const face = new d.DracoInt32Array();
for (let i = 0; i < mesh.num_faces(); i++) {
  parse.GetFaceFromMesh(mesh, i, face);
  for (let j = 0; j < 3; j++) triangles[3 * i + j] = face.GetValue(j);
}
for (const buffer of [face, mesh, parse, box]) d.destroy(buffer);

function oriented(array, i) {
  return [-array[3 * i], -array[3 * i + 2], -array[3 * i + 1]];
}
const coordinates = Array.from({ length: count }, (_, i) => oriented(positions, i));
const aliases = new Map(), parent = Uint32Array.from({ length: count }, (_, i) => i);
function root(i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}
function join(a, b) {
  parent[root(a)] = root(b);
}
// Weld for classification only. Retain the authored UV and normal seams.
for (let i = 0; i < count; i++) {
  const key = coordinates[i].map(v => Math.round(v * 1e4)).join(',');
  if (aliases.has(key)) join(i, aliases.get(key));
  else aliases.set(key, i);
}
for (let i = 0; i < triangles.length; i += 3) {
  join(triangles[i], triangles[i + 1]);
  join(triangles[i], triangles[i + 2]);
}
const components = new Map();
for (let i = 0; i < count; i++) {
  const id = root(i);
  if (!components.has(id)) components.set(id, { count: 0, low: [1, 2, 1], high: [-1, 0, -1] });
  const item = components.get(id);
  item.count++;
  for (let axis = 0; axis < 3; axis++) {
    item.low[axis] = Math.min(item.low[axis], coordinates[i][axis]);
    item.high[axis] = Math.max(item.high[axis], coordinates[i][axis]);
  }
}
function prototypeHardware({ count, low, high }) {
  const helmet = low[1] > 1.55 && Math.max(-low[0], high[0]) < 0.229;
  return (count > 4000 && low[1] > 1.20 && high[1] > 1.85 && high[2] > 0.40 && low[2] > 0.025)
    || (low[1] > 1.20 && low[2] > 0.272) || helmet;
}
const removed = new Set([...components].filter(([, c]) => prototypeHardware(c)).map(([id]) => id));
const upperBody = [...components].find(([, c]) => c.count > 4000 && c.low[1] > 0.9 && c.high[1] > 1.83
  && c.low[2] < -0.24)?.[0];
assert.ok(removed.size && upperBody !== undefined, 'The source is expected to be the NASA Z2 prototype');
const gauntlets = new Set([...components].filter(([, { low, high }]) =>
  low[1] > 0.94 && high[1] < 1.41 && low[2] < -0.49 && (high[0] < -0.155 || low[0] > 0.155),
).map(([id]) => id));
assert.ok(gauntlets.size >= 2, 'The left and right gauntlets should be intact');
const lower = Math.min(...coordinates.map(v => v[1]));
const scale = 2.105 / (Math.max(...coordinates.map(v => v[1])) - lower);

const unit = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b, factor) => a.map((x, i) => x + factor * b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function smooth(a, b, x) {
  const f = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return f * f * (3 - 2 * f);
}
function standing([x, y, z]) {
  // Let the prototype's extended forearms rest more naturally by the ribs.
  const weight = smooth(0.22, 0.54, -z) * smooth(0.133, 0.255, Math.abs(x))
    * smooth(0.84, 0.99, y) * (1 - smooth(1.37, 1.54, y));
  const pitch = (-1.13 + (x < 0 ? 0.069 : -0.014)) * weight;
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const dy = y - 1.305, dz = z + 0.203;
  return [
    x * (1 - 0.047 * weight) * scale,
    (1.305 + dy * c - dz * s - lower) * scale,
    (-0.203 + dy * s + dz * c) * scale + 0.043,
  ];
}

function vertex(i) {
  const start = coordinates[i], p = standing(start), n = unit(oriented(normals, i));
  const u = unit(cross(n, Math.abs(n[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0]));
  const v = cross(n, u);
  const bend = unit(cross(sub(standing(add(start, u, 0.001)), p), sub(standing(add(start, v, 0.001)), p)));
  return [...p, ...bend, 13, uv[2 * i], uv[2 * i + 1]];
}
const prepared = coordinates.map((_, i) => removed.has(root(i)) ? null : vertex(i));
const vertices = [], indices = [], parts = [], names = new Int32Array(count).fill(-1);
function append(values, sleeve = 0) {
  const i = vertices.length / 9;
  vertices.push(...values);
  parts.push(sleeve);
  return i;
}
function original(i) {
  if (names[i] < 0) {
    const sleeve = gauntlets.has(root(i)) ? Math.sign(prepared[i][0]) : 0;
    names[i] = append(prepared[i], sleeve);
  }
  return names[i];
}
function aboveCollar(i) {
  const [x, y] = prepared[i];
  return y - (1.616 + 0.134 * smooth(0.128, 0.33, Math.abs(x)));
}
const cuts = new Map();
function intersection(a, b, heightA, heightB) {
  const key = a < b ? a * count + b : b * count + a;
  if (!cuts.has(key)) {
    const t = heightA / (heightA - heightB);
    const edge = prepared[a].map((value, c) => value + (prepared[b][c] - value) * t);
    cuts.set(key, append(edge));
  }
  return cuts.get(key);
}
for (let i = 0; i < triangles.length; i += 3) {
  const first = triangles[i];
  if (removed.has(root(first))) continue;
  const face = [first, triangles[i + 1], triangles[i + 2]];
  if (root(first) !== upperBody) {
    indices.push(...face.map(original));
    continue;
  }
  // Trim the integral hood at the new collar. Keep the unbroken shoulders.
  const edge = [];
  const heights = face.map(aboveCollar);
  for (let k = 0; k < 3; k++) {
    const next = (k + 1) % 3;
    if (heights[k] <= 0) edge.push(original(face[k]));
    if ((heights[k] > 0) !== (heights[next] > 0)) {
      edge.push(intersection(face[k], face[next], heights[k], heights[next]));
    }
  }
  for (let k = 1; k + 1 < edge.length; k++) indices.push(edge[0], edge[k], edge[k + 1]);
}
assert.ok(vertices.length / 9 < 65536);
const header = new Uint32Array([0x32415645, vertices.length / 9, indices.length]);
const binary = Buffer.concat([Buffer.from(header.buffer), Buffer.from(new Float32Array(vertices).buffer),
  Buffer.from(new Uint16Array(indices).buffer), Buffer.from(new Int8Array(parts).buffer)]);
await writeFile(resolve(assetDirectory, 'eva-body.bin'), binary);

for (const [suffix, resolution, value, name] of [
  ['Color_s', 1280, [196, 190, 177], 'eva-fabric.webp'],
  ['Bump_s', 1024, [128, 128, 128], 'eva-weave.webp'],
]) {
  const image = data.images.find(image => image.name.endsWith(suffix));
  const { data: pixels, info } = await sharp(view(image.bufferView)).resize(resolution)
    .toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Strip the prototype decals and markings from their strip in the atlas.
  for (let y = Math.round(info.height * 0.633); y < Math.round(info.height * 0.955); y++) {
    for (let x = 0; x < Math.round(info.width * 0.118); x++) {
      pixels.set(value, (y * info.width + x) * info.channels);
    }
  }
  await sharp(pixels, { raw: info }).webp({ quality: 90 }).toFile(resolve(assetDirectory, name));
}
console.log('Prepared', vertices.length / 9, 'vertices and', indices.length / 3, 'triangles');

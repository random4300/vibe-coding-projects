import { clamp, lerp, randomFrom, TAU } from './math.js';
import { MeshBuilder } from './mesh.js';
import { travelerPosition } from './traveler.js';

// Two lifted standards, two spreading wings and the broad, veined landing petal.
const petalShape = [
  { angle: -2.13, length: 0.284, width: 0.161, rise: 0.159, sweep: -0.026 },
  { angle: -0.95, length: 0.307, width: 0.158, rise: 0.185, sweep: 0.024 },
  { angle: 0.22, length: 0.284, width: 0.152, rise: 0.065, sweep: -0.032 },
  { angle: 2.89, length: 0.267, width: 0.150, rise: 0.087, sweep: 0.025 },
  { angle: 1.53, length: 0.340, width: 0.183, rise: -0.032, sweep: 0.017 },
];

function petalSurface(petal, index) {
  const c = Math.cos(petal.angle);
  const s = Math.sin(petal.angle);
  return (u, v) => {
    const t = (1 - Math.cos(Math.PI * u)) * 0.5;
    const belly = Math.sin(Math.PI * u);
    const side = 2 * v - 1;
    const fan = Math.max(0, belly) ** 0.88 * (0.48 + 0.96 * t);
    const scallop = Math.sin(11 * side + index * 0.89 + 3.1 * u);
    const crest = Math.sin(Math.PI * t);
    const r = 0.006 + petal.length * t + 0.011 * scallop * fan * t;
    const across = side * petal.width * fan + petal.sweep * t * t;
    const folds = 0.013 * Math.cos(8.1 * side + 1.37 * index + 2.2 * t) + 0.011 * side;
    const y = 0.985 + 0.006 * index + petal.rise * t + 0.062 * crest
      + fan * (folds + 0.036 * side * side - 0.022 * side) - 0.033 * t ** 3;
    return [c * r - s * across, y, s * r + c * across];
  };
}

function leaf(mesh, angle, height, length, width, steps, material) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  mesh.surface(steps, steps > 3 ? 4 : 2, (t, v) => {
    const side = 2 * v - 1;
    const curve = Math.sin(Math.PI * t);
    const across = width * side * Math.sin(Math.PI * t ** 0.81)
      * (1 + 0.08 * Math.sin(t * 32.0));
    const r = length * t - 0.027 + 0.018 * curve * side;
    return [c * r - s * across, height + 0.19 * curve + 0.06 * t - Math.abs(across) * 0.57, s * r + c * across];
  }, material, -1);
}

const throat = [0.498, 0.493];

// Measure the five-lobed silhouette from the four local texture variants.
// The geometry reaches the outermost contour; the selected flower's alpha
// trims the last few texels. Both sides have real curvature at grazing angles.
export function blossomOutline(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
  const tileSize = image.width / 2;
  return Array.from({ length: 80 }, (_, index) => {
    const angle = index * TAU / 80;
    for (let r = 0.55; r > 0.1; r -= 1 / tileSize) {
      const x = Math.floor((throat[0] + r * Math.cos(angle)) * tileSize);
      const y = Math.floor((throat[1] + r * Math.sin(angle)) * tileSize);
      if (x < 0 || x >= tileSize || y < 0 || y >= tileSize) continue;
      for (let tile = 0; tile < 4; tile++) {
        const pixel = (y + (tile >> 1) * tileSize) * image.width + x + (tile & 1) * tileSize;
        if (rgba[4 * pixel + 3] > 110) return r + 0.008;
      }
    }
    return 0.29;
  });
}

function openCorolla(mesh, outline, sides, rings) {
  const start = mesh.vertices.length;
  mesh.surface(sides, rings, (u, r) => {
    const angle = TAU * u;
    const step = u * outline.length;
    const k = Math.floor(step) % outline.length;
    const rim = lerp(outline[k], outline[(k + 1) % outline.length], step % 1);
    const lobe = Math.cos(5 * (angle - Math.PI / 2) + 0.31 * Math.sin(2 * angle));
    const belly = Math.sin(Math.PI * r);
    const x = Math.cos(angle) * rim * r;
    const z = Math.sin(angle) * rim * r;
    const fold = 0.065 * lobe + 0.012 * Math.sin(angle * 12 + r * 2.7);
    const y = 0.988 + r * r * (0.060 - 0.075 * Math.sin(angle) + 0.022 * lobe) + belly * (0.052 + fold);
    return [x * 0.74, y, z * 0.74];
  }, 5);
  for (let i = start; i < mesh.vertices.length; i += 9) {
    mesh.vertices[i + 6] += 0.4 * mesh.vertices[i + 8];
    mesh.vertices[i + 7] = throat[0] + mesh.vertices[i] / 0.74;
    mesh.vertices[i + 8] = throat[1] + mesh.vertices[i + 2] / 0.74;
  }
}

export function shadowCorolla(outline) {
  const mesh = new MeshBuilder();
  if (outline) openCorolla(mesh, outline, 16, 2);
  else petalShape.forEach((petal, i) => mesh.surface(3, 1, petalSurface(petal, i), i * 0.092, -1));
  return mesh.finish();
}

// Meadow grasses grow through some of the violet clumps. Their translucent
// seed husks catch grazing light on a longer, finer shape than a petal.
function grassMesh(distant = false) {
  const mesh = new MeshBuilder();
  const stem = t => [0.13 * t * t - 0.057 * t, t, 0.078 * t * t];
  mesh.tube(stem(0.18), stem(0.75), 0.009, 0.007, 3.8, 4, 1);
  mesh.tube(stem(0.75), stem(1.075), 0.007, 0.003, 3.8, 4, 1);
  for (let k = 0; k < 5; k++) {
    const angle = 0.78 + k * 2.47;
    const start = stem(0.87 + k * 0.049);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const reach = 0.057 - 0.005 * k;
    const rise = 0.065 + 0.013 * Math.sin(angle);
    mesh.surface(distant ? 3 : 4, distant ? 3 : 4, (u, v) => {
      const r = 0.015 * Math.sin(Math.PI * u);
      const side = r * Math.cos(v * TAU);
      const ridge = r * 0.48 * Math.sin(v * TAU);
      return [start[0] + c * reach * u - s * side, start[1] + rise * u + ridge,
        start[2] + s * reach * u + c * side];
    }, 4 + k * 0.06);
    if (!distant) {
      const tip = [start[0] + c * reach, start[1] + rise, start[2] + s * reach];
      mesh.tube(tip, [tip[0] + c * 0.043, tip[1] + 0.054, tip[2] + s * 0.043], 0.0027, 0.0007, 4.5, 3, 1);
    }
  }
  return mesh.finish();
}

function flowerMesh(detail, outline) {
  const mesh = new MeshBuilder();
  if (detail === 4) {
    // Shade between the crowns reveals small pointed leaves at different heights.
    leaf(mesh, 0.52, 0.51, 0.42, 0.145, 3, 3);
    leaf(mesh, 2.74, 0.68, 0.38, 0.127, 3, 3);
    leaf(mesh, 4.67, 0.85, 0.32, 0.122, 3, 3);
    return mesh.finish();
  }
  if (outline) openCorolla(mesh, outline, [40, 29, 19, 14][detail], [5, 4, 3, 2][detail]);
  else {
    petalShape.forEach((petal, i) => {
      mesh.surface([8, 5, 3, 3][detail], [6, 4, 3, 2][detail], petalSurface(petal, i), i * 0.092, -1);
    });
    mesh.ellipsoid([0.002, 1.019, 0.018], [0.025, 0.013, 0.032], 1, detail < 2 ? 7 : 5, 3);
  }

  if (detail < 2) {
    mesh.ellipsoid([0, 0.978, -0.052], [0.045, 0.040, 0.097], 2, 7, 3);
    mesh.tube([0, -0.012, 0], [-0.067, 0.47, 0.032], 0.012, 0.010, 2, 5, 1);
    mesh.tube([-0.067, 0.47, 0.032], [-0.039, 0.83, -0.025], 0.010, 0.009, 2, 5, 1);
    mesh.tube([-0.039, 0.83, -0.025], [0, 0.986, -0.021], 0.009, 0.016, 2, 5, 1);
    leaf(mesh, 1.26, 0.22, 0.35, 0.120, detail === 0 ? 5 : 3, 3);
    leaf(mesh, 3.53, 0.43, 0.29, 0.106, detail === 0 ? 5 : 3, 3);
  }
  return mesh.finish();
}

// At distance, larger and simpler instances represent small stands, with
// gaps filled by the procedural ground canopy. Overlap hides the tier changes.
const bands = [
  { min: 0, max: 17, pitch: 0.111, cell: 3.7, detail: 0, scale: 1 },
  { min: 15, max: 35, pitch: 0.137, cell: 7.1, detail: 1, scale: 1.05 },
  { min: 31, max: 74, pitch: 0.218, cell: 14, detail: 2, scale: 1.26 },
  { min: 67, max: 143, pitch: 0.47, cell: 26, detail: 3, scale: 1.81 },
  { min: 131, max: 265, pitch: 1.08, cell: 49, detail: 3, scale: 2.62 },
];

const smooth = x => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

const bell = x => Math.exp(-x * x);

function groundHeight(x, z) {
  const depth = -z;
  if (depth < 2 || depth > 125 || Math.abs(x) > 91) return 0;
  const edge = smooth((depth - 2) / 6) * smooth((125 - depth) / 32) * smooth((91 - Math.abs(x)) / 25);
  const stance = 1 - bell((x - travelerPosition[0]) / 2.75) * bell((z - travelerPosition[2]) / 3.14);
  const nearShoulder = bell((depth - 11.9 - 1.8 * Math.cos(x * 0.24 + 0.6) - 0.24 * x) / 4.8);
  const middleBank = bell((depth - 31.3 + 3.7 * Math.sin(x * 0.112) - 0.32 * x) / 6.6);
  const farBank = bell((depth - 70.0 - 5.2 * Math.sin(x * 0.073 + 1.6) + 0.24 * x) / 12.4);
  const undulation = 0.10 + 0.085 * Math.cos(x * 0.225 + z * 0.25) + 0.05 * Math.sin(z * 0.31 - x * 0.19);
  return edge * stance * (Math.max(0.01, undulation)
    + 0.34 * nearShoulder + (0.42 + 0.19 * Math.sin(x * 0.109 + 1.1)) * middleBank + 0.76 * farBank);
}

export function buildMeadowGround() {
  const mesh = new MeshBuilder();
  mesh.surface(140, 112, (u, v) => {
    const x = lerp(-94, 94, u);
    const z = lerp(2, -128, v);
    return [x, groundHeight(x, z), z];
  }, 0);
  return mesh.finish();
}

export function buildMeadow(economy, outline) {
  const folded = [0, 1, 2, 3].map(detail => flowerMesh(detail));
  const open = [0, 1, 2, 3].map(detail => flowerMesh(detail, outline));
  const leaves = flowerMesh(4);
  const random = randomFrom(89232130);
  const groundRandom = randomFrom(44927801);
  const grassRandom = randomFrom(9438113);
  const grass = grassMesh();
  const distantGrass = grassMesh(true);
  return bands.flatMap((band, index) => {
    const spacing = band.pitch * (economy ? 1.22 : 1);
    const step = Math.round(band.cell / spacing);
    const actualPitch = band.cell / step;
    const limit = Math.ceil(band.max / band.cell);
    const halfWidth = band.cell * 0.5 + 1.2;
    const detail = economy && band.detail < 2 ? band.detail + 1 : band.detail;
    const batch = (mesh, shadow) => ({ mesh, shadow, data: [], cells: [], halfWidth });
    const openBlooms = batch(open[detail], index < 3 ? 'open' : null);
    const foldedBlooms = batch(folded[detail], index < 3 ? 'folded' : null);
    const understory = batch(leaves);
    const grasses = batch(index > 1 || economy ? distantGrass : grass);
    const batches = [openBlooms, foldedBlooms, understory, grasses];
    for (let row = -limit; row <= Math.ceil(9 / band.cell); row++) {
      for (let col = -limit; col <= limit; col++) {
        const cx = (col + 0.5) * band.cell;
        const cz = (row + 0.5) * band.cell - 2.8;
        const radius = band.cell * 0.714 + 1.0;
        const center = Math.hypot(cx, cz + 2.8);
        if (center - radius > band.max || center + radius < band.min || cz - radius > 10) continue;
        for (const group of batches) group.first = group.data.length / 8;
        // Two passes allow density changes without reallocating GPU buffers.
        for (let pass = 0; pass < 2; pass++) {
          for (let j = 0; j < step; j++) {
            for (let i = 0; i < step; i++) {
              const gx = (col * step + i + random()) * actualPitch;
              const gz = (row * step + j + random()) * actualPitch - 2.8;
              const x = gx + 0.061 * Math.sin(3.72 * gx + 1.36 * gz) + 0.039 * Math.sin(7.12 * gz - gx);
              const z = gz + 0.076 * Math.sin(3.25 * gz - 1.73 * gx) + 0.035 * Math.cos(6.57 * gx + gz);
              const distance = Math.hypot(x, z + 2.8);
              if (distance < band.min || distance > band.max || z > 10) continue;
              if (band.detail > 0 && Math.abs(x) > -z * 1.75 + 21) continue;
              const inFade = index ? smooth((distance - band.min) / (bands[index - 1].max - band.min)) : 1;
              const outFade = index + 1 < bands.length
                ? smooth((band.max - distance) / (band.max - bands[index + 1].min))
                : smooth((band.max - distance) / 42);
              const drift = Math.sin(0.19 * x + 0.146 * z) * Math.cos(0.137 * x - 0.124 * z);
              const patches = Math.sin(0.57 * x - 0.42 * z + 1.54 * drift) * Math.cos(0.198 * z + x * 0.17);
              const run = Math.sin(0.21 * x + 0.35 * z + 1.25 * Math.sin(0.123 * x - 0.089 * z));
              const clusters = 0.54 * Math.sin(x * 2.14 + z * 1.53 + 2.43 * patches)
                + 0.31 * Math.cos(x * 3.12 - z * 2.07 + 1.62 * drift)
                + 0.15 * Math.cos(x * 5.67 + z * 3.28);
              const tx = x - travelerPosition[0];
              const tz = z - travelerPosition[2];
              const stance = Math.exp(-((tx / 0.37) ** 2) - (tz / 0.47) ** 2);
              const tussock = smooth((clusters + 0.72) / 1.43);
              const density = (0.51 + 0.50 * tussock + 0.12 * patches) * (0.96 + 0.14 * run) * (1 - 0.71 * stance);
              if (random() > inFade * outFade * density * (pass === 0 ? 0.82 : 0.18)) continue;
              const hollow = Math.exp(-((tx / 2.4 - 0.26 * clusters) ** 2) - ((tz - 0.85) / 2.7) ** 2);
              const size = lerp(0.29, 0.675, Math.pow(random(), 1.35))
                * (0.76 + 0.44 * tussock + 0.13 * patches + 0.10 * run + 0.30 * hollow - 0.32 * stance);
              const foreground = bell((z + 9.1) / 3.1)
                * (0.74 * bell((x + 3.9) / 1.6) + 0.61 * bell((x - 4.8) / 2.0));
              const bloomWidth = (0.88 - 0.20 * hollow + 0.17 * foreground) * lerp(0.43, 0.78, random());
              const spread = bloomWidth * (0.54 / size) ** 0.45 * band.scale * (economy ? 1.10 : 1);
              // The canopy overlaps the cuffs in uneven drifts. Taller stems
              // keep the same flower diameter as neighbouring stems.
              const fringe = Math.exp(-(((tx + 0.15 * clusters) / 1.08) ** 2)
                - (((tz - 0.64 - 0.19 * patches) / 0.88) ** 2));
              const stemHeight = size + 0.28 * foreground * (0.41 + 0.59 * tussock)
                + 0.17 * fringe * (0.69 + 0.48 * tussock) * (1 - 0.80 * stance);
              const shade = clamp(0.34 + 0.36 * random() + 0.19 * drift + 0.22 * patches + 0.15 * clusters + 0.15 * run, 0, 1);
              const seed = random();
              const yaw = (random() - 0.5) * (4.0 + 1.8 * tussock) + 1.9 * patches + 0.77 * clusters + 0.75;
              const floor = groundHeight(x, z);
              const offset = floor + 0.019 * (Math.sin(x * 0.63 + z * 0.38) + Math.cos(x * 0.24 - z * 0.46));
              const bloom = ((seed * 31.43) % 1) < 0.75 + 0.10 * patches ? openBlooms : foldedBlooms;
              bloom.data.push(x, z, stemHeight, yaw, spread * size / stemHeight, shade, seed, offset);
              // A few fine stems stand just in front of the sleeves. Small
              // separated heads let the dark cloth show between them.
              if (fringe > 0.16 && (seed * 37.81) % 1 < 0.48 * fringe * (1 - stance)) {
                const phase = TAU * ((seed * 73.23) % 1);
                const tip = 0.73 + 0.26 * ((seed * 61.47) % 1) + 0.09 * tussock + 0.075 * fringe;
                const radius = 0.053 + 0.049 * ((seed * 47.13) % 1);
                const width = (0.183 + 0.073 * ((seed * 13.91) % 1)) / tip;
                openBlooms.data.push(x + radius * Math.cos(phase), z + radius * Math.sin(phase),
                  tip, yaw + phase, width, 0.84 * shade + 0.042, (seed * 43.61) % 1, offset);
              }

              if (index < 4 && grassRandom() < 0.18 + 0.10 * patches && stance < 0.66) {
                const height = stemHeight * lerp(0.91, 1.13, grassRandom());
                grasses.data.push(x + 0.056, z - 0.038, height, grassRandom() * TAU,
                  band.scale * lerp(0.70, 1.17, grassRandom()), shade, grassRandom(), offset);
              }
              if (index > 2 || stance > 0.65) continue;
              // Low leaf rosettes fill the shade between the taller clusters.
              const count = economy || groundRandom() > 0.66 ? 1 : 2;
              for (let lower = 0; lower < count; lower++) {
                const angle = groundRandom() * TAU + lower * 2.39;
                const radius = lerp(0.09, 0.35, groundRandom()) * band.scale;
                const height = lerp(0.17, Math.min(0.40, size * 0.79), groundRandom());
                const width = lerp(0.91, 1.31, groundRandom()) * band.scale * (economy ? 1.08 : 1);
                const violet = clamp(shade * 0.65 + 0.24 * groundRandom(), 0, 1);
                understory.data.push(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, height,
                  angle + groundRandom() * TAU, width, violet, groundRandom(), offset);
              }
            }
          }
          if (pass === 0) {
            for (const group of batches) group.core = group.data.length / 8 - group.first;
          }
        }
        for (const { data, first, core, cells } of batches) {
          const total = data.length / 8 - first;
          if (total) cells.push({ cx, cz, first, core, total });
        }
      }
    }
    return batches.filter(group => group.cells.length).map(({ data, cells, mesh, shadow }) => ({
      mesh, cells, shadow, halfWidth, cutout: mesh === openBlooms.mesh, data: new Float32Array(data),
    }));
  });
}

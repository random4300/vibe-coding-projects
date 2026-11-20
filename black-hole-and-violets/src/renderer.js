import { add, cross, dot, lerp, randomFrom, scale, sub, unit } from './math.js';
import { generateGeodesics } from './geodesics.js';
import { blossomOutline, buildMeadow, buildMeadowGround, shadowCorolla } from './meadow.js';
import { buildTraveler, poseTraveler, travelerPosition } from './traveler.js';
import * as shader from './shaders.js';

function makeProgram(gl, vertex, fragment, label) {
  function compile(type, source) {
    const stage = gl.createShader(type);
    gl.shaderSource(stage, source);
    gl.compileShader(stage);
    if (!gl.getShaderParameter(stage, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(stage);
      gl.deleteShader(stage);
      throw new Error(`${label}: ${log}`);
    }
    return stage;
  }
  const program = gl.createProgram();
  const vert = compile(gl.VERTEX_SHADER, vertex);
  const frag = compile(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`${label}: ${log}`);
  }
  const uniform = {};
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniform[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniform };
}

function texture(gl, width, height, internal, format, type, data, { repeat = false, linear = true } = {}) {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return handle;
}

function target(gl, width, height, hdr, withDepth = false, srgb = withDepth) {
  const buffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
  // Keep more of the eight-bit scene buffer's precision in the shadows.
  // Bloom uses linear bytes because it only stores the brighter light.
  const format = hdr ? gl.RGBA16F : (srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8);
  const color = texture(gl, width, height, format, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  let depth = null;
  if (withDepth) {
    depth = texture(gl, width, height, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null, { linear: false });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteTexture(color);
    if (depth) gl.deleteTexture(depth);
    gl.deleteFramebuffer(buffer);
    throw new Error('WebGL framebuffer is incomplete');
  }
  return { buffer, color, depth, width, height };
}

function multisampleTarget(gl, width, height, format) {
  const formats = [format, gl.DEPTH_COMPONENT24];
  const counts = formats.map(f => gl.getInternalformatParameter(gl.RENDERBUFFER, f, gl.SAMPLES));
  const samples = [2, 4].find(n => counts.every(supported => supported?.includes(n)));
  if (!samples) return null;
  const buffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
  const buffers = formats.map((f, i) => {
    const handle = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, handle);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, f, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, i ? gl.DEPTH_ATTACHMENT : gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, handle);
    return handle;
  });
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) return { buffer, buffers, width, height };
  buffers.forEach(handle => gl.deleteRenderbuffer(handle));
  gl.deleteFramebuffer(buffer);
  return null;
}

// The inner disk and the broad bank of illuminated atmosphere to its right.
const easternDisk = [0.142, 0.144, -1.0];
const grazingHorizon = [0.945, 0.335, -0.182];

function shadowMap(gl, width, height, center, halfExtent, light) {
  const buffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
  const depth = texture(gl, width, height, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('The shadow framebuffer is incomplete');
  }

  const direction = unit(light);
  const forward = scale(direction, -1);
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const basis = [right, up, forward].map((axis, i) => scale(axis, 1 / halfExtent[i]));
  const clip = new Float32Array(16);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) clip[column * 4 + row] = basis[row][column];
    clip[12 + row] = -dot(basis[row], center);
  }
  clip[15] = 1;
  return { buffer, depth, clip, direction, width, height };
}

function cellsInShadow(layer, clip) {
  return layer.cells.filter(({ cx, cz }) => {
    for (let i = 0; i < 3; i++) {
      const middle = clip[i] * cx + clip[4 + i] * 1.05 + clip[8 + i] * cz + clip[12 + i];
      const extent = layer.halfWidth * (Math.abs(clip[i]) + Math.abs(clip[8 + i])) + 1.17 * Math.abs(clip[4 + i]);
      if (Math.abs(middle) > 1 + extent) return false;
    }
    return true;
  });
}

function upload(gl, kind, array) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(kind, buffer);
  gl.bufferData(kind, array, gl.STATIC_DRAW);
  return buffer;
}

function attribute(gl, index, components, stride, offset, divisor = 0) {
  gl.enableVertexAttribArray(index);
  gl.vertexAttribPointer(index, components, gl.FLOAT, false, stride, offset);
  gl.vertexAttribDivisor(index, divisor);
}

function model(gl, mesh) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  upload(gl, gl.ARRAY_BUFFER, mesh.vertices);
  upload(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
  attribute(gl, 0, 3, 36, 0);
  attribute(gl, 1, 3, 36, 12);
  attribute(gl, 2, 3, 36, 24);
  if (mesh.parts) {
    upload(gl, gl.ARRAY_BUFFER, mesh.parts);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.BYTE, false, 0, 0);
  }
  return { vao, count: mesh.indices.length };
}

function noiseTexture(gl) {
  const random = randomFrom(141215);
  const size = 256;
  const field = new Float32Array(size * size);
  const frequencies = [7, 19, 43, 103, 256];
  const amplitudes = [0.27, 0.25, 0.21, 0.15, 0.12];
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    const values = Float32Array.from({ length: f * f }, random);
    for (let py = 0; py < size; py++) {
      const y = py / size * f;
      const row = Math.floor(y) * f;
      const next = (Math.floor(y) + 1) % f * f;
      const ty = (y % 1) ** 2 * (3 - 2 * (y % 1));
      for (let px = 0; px < size; px++) {
        const x = px / size * f;
        const col = Math.floor(x);
        const after = (col + 1) % f;
        const tx = (x % 1) ** 2 * (3 - 2 * (x % 1));
        field[py * size + px] += amplitudes[i] * lerp(
          lerp(values[row + col], values[row + after], tx),
          lerp(values[next + col], values[next + after], tx), ty,
        );
      }
    }
  }
  return texture(gl, size, size, gl.R8, gl.RED, gl.UNSIGNED_BYTE,
    Uint8Array.from(field, v => Math.max(0, Math.min(255, Math.round(127.5 + (v - 0.5) * 342)))), { repeat: true });
}

function imageTexture(gl, image, density = false) {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texImage2D(gl.TEXTURE_2D, 0, density ? gl.RGBA8 : gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 5);
  gl.generateMipmap(gl.TEXTURE_2D);
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  if (anisotropy) {
    const max = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max));
  }
  return handle;
}

function pollenModel(gl, mobile) {
  const count = mobile ? 93 : 159;
  const data = new Float32Array(count * 5);
  const random = randomFrom(11102400);
  for (let i = 0; i < count; i++) {
    const z = -lerp(2.1, 54, random() ** 1.45);
    const x = (random() - 0.5) * (15 - z * 1.7);
    const y = lerp(0.55, 2.98, random() ** 2.15);
    data.set([x, y, z, random(), lerp(0.006, 0.025, random() ** 1.2)], i * 5);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  upload(gl, gl.ARRAY_BUFFER, data);
  attribute(gl, 0, 4, 20, 0);
  attribute(gl, 1, 1, 20, 16);
  return { vao, count };
}

export class HorizonRenderer {
  constructor(canvas, economy, assets) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL 2 is unavailable');
    this.gl = gl;
    this.canvas = canvas;
    this.hdr = Boolean(gl.getExtension('EXT_color_buffer_float'));
    this.multisample = !economy;
    this.store = this.hdr ? 1 : 0.27;
    this.limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.programs = {
      sky: makeProgram(gl, shader.screenVertex, shader.skyFragment, 'Sky'),
      environment: makeProgram(gl, shader.screenVertex, shader.environmentFragment, 'Traveler environment'),
      irradiance: makeProgram(gl, shader.screenVertex, shader.irradianceFragment, 'Horizon illumination'),
      ground: makeProgram(gl, shader.groundVertex, shader.groundFragment, 'Meadow ground'),
      plants: makeProgram(gl, shader.plantVertex, shader.plantFragment, 'Meadow'),
      flowerRadiance: makeProgram(gl, shader.plantVertex, shader.flowerRadianceFragment, 'Light returned by the meadow'),
      traveler: makeProgram(gl, shader.suitVertex, shader.suitFragment, 'Traveler'),
      shadow: makeProgram(gl, shader.suitVertex, shader.shadowFragment, 'Traveler shadow'),
      canopy: makeProgram(gl, shader.plantVertex, shader.shadowFragment, 'Meadow shadows'),
      pollen: makeProgram(gl, shader.pollenVertex, shader.pollenFragment, 'Pollen'),
      prefilter: makeProgram(gl, shader.screenVertex, shader.lensPrefilterFragment, 'Lens prefilter'),
      foreground: makeProgram(gl, shader.screenVertex, shader.foregroundLensFragment(economy), 'Foreground aperture'),
      lens: makeProgram(gl, shader.screenVertex, shader.lensFragment(economy), 'Lens'),
      diffusion: makeProgram(gl, shader.screenVertex, shader.lensDiffusionFragment, 'Lens diffusion'),
      bloom: makeProgram(gl, shader.screenVertex, shader.bloomFragment, 'Bloom'),
      finish: makeProgram(gl, shader.screenVertex, shader.finishFragment, 'Grade'),
    };
    this.screen = gl.createVertexArray();
    this.noise = noiseTexture(gl);
    this.petals = imageTexture(gl, assets.petals);
    this.blossoms = imageTexture(gl, assets.blossoms);
    this.dust = imageTexture(gl, assets.dust, true);
    this.suitPigment = imageTexture(gl, assets.pigment);
    this.suitWeave = imageTexture(gl, assets.weave, true);
    const lookup = generateGeodesics();
    this.geodesic = texture(gl, lookup.columns, lookup.rows, gl.R16F, gl.RED, gl.FLOAT, lookup.table);
    this.lookup = [lookup.columns, lookup.rows, lookup.maximumAngle, lookup.end];
    // Encode six scene-linear units into an sRGB panorama, including on
    // devices with byte-only framebuffers. Longitude wraps at the back.
    this.environment = target(gl, economy ? 192 : 384, economy ? 96 : 192, false, false, true);
    gl.bindTexture(gl.TEXTURE_2D, this.environment.color);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.irradiance = target(gl, 4, 1, false, false, true);
    this.environmentTime = -1;
    this.traveler = model(gl, buildTraveler(assets.body));
    this.pose = new Float32Array(12);
    this.arms = new Float32Array(6 * 16);
    this.ground = model(gl, buildMeadowGround());
    const shadowSize = economy ? 512 : 1024;
    const casterCenter = add(travelerPosition, [0, 1.01, 0]);
    this.shadow = shadowMap(gl, shadowSize, shadowSize, casterCenter, [2.4, 2.20, 15.5], easternDisk);
    this.sideShadow = shadowMap(gl, economy ? 384 : 640, economy ? 384 : 640,
      casterCenter, [2.30, 2.10, 15.5], grazingHorizon);
    this.canopy = shadowMap(gl, economy ? 640 : 1536, economy ? 320 : 768, [0.6, 0.53, -19.3], [17.6, 4.72, 29], easternDisk);
    const outline = blossomOutline(assets.blossoms);
    const shadowModels = { folded: model(gl, shadowCorolla()), open: model(gl, shadowCorolla(outline)) };
    this.meadow = buildMeadow(economy, outline).map(({ mesh, data, cells, halfWidth, shadow, cutout }) => ({
      ...model(gl, mesh),
      instances: upload(gl, gl.ARRAY_BUFFER, data),
      cells,
      halfWidth,
      cutout,
      shadow: shadowModels[shadow],
    }));
    this.flowerSpan = 7.6;
    const axis = 2 / this.flowerSpan;
    this.flowerClip = new Float32Array([
      axis, 0, 0, 0,  0, 0, -0.55, 0,  0, axis, 0, 0,
      -travelerPosition[0] * axis, -travelerPosition[2] * axis, 0, 1,
    ]);
    const flowerSize = economy ? 64 : 128;
    this.flowerRadiance = target(gl, flowerSize, flowerSize, false, true, true);
    gl.bindTexture(gl.TEXTURE_2D, this.flowerRadiance.color);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.flowerTick = -1;
    const corollasIn = clip => this.meadow.filter(layer => layer.shadow).map(layer => ({
      mesh: layer.shadow, instances: layer.instances, cells: cellsInShadow(layer, clip),
    }));
    this.canopyLayers = corollasIn(this.canopy.clip);
    this.bounceLayers = corollasIn(this.flowerClip);
    this.pollen = pollenModel(gl, economy);
    this.bloom = [];
    this.frame = null;
    this.lens = null;
    this.lensPrefilter = null;
    this.foreground = null;
    this.samples = null;
    gl.bindVertexArray(null);
  }

  resize(width, height) {
    if (this.frame?.width === width && this.frame?.height === height) return;
    const gl = this.gl;
    if (this.samples) {
      this.samples.buffers.forEach(handle => gl.deleteRenderbuffer(handle));
      gl.deleteFramebuffer(this.samples.buffer);
    }
    for (const rt of [this.frame, this.lens, this.lensPrefilter, this.foreground, ...this.bloom.flat()]) {
      if (!rt) continue;
      gl.deleteTexture(rt.color);
      if (rt.depth) gl.deleteTexture(rt.depth);
      gl.deleteFramebuffer(rt.buffer);
    }
    this.canvas.width = width;
    this.canvas.height = height;
    try {
      this.frame = target(gl, width, height, this.hdr, true);
    } catch (err) {
      if (!this.hdr || gl.isContextLost()) throw err;
      this.hdr = false;
      this.store = 0.27;
      this.frame = target(gl, width, height, false, true);
    }
    this.samples = this.multisample ? multisampleTarget(gl, width, height, this.hdr ? gl.RGBA16F : gl.SRGB8_ALPHA8) : null;
    this.lens = target(gl, width, height, this.hdr, false, true);
    this.lensPrefilter = target(gl, Math.max(2, width >> 1), Math.max(2, height >> 1), this.hdr, false, true);
    this.foreground = target(gl, this.lensPrefilter.width, this.lensPrefilter.height, this.hdr, false, true);
    this.bloom = Array.from({ length: 4 }, (_, i) => {
      const w = Math.max(2, width >> (i + 1));
      const h = Math.max(2, height >> (i + 1));
      // Limit the bloom buffers to the luminance range used by diffusion.
      return [target(gl, w, h, false), target(gl, w, h, false)];
    });
  }

  use(name) {
    const { program, uniform } = this.programs[name];
    this.gl.useProgram(program);
    return uniform;
  }

  bind(handle, unit, uniform) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.uniform1i(uniform, unit);
  }

  pass(rt) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt?.buffer ?? null);
    gl.viewport(0, 0, rt?.width ?? this.canvas.width, rt?.height ?? this.canvas.height);
  }

  common(u, camera, time) {
    const gl = this.gl;
    if (u.uNoise) this.bind(this.noise, 0, u.uNoise);
    if (u.uEye) gl.uniform3fv(u.uEye, camera.eye);
    if (u.uTraveler) gl.uniform3fv(u.uTraveler, travelerPosition);
    if (u.uClip) gl.uniformMatrix4fv(u.uClip, false, camera.clip);
    if (u.uShadowDirection) gl.uniform3fv(u.uShadowDirection, this.shadow.direction);
    if (u.uSideDirection) gl.uniform3fv(u.uSideDirection, this.sideShadow.direction);
    if (u.uIrradiance) this.bind(this.irradiance.color, 3, u.uIrradiance);
    if (u.uSideMap) {
      this.bind(this.sideShadow.depth, 5, u.uSideMap);
      gl.uniformMatrix4fv(u.uSideClip, false, this.sideShadow.clip);
    }
    if (u.uShadowMap) {
      this.bind(this.shadow.depth, 6, u.uShadowMap);
      gl.uniformMatrix4fv(u.uShadowClip, false, this.shadow.clip);
    }
    if (u.uCanopyMap) {
      this.bind(this.canopy.depth, 7, u.uCanopyMap);
      gl.uniformMatrix4fv(u.uCanopyClip, false, this.canopy.clip);
    }
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uStore, this.store);
  }

  lensUniforms(u, camera, focus) {
    const gl = this.gl;
    gl.uniform2f(u.uPixel, 1 / this.frame.width, 1 / this.frame.height);
    if (u.uDepth) this.bind(this.frame.depth, 1, u.uDepth);
    if (u.uPlanes) gl.uniform2f(u.uPlanes, camera.near, camera.far);
    if (u.uLensFocus) gl.uniform1f(u.uLensFocus, focus);
    if (u.uLensBlurScale) gl.uniform1f(u.uLensBlurScale, Math.min(1, (0.252 / camera.vertical) ** 1.33));
  }

  drawCell(cell, count, keepDetails) {
    const gl = this.gl;
    const start = cell.first * 32;
    attribute(gl, 3, 4, 32, start, 1);
    attribute(gl, 4, 4, 32, start + 16, 1);
    gl.drawElementsInstanced(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0, keepDetails ? cell.total : cell.core);
  }

  drawCorollas(layers, keepDetails) {
    const gl = this.gl;
    for (const layer of layers) {
      gl.bindVertexArray(layer.mesh.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.instances);
      for (const cell of layer.cells) this.drawCell(cell, layer.mesh.count, keepDetails);
    }
  }

  drawMeadow(camera, keepDetails) {
    const gl = this.gl;
    const width = scale(camera.forward, camera.horizontal);
    const height = scale(camera.forward, camera.vertical);
    const planes = [add(width, camera.right), sub(width, camera.right),
      add(height, camera.up), sub(height, camera.up)];
    const ox = camera.eye[0];
    const oz = camera.eye[2];
    for (const layer of this.meadow) {
      const margin = planes.map(p => layer.halfWidth * (Math.abs(p[0]) + Math.abs(p[2])) + 1.17 * Math.abs(p[1]));
      const coverage = this.samples && layer.cutout;
      if (coverage) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.bindVertexArray(layer.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.instances);
      for (let i = layer.cells.length - 1; i >= 0; i--) {
        const cell = layer.cells[i];
        const p = [cell.cx - ox, 1.05 - camera.eye[1], cell.cz - oz];
        if (planes.some((plane, i) => dot(plane, p) + margin[i] < 0)) continue;
        this.drawCell(cell, layer.count, keepDetails);
      }
      if (coverage) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    }
  }

  draw(camera, time, keepDetails) {
    const gl = this.gl;
    const { width, height } = this.frame;
    if (time !== this.environmentTime) {
      this.pass(this.environment);
      gl.disable(gl.DEPTH_TEST);
      const u = this.use('environment');
      gl.bindVertexArray(this.screen);
      this.bind(this.noise, 0, u.uNoise);
      this.bind(this.geodesic, 1, u.uGeodesic);
      this.bind(this.dust, 2, u.uDust);
      gl.uniform4fv(u.uLookup, this.lookup);
      gl.uniform3fv(u.uTraveler, travelerPosition);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uStore, 1 / 6);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, this.environment.color);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.pass(this.irradiance);
      const light = this.use('irradiance');
      this.bind(this.environment.color, 4, light.uEnvironment);
      gl.uniform1f(light.uEnvironmentWidth, this.environment.width);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.environmentTime = time;
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    poseTraveler(time, this.pose, this.arms);
    let u = this.use('shadow');
    gl.uniform3fv(u.uTraveler, travelerPosition);
    gl.uniform4fv(u['uPose[0]'], this.pose);
    gl.uniformMatrix4fv(u['uArms[0]'], false, this.arms);
    gl.bindVertexArray(this.traveler.vao);
    for (const light of [this.shadow, this.sideShadow]) {
      this.pass(light);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(u.uClip, false, light.clip);
      gl.drawElements(gl.TRIANGLES, this.traveler.count, gl.UNSIGNED_SHORT, 0);
    }

    this.pass(this.canopy);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    u = this.use('canopy');
    gl.uniformMatrix4fv(u.uClip, false, this.canopy.clip);
    gl.uniform1f(u.uTime, time);
    this.drawCorollas(this.canopyLayers, keepDetails);

    // Diffuse interreflection varies slowly across the suit. An overhead
    // capture averages the actual nearby blooms, including their cast shadows.
    const flowerTick = Math.floor(time * 12);
    if (flowerTick !== this.flowerTick) {
      this.pass(this.flowerRadiance);
      gl.clearColor(0.013, 0.009, 0.025, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      u = this.use('flowerRadiance');
      this.common(u, camera, time);
      gl.uniformMatrix4fv(u.uClip, false, this.flowerClip);
      this.bind(this.petals, 1, u.uPetals);
      this.bind(this.blossoms, 2, u.uBlossoms);
      gl.uniform1i(u.uCoverage, 0);
      this.drawCorollas(this.bounceLayers, keepDetails);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, this.flowerRadiance.color);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.flowerTick = flowerTick;
    }

    this.pass(this.samples ?? this.frame);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.bindVertexArray(this.screen);
    u = this.use('sky');
    this.common(u, camera, time);
    this.bind(this.geodesic, 1, u.uGeodesic);
    this.bind(this.dust, 2, u.uDust);
    gl.uniform4fv(u.uLookup, this.lookup);
    gl.uniform3fv(u.uForward, camera.forward);
    gl.uniform3fv(u.uRight, camera.right);
    gl.uniform3fv(u.uUp, camera.up);
    gl.uniform2f(u.uProjection, camera.horizontal, camera.vertical);
    gl.uniform2f(u.uPlanes, camera.near, camera.far);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.depthFunc(gl.LESS);
    u = this.use('plants');
    this.common(u, camera, time);
    this.bind(this.petals, 1, u.uPetals);
    this.bind(this.blossoms, 2, u.uBlossoms);
    gl.uniform1i(u.uCoverage, this.samples ? 1 : 0);
    this.drawMeadow(camera, keepDetails);

    u = this.use('traveler');
    this.common(u, camera, time);
    gl.uniform4fv(u['uPose[0]'], this.pose);
    gl.uniformMatrix4fv(u['uArms[0]'], false, this.arms);
    this.bind(this.suitPigment, 1, u.uSuitPigment);
    this.bind(this.suitWeave, 8, u.uSuitWeave);
    this.bind(this.flowerRadiance.color, 2, u.uFlowerMap);
    gl.uniform1f(u.uFlowerSpan, this.flowerSpan);
    this.bind(this.environment.color, 4, u.uEnvironment);
    gl.uniform1f(u.uEnvironmentWidth, this.environment.width);
    gl.bindVertexArray(this.traveler.vao);
    gl.drawElements(gl.TRIANGLES, this.traveler.count, gl.UNSIGNED_SHORT, 0);

    u = this.use('ground');
    this.common(u, camera, time);
    gl.bindVertexArray(this.ground.vao);
    gl.drawElements(gl.TRIANGLES, this.ground.count, gl.UNSIGNED_SHORT, 0);

    u = this.use('pollen');
    this.common(u, camera, time);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(u.uAspectPixels, height / camera.vertical);
    gl.bindVertexArray(this.pollen.vao);
    gl.drawArrays(gl.POINTS, 0, this.pollen.count);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);

    if (this.samples) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.samples.buffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.frame.buffer);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    }

    gl.bindVertexArray(this.screen);
    const focus = Math.max(4, dot(sub(add(travelerPosition, [0, 1.80, 0]), camera.eye), camera.forward));
    this.pass(this.lensPrefilter);
    u = this.use('prefilter');
    this.bind(this.frame.color, 0, u.uImage);
    this.lensUniforms(u, camera, focus);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.pass(this.foreground);
    u = this.use('foreground');
    this.bind(this.lensPrefilter.color, 2, u.uPrefiltered);
    this.lensUniforms(u, camera, focus);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.pass(this.lens);
    u = this.use('lens');
    this.bind(this.frame.color, 0, u.uImage);
    this.bind(this.lensPrefilter.color, 2, u.uPrefiltered);
    this.bind(this.foreground.color, 3, u.uForeground);
    this.lensUniforms(u, camera, focus);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // The aperture pass has finished reading the half-resolution prefilter.
    this.pass(this.lensPrefilter);
    u = this.use('diffusion');
    this.bind(this.lens.color, 0, u.uImage);
    gl.uniform2f(u.uPixel, 1 / width, 1 / height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    u = this.use('bloom');
    gl.uniform1f(u.uStore, this.store);
    let source = this.lens;
    for (const [i, [horizontal, vertical]] of this.bloom.entries()) {
      this.pass(horizontal);
      this.bind(source.color, 0, u.uImage);
      gl.uniform2f(u.uStep, 1.45 / source.width, 0);
      gl.uniform1f(u.uThreshold, i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.pass(vertical);
      this.bind(horizontal.color, 0, u.uImage);
      gl.uniform2f(u.uStep, 0, 1 / horizontal.height);
      gl.uniform1f(u.uThreshold, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      source = vertical;
    }

    this.pass(null);
    u = this.use('finish');
    this.bind(this.lens.color, 0, u.uImage);
    this.bind(this.lensPrefilter.color, 1, u.uDiffusion);
    this.bloom.forEach((pair, i) => this.bind(pair[1].color, i + 2, u[`uBloom${i}`]));
    this.bind(this.frame.depth, 6, u.uDepth);
    gl.uniform2f(u.uPlanes, camera.near, camera.far);
    gl.uniform3f(u.uMeadowProjection, camera.eye[1], camera.forward[1], camera.up[1] * camera.vertical);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uStore, this.store);
    gl.uniform2f(u.uPixel, 1 / width, 1 / height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

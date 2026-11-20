import { equipmentCenters, travelerMaterials } from './traveler.js';

const header = `#version 300 es
precision highp float;
precision highp sampler2D;
`;

export const screenVertex = header + `
out vec2 vUV;
void main() {
  vUV = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(vUV * 2.0 - 1.0, 0.0, 1.0);
}
`;

const atmosphere = `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uStore;
uniform vec3 uEye;
uniform vec3 uTraveler;
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowClip;
uniform vec3 uShadowDirection;
uniform highp sampler2DShadow uCanopyMap;
uniform mat4 uCanopyClip;
uniform highp sampler2DShadow uSideMap;
uniform mat4 uSideClip;
uniform vec3 uSideDirection;
uniform sampler2D uIrradiance;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const vec3 HOLE = vec3(-0.048, 0.051, -1.0);
const float SHADOW_RADIUS = 0.110;

float noise2(vec2 uv) { return textureLod(uNoise, uv, 0.0).r; }

float squared(float x) { return x * x; }

// The inner disk, the long luminous bank off to its right, the open upper
// hemisphere and the violet lower hemisphere have different angular extent.
vec3 diskLight() { return texelFetch(uIrradiance, ivec2(0, 0), 0).rgb * 4.0 * 1.36; }
vec3 horizonLight() { return texelFetch(uIrradiance, ivec2(1, 0), 0).rgb * 4.0 * 3.09; }
vec3 domeLight() { return texelFetch(uIrradiance, ivec2(2, 0), 0).rgb * 4.0 * 1.15; }
vec3 fieldBounce() { return texelFetch(uIrradiance, ivec2(3, 0), 0).rgb * 4.0; }

vec3 airlight(vec3 ray) {
  float height = ray.y;
  float above = max(0.0, height);
  float grazing = exp(min(0.0, height) * 54.0);
  float broad = exp(-squared(above / 0.126)) * grazing;
  float low = exp(-squared(above / 0.044)) * grazing;
  float azimuth = 0.44 + 0.56 * exp(-squared((ray.x - 0.088) / 0.46));
  float night = smoothstep(0.018, 0.276, above);
  vec3 dusk = mix(vec3(0.031, 0.028, 0.057), vec3(0.0068, 0.0122, 0.031), night);
  return dusk + azimuth * (vec3(0.113, 0.074, 0.118) * broad + vec3(0.157, 0.098, 0.076) * low);
}

vec2 fieldBands(vec2 point) {
  float depth = -point.y;
  float crumple = noise2(point * vec2(0.025, 0.044) + vec2(0.14, 0.28));
  float nearTurn = (depth - 16.9 + 0.61 * point.x + 1.84 * sin(0.28 * point.x)) / 4.85;
  float farTurn = (depth - 36.3 - 0.40 * point.x - 3.15 * sin(0.14 * point.x + 0.89)) / 6.4;
  float banks = exp(-squared(nearTurn)) * (0.65 + 0.35 * exp(-squared((point.x + 2.6) / 5.2)))
    + exp(-squared(farTurn)) * (0.51 + 0.49 * exp(-squared((point.x - 7.6) / 18.0)));
  float light = clamp(0.72 * banks + 0.62 * crumple - 0.16, 0.0, 1.0);
  float pigment = smoothstep(0.28, 0.70, 0.59 * crumple + 0.41 * (0.5 + 0.5 * sin(point.x * 0.33 + point.y * 0.23)));
  return vec2(light, pigment);
}

float mistBank(vec3 ray, float reach, float distanceZ, float level, float seed) {
  float forward = max(0.25, -ray.z);
  if (reach * forward <= uEye.z + distanceZ - 11.0) return 0.0;
  float travel = 1.0 / forward;
  float projectedX = uEye.x + ray.x * (uEye.z + distanceZ) * travel;
  float drift = distanceZ + 4.2 * sin(projectedX * 0.093 + seed + uTime * 0.023);
  float depth = (uEye.z + drift) * travel;
  vec3 p = uEye + depth * ray;
  float grain = noise2(vec2(p.x * 0.013 + seed * 0.174 - uTime * 0.00061, 0.079 * seed + p.z * 0.032));
  float haze = noise2(vec2(p.x * 0.0048 + seed * 0.091, seed * 0.221 + p.z * 0.009 + uTime * 0.00030));
  float altitude = level + 0.15 * sin(0.17 * p.x + seed) + 0.54 * (haze - 0.5);
  float depthFade = smoothstep(depth - 6.8, depth + 12.0, reach);
  return depthFade * exp(-squared((p.y - altitude) / (0.285 + 0.41 * haze)))
    * (0.12 + 0.88 * smoothstep(0.27, 0.72, grain * 0.69 + haze * 0.31));
}

vec3 mist(vec3 rgb, vec3 world, vec3 incident) {
  vec3 offset = world - uEye;
  float d = length(offset);
  vec3 ray = offset / max(0.001, d);
  float eddy = sin(dot(ray.xz, vec2(6.0, -3.5)) - 0.038 * uTime) * sin(d * 0.063);
  float remaining = exp(-max(0.0, d - 16.0) * (0.0069 + 0.00125 * eddy + 0.0030 * exp(-max(world.y, 0.0) * 3.0)));
  vec3 air = airlight(ray);
  air += vec3(0.046, 0.025, 0.047) * exp(-abs(ray.y) * 15.0) * smoothstep(28.0, 120.0, d);
  float wisp = noise2(world.xz * vec2(0.007, 0.018) + vec2(0.13, uTime * 0.00029));
  // Integrate an exponentially thinning layer up from the flower heads. Its
  // forward scattering changes with the light reaching the air at the receiver.
  float h = max(0.0, world.y - 0.46);
  float dh = max(0.0, uEye.y - 0.46) - h;
  float column = abs(dh) < 0.012 ? exp(-1.62 * h)
    : (exp(-1.62 * h) - exp(-1.62 * (h + dh))) / (1.62 * dh);
  float scatter = 1.0 - exp(-0.0053 * min(d, 48.0) * column * (0.60 + 0.75 * wisp));
  vec3 lowAir = vec3(0.037, 0.029, 0.071) + incident * vec3(0.140, 0.097, 0.138);
  vec3 volume = mix(air, mix(rgb, lowAir, scatter), remaining);
  if (d > 19.0) {
    float nearFog = mistBank(ray, d, 29.8, 1.27, 0.43);
    float farFog = mistBank(ray, d, 66.5, 1.63, 2.08);
    vec3 light = mix(vec3(0.144, 0.101, 0.188), vec3(0.275, 0.156, 0.177),
      0.32 + 0.68 * exp(-squared((ray.x - 0.14) / 0.38)));
    volume = mix(volume, light, 1.0 - exp(-0.78 * nearFog - 0.59 * farFog));
  }
  return volume;
}

float canopyVisibility(vec3 world) {
  vec3 p = (uCanopyClip * vec4(world, 1.0)).xyz * 0.5 + 0.5;
  vec3 edge = min(p, 1.0 - p);
  float inside = smoothstep(0.0, 0.075, min(min(edge.x, edge.y), edge.z));
  if (inside <= 0.0) return 1.0;
  // The broad disk lights the canopy through a soft, partially transmitting penumbra.
  vec2 spread = vec2(0.0026, 0.0058);
  float receiver = p.z - 0.0017;
  float sun = texture(uCanopyMap, vec3(p.xy + vec2(-0.72, -0.34) * spread, receiver));
  sun += texture(uCanopyMap, vec3(p.xy + vec2(0.58, -0.71) * spread, receiver));
  sun += texture(uCanopyMap, vec3(p.xy + vec2(0.77, 0.46) * spread, receiver));
  sun += texture(uCanopyMap, vec3(p.xy + vec2(-0.37, 0.79) * spread, receiver));
  return mix(1.0, 0.24 + 0.76 * sun * 0.25, inside);
}

float diskVisibility(highp sampler2DShadow map, mat4 clip, vec3 direction,
    vec3 world, float bias, vec2 angularSize) {
  vec3 local = world - uTraveler;
  if (max(abs(local.x), abs(local.z)) > 16.0) return 1.0;
  vec3 light = (clip * vec4(world, 1.0)).xyz * 0.5 + 0.5;
  if (any(lessThan(light, vec3(0.0))) || any(greaterThan(light, vec3(1.0)))) return 1.0;
  float distanceFromCaster = max(0.0, dot(local - vec3(0.0, 1.02, 0.0), -direction));
  vec2 penumbra = vec2(0.0023, 0.0014) + angularSize * distanceFromCaster;
  const vec2 taps[8] = vec2[8](
    vec2(-0.33, -0.79), vec2(0.56, -0.64), vec2(0.91, 0.19), vec2(0.16, 0.91),
    vec2(-0.71, 0.53), vec2(-0.88, -0.17), vec2(0.34, 0.19), vec2(-0.22, 0.16)
  );
  float visible = 0.0;
  for (int i = 0; i < 8; i++) {
    visible += texture(map, vec3(light.xy + taps[i] * penumbra, light.z - bias));
  }
  return visible * 0.125;
}

vec2 diskVisibility(vec3 world, float bias) {
  return vec2(diskVisibility(uShadowMap, uShadowClip, uShadowDirection, world, bias, vec2(0.023, 0.009)),
    diskVisibility(uSideMap, uSideClip, uSideDirection, world, bias, vec2(0.063, 0.014)));
}

float travelerContact(vec3 world) {
  vec2 local = world.xz - uTraveler.xz;
  return 1.0 - 0.38 * exp(-dot(local, local) * 4.6) * (1.0 - smoothstep(0.10, 0.96, world.y));
}

vec3 understory(vec3 world, float depth) {
  vec2 p = world.xz;
  float textureMix = noise2(p * 0.014) * 0.58 + noise2(p * 0.073) * 0.42;
  float mulch = mix(noise2(p * 0.51), 0.50, smoothstep(56.0, 185.0, depth));
  vec2 fields = fieldBands(p);
  vec3 ground = mix(vec3(0.012, 0.011, 0.032), vec3(0.044, 0.023, 0.051), fields.y * 0.46 + 0.54 * textureMix);
  vec2 pass = diskVisibility(world, 0.00062);
  float canopy = canopyVisibility(world);
  vec3 lit = diskLight() * pass.x * canopy + horizonLight() * pass.y * (0.07 + 0.20 * canopy);
  lit *= 0.50 + 0.50 * fields.x;
  ground += mulch * vec3(0.009, 0.006, 0.014);
  ground *= domeLight() * 2.4 * travelerContact(world) + 0.58 * lit;
  return mist(ground, world, lit);
}
`;

function skyShader(panorama) {
  return header + atmosphere + `
#define LIGHT_PROBE ${panorama ? 1 : 0}
in vec2 vUV;
out vec4 fragColor;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uProjection;
uniform sampler2D uGeodesic;
uniform sampler2D uDust;
uniform vec4 uLookup;
uniform vec2 uPlanes;

vec2 hash2(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * vec3(0.1031, 0.11369, 0.13787));
  q += dot(q, q.yzx + 19.19);
  return fract((q.xx + q.yz) * q.zy);
}

vec3 starLayer(vec2 uv, vec2 grid, float gate, float size, float strength) {
  vec2 p = uv * grid;
  vec2 tile = floor(p);
  vec2 rnd = hash2(tile);
  vec2 center = 0.19 + rnd * 0.62;
  float sharp = length((fract(p) - center) * vec2(1.0, 1.16));
  float present = step(gate, rnd.x);
  float pixel = 0.50 * max(fwidth(p.x), fwidth(p.y));
  float width = length(vec2(size, pixel));
  float glow = exp(-squared(sharp / width)) * squared(size / width);
  vec3 tint = mix(vec3(0.56, 0.68, 1.0), vec3(1.0, 0.80, 0.62), rnd.y);
  return glow * present * strength * (0.19 + rnd.y * rnd.y) * tint;
}

vec3 stars(vec3 direction, float clarity) {
  vec2 polar = vec2(atan(direction.x, -direction.z) / TAU + 0.5, asin(direction.y) / PI + 0.5);
  vec3 fine = starLayer(polar, vec2(386.0, 215.0), 0.933, 0.036, 0.38);
  vec3 bright = starLayer(polar + 0.0834, vec2(187.0, 121.0), 0.982, 0.069, 0.71);
  return clarity * (fine + bright);
}

vec2 skyAngles(vec3 ray) {
  return vec2(atan(ray.x, -ray.z), asin(clamp(ray.y, -1.0, 1.0)));
}

float dustDensity(vec2 uv) {
  vec2 edge = smoothstep(vec2(0.0), vec2(0.085), min(uv, 1.0 - uv));
  float matte = texture(uDust, uv).r;
  return edge.x * edge.y * smoothstep(0.019, 0.335, matte);
}

float inverseRadius(float lookupX, float angle) {
  float y = (1.5 + clamp(angle / uLookup.z, 0.0, 1.0) * (uLookup.y - 2.0)) / uLookup.y;
  return textureLod(uGeodesic, vec2(lookupX, y), 0.0).r;
}

float lookupXFor(float impact) {
  float offset = impact - 1.0;
  float q = sign(offset) * sqrt(abs(offset));
  return (0.5 + (q + 1.0) / (1.0 + uLookup.w) * (uLookup.x - 1.0)) / uLookup.x;
}

vec3 gasFlow(float radius, float logRadius, float longitude, float age, float seed) {
  float angularSpeed = 1.87 / (0.42 + pow(radius * 0.22, 1.48));
  float azimuth = longitude - age * angularSpeed;
  float spiralAngle = azimuth + 2.81 * logRadius + 0.27 * sin(azimuth * 3.0 - logRadius * 2.1);
  vec2 orbit = vec2(cos(azimuth), sin(azimuth));
  vec2 spiral = vec2(cos(spiralAngle), sin(spiralAngle));
  float feed = logRadius + age * 0.0063;
  float cloud = noise2(orbit * 0.148 + vec2(feed * 0.143 + seed, -feed * 0.117));
  float current = noise2(spiral * vec2(0.194, 0.110)
    + vec2(feed * 0.59 + (cloud - 0.5) * 0.093, seed + 0.23));
  float fibers = noise2(spiral * vec2(0.090, 0.207)
    + vec2(feed * 2.71 + current * 0.037, 0.67 + seed + feed * 0.193));
  float distortion = (current - 0.5) * 3.4 + 0.81 * spiral.y + 0.56 * orbit.x;
  float wave = 0.5 + 0.5 * cos(logRadius * 31.0 + distortion);
  float thread = 0.5 + 0.5 * cos(logRadius * 64.5 + distortion * 1.53 + 2.7 * fibers + 0.76 * orbit.y);
  float strand = (0.65 * wave * wave * wave + 0.35 * thread * thread)
    * smoothstep(0.24, 0.69, 0.45 * cloud + 0.55 * fibers);
  float knot = pow(0.5 + 0.5 * cos(azimuth * 2.0 + logRadius * 3.1 + cloud * 2.6 + seed * 6.0), 3.2);
  float plume = pow(0.5 + 0.5 * cos(azimuth + logRadius * 2.03 + seed * 4.2), 4.7);
  float braided = smoothstep(0.27, 0.71, 0.56 * current + 0.27 * fibers + 0.17 * cloud);
  return vec3(braided, strand, (0.55 * knot + 0.76 * plume) * (0.37 + 0.63 * braided));
}

// The direct and lensed images look through the same circulating gas.
// Offset advection windows keep the sheared texture continuous over time.
vec4 disk(float radius, vec3 crossing, vec3 alongDisk, vec3 acrossDisk, float winding) {
  float farSide = smoothstep(0.10, 0.78, -crossing.z);
  float inner = smoothstep(mix(3.95, 3.56, farSide), mix(5.21, 4.68, farSide), radius);
  float outer = 1.0 - smoothstep(mix(85.0, 7.70, farSide), mix(142.0, 12.40, farSide), radius);
  if (inner * outer < 0.001) return vec4(0.0);
  float longitude = atan(dot(crossing, acrossDisk), dot(crossing, alongDisk));
  float logR = log(radius);
  float arrival = uTime + 5.1 - winding * 0.57 - (1.0 - crossing.z) * 0.40;
  float age = fract(arrival / 23.0);
  float secondAge = fract(age + 0.5);
  float blend = squared(sin(age * PI));
  vec3 first = gasFlow(radius, logR, longitude, age * 23.0, 0.13);
  vec3 second = gasFlow(radius, logR, longitude, secondAge * 23.0, 0.71);
  vec3 flow = mix(second, first, blend);

  float stream = 0.19 + 0.75 * flow.x + 1.03 * flow.y + 1.09 * flow.z;
  float channel = exp(-squared((radius - 5.22 - (flow.x - 0.5) * 0.54) / 0.43));
  float outerCurrent = exp(-squared((radius - 7.43 + 0.52 * (flow.x - 0.5)) / 0.78));
  float gap = exp(-squared((radius - 6.36 - 0.31 * (flow.x - 0.5)) / 0.47));
  float energy = 3.18 / (0.86 + 0.054 * radius + 0.00172 * radius * radius);
  energy *= exp(-max(0.0, radius - 5.55) * mix(0.0084, 0.226, farSide));
  energy *= mix(0.70 + 0.86 * channel + 0.24 * outerCurrent,
    0.47 + 1.30 * channel + 0.78 * outerCurrent, farSide);
  energy *= 1.0 - (0.26 + 0.26 * farSide) * gap;
  float approaching = cos(longitude) * inversesqrt(0.50 + radius * 0.080);
  float doppler = pow(max(0.36, 1.0 + 0.363 * approaching), 2.54);
  float temp = clamp(exp(-max(0.0, radius - 4.95) * 0.101) * 0.69
    + 0.25 * flow.y + 0.19 * flow.z + 0.17 * approaching + 0.08 * channel, 0.0, 1.0);
  vec3 tint = mix(vec3(1.0, 0.201, 0.079), vec3(1.0, 0.671, 0.361), smoothstep(0.0, 0.86, temp));
  tint = mix(tint, vec3(1.0, 0.885, 0.667), smoothstep(0.76, 1.0, temp));
  float opacity = inner * outer * (0.47 + 0.30 * flow.x + 0.07 * channel - 0.053 * winding);
  return vec4(energy * doppler * stream * tint, opacity);
}

vec4 diskHit(float lookupX, float phase, vec3 crossing, vec3 alongDisk, vec3 acrossDisk, float winding) {
  float u = inverseRadius(lookupX, phase);
  if (u <= 0.005 || u >= 0.312 || phase > uLookup.z) return vec4(0.0);
  vec4 light = disk(1.0 / u, crossing, alongDisk, acrossDisk, winding);
  return vec4(light.rgb * light.a, light.a);
}

#if !LIGHT_PROBE
vec3 flatMeadow(vec3 ray) {
  float distance = uEye.y / max(0.00012, -ray.y);
  vec3 world = uEye + ray * distance;
  float forwardDepth = distance * dot(ray, uForward);
  gl_FragDepth = clamp(uPlanes.y * (forwardDepth - uPlanes.x)
    / (forwardDepth * (uPlanes.y - uPlanes.x)), 0.0, 1.0);
  return understory(world, distance);
}
#endif

void main() {
#if LIGHT_PROBE
  float longitude = (vUV.x - 0.5) * TAU;
  float latitude = (vUV.y - 0.5) * PI;
  vec3 ray = vec3(sin(longitude) * cos(latitude), sin(latitude), -cos(longitude) * cos(latitude));
#else
  vec2 NDC = vUV * 2.0 - 1.0;
  vec3 ray = normalize(uForward + uRight * (NDC.x * uProjection.x) + uUp * (NDC.y * uProjection.y));
  // The disk and its near-atmosphere glow are fully occluded here.
  if (ray.y <= -0.020) {
    fragColor = vec4(flatMeadow(ray) * uStore, 1.0);
    return;
  }
#endif
  vec3 toward = normalize(HOLE);
  vec3 right = normalize(cross(toward, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, toward);
  float aiming = dot(ray, toward);
  vec2 impact = vec2(dot(ray, right), dot(ray, up)) / max(0.05, aiming) / SHADOW_RADIUS;
  float b = length(impact);
  float bandwidth = fwidth(b);
  vec2 axis = impact / max(b, 0.0001);
  vec3 diskNormal = normalize(vec3(-0.090, 1.0, 0.117));
  vec3 alongDisk = normalize(cross(diskNormal, vec3(0.0, 0.0, 1.0)));
  vec3 acrossDisk = cross(alongDisk, diskNormal);

  vec3 displaced = ray;
  vec3 emission = vec3(0.0);
  float coverage = 0.0;
  float escaped = 1.0;
  if (b < 8.5 && aiming > 0.0) {
    float lookupX = lookupXFor(b);
    float escapeAngle = textureLod(uGeodesic, vec2(lookupX, 0.5 / uLookup.y), 0.0).r;
    escaped = smoothstep(-0.7, 0.4, escapeAngle);
    float first = atan(-diskNormal.z, dot(diskNormal.xy, axis)) + PI;
    for (int imageIndex = 0; imageIndex < 3; imageIndex++) {
      float winding = float(imageIndex);
      float phase = first + winding * PI;
      if (coverage > 0.995 || phase > uLookup.z) break;
      vec3 crossing = vec3(axis * sin(phase), cos(phase));
      vec4 light = diskHit(lookupX, phase, crossing, alongDisk, acrossDisk, winding);
      if (imageIndex > 0 && abs(b - 1.0) < 0.11) {
        float halfPixel = bandwidth * 0.46;
        vec4 low = diskHit(lookupXFor(b - halfPixel), phase, crossing, alongDisk, acrossDisk, winding);
        vec4 high = diskHit(lookupXFor(b + halfPixel), phase, crossing, alongDisk, acrossDisk, winding);
        light = (low + 2.0 * light + high) * 0.25;
      }
      emission += (1.0 - coverage) * light.rgb * exp(-winding * 0.36);
      coverage += (1.0 - coverage) * light.a;
    }
    float bend = max(0.0, escapeAngle - PI) * (1.0 - smoothstep(3.8, 7.2, b));
    vec3 radial = right * axis.x + up * axis.y;
    displaced = normalize(ray * cos(bend) - radial * sin(bend));
  }

  float altitude = ray.y;
  vec2 apparent = skyAngles(ray);
  float lensing = 1.0 - smoothstep(1.46, 3.5, b);
  // Most visible dust is in front of the deep field. Keep its large
  // filaments in place while the distant starlight bends close to the limb.
  vec2 distant = mix(apparent, skyAngles(displaced), 0.22 * lensing);
  float farDust = dustDensity(vec2(0.38 + 0.64 * distant.x, 0.99 - 2.66 * distant.y + 0.09 * sin(distant.x * 2.7)));
  float wisp = dustDensity(vec2(0.64 - 0.96 * apparent.x + uTime * 0.00041,
    0.84 - 3.03 * apparent.y + 0.082 * sin(6.1 * apparent.x - 0.22)));
  float twilight = smoothstep(0.017, 0.103, altitude);
  float captured = (1.0 - escaped) * smoothstep(0.009, 0.036, altitude) * 0.975;
  float clarity = smoothstep(0.067, 0.176, altitude) * smoothstep(1.15, 2.90, b);
  vec3 blueDust = mix(vec3(0.106, 0.089, 0.158), vec3(0.059, 0.088, 0.143), smoothstep(-0.41, 0.35, ray.x));
  vec3 dusk = airlight(ray) + blueDust * farDust * (0.48 + 0.52 * twilight);
  vec3 sky = mix(dusk, vec3(0.0077, 0.0082, 0.018), captured);
  vec3 starRay = normalize(mix(ray, displaced, 0.51 * lensing));
  sky += escaped * (1.0 - coverage) * stars(starRay, clarity * (0.97 - 0.43 * farDust));

  float axisHeight = dot(impact, diskNormal.xy);
  float drift = 0.024 * sin(2.36 * impact.x + 0.19 * uTime);
  float scattering = exp(-squared((axisHeight + 0.32 + drift) / 0.341));
  float arc = exp(-squared((b - 1.25) / 0.25)) * smoothstep(-0.16, 0.68, axisHeight);
  float wingLight = 0.24 + 0.76 * exp(-squared((ray.x - 0.147) / 0.415));
  vec3 veil = vec3(0.213, 0.099, 0.061) * scattering * wingLight
    + vec3(0.097, 0.038, 0.019) * arc;
  float dustAroundLimb = exp(-squared((b - 1.24) / 0.48)) * smoothstep(-0.46, 0.69, axisHeight);
  veil += vec3(0.076, 0.033, 0.050) * dustAroundLimb;
  float diskHaze = exp(-squared((altitude - 0.015 - 0.038 * ray.x) / 0.036));
  veil += vec3(0.198, 0.098, 0.073) * diskHaze * wingLight;
  veil += wisp * mix(vec3(0.033, 0.036, 0.063), vec3(0.142, 0.061, 0.037), diskHaze * wingLight);
  veil *= 1.0 - captured * mix(0.56, 0.19, diskHaze);
  float outerAir = 0.56 + 0.44 * exp(-squared((ray.x - 0.062) / 0.44));
  emission *= (1.0 - 0.24 * wisp) * outerAir;
  float orientation = atan(axis.y, axis.x + 0.00001);
  float orbitingLight = 0.53 + 0.47 * sin(3.0 * orientation - 1.24 * uTime + 0.81 * sin(orientation * 6.0 + uTime * 0.32));
  float lineWidth = length(vec2(0.0030, bandwidth * 0.61));
  float echoWidth = length(vec2(0.0042, bandwidth * 0.49));
  float photon = exp(-squared((b - 1.007) / lineWidth)) * 0.0030 / lineWidth;
  float photonEcho = exp(-squared((b - 1.028) / echoWidth)) * 0.0042 / echoWidth;
  float edgeFog = smoothstep(0.002, 0.024, altitude);
  float exposed = (0.83 - 0.57 * coverage) * (0.72 + 0.28 * axis.x * axis.x + 0.24 * axis.x);
  emission += (vec3(1.0, 0.848, 0.686) * photon * (1.19 + 0.66 * orbitingLight)
    + vec3(1.0, 0.437, 0.237) * photonEcho * (0.28 + 0.23 * orbitingLight)) * exposed * edgeFog;

#if LIGHT_PROBE
  // The disk is confined to its forward hemisphere. Behind the lens the
  // diffuse afterglow of the sky and the nearby violet canopy still reflect.
  float forwardLight = smoothstep(-0.04, 0.52, aiming);
  float openSky = 0.48 + 0.52 * max(0.0, dot(ray, normalize(vec3(-0.74, 0.53, 0.34))));
  vec3 backSky = airlight(ray) * vec3(0.38, 0.42, 0.63) + vec3(0.077, 0.084, 0.156) * openSky;
  vec3 reflectedSky = mix(backSky, sky + veil + emission, forwardLight);
  float low = smoothstep(-0.83, 0.022, altitude);
  vec2 fieldUV = uTraveler.xz + ray.xz * (1.48 / max(0.028, -altitude));
  float meadow = noise2(fieldUV * 0.043) * 0.65 + noise2(fieldUV * 0.17 + vec2(uTime * 0.0007, 0.0)) * 0.35;
  vec3 ground = mix(vec3(0.015, 0.009, 0.027), vec3(0.10, 0.059, 0.137), low * (0.48 + meadow));
  ground += vec3(0.17, 0.106, 0.096) * pow(low, 14.0) * (0.45 + 0.55 * forwardLight);
  vec3 color = mix(ground, reflectedSky, smoothstep(-0.022, 0.026, altitude));
#else
  // The violet canopy continues procedurally behind the last mesh tier.
  gl_FragDepth = 1.0;
  if (altitude < 0.0) sky = flatMeadow(ray);
  vec3 color = sky + veil * smoothstep(-0.020, 0.019, altitude) + emission * smoothstep(-0.007, 0.018, altitude);
#endif
  fragColor = vec4(color * uStore, 1.0);
}
`;
}

export const skyFragment = skyShader(false);
export const environmentFragment = skyShader(true);

export const groundVertex = header + `
layout(location = 0) in vec3 aPosition;
uniform mat4 uClip;
out vec3 vWorld;
void main() {
  vWorld = aPosition;
  gl_Position = uClip * vec4(vWorld, 1.0);
}
`;

export const groundFragment = header + atmosphere + `
in vec3 vWorld;
out vec4 fragColor;
void main() {
  fragColor = vec4(understory(vWorld, length(vWorld - uEye)) * uStore, 1.0);
}
`;

// Integrate extended patches of the live sky once, before shading surfaces.
// Latitude bins have equal solid angle. Mip filtering integrates the narrow
// gas streams inside each bin, including on the smaller mobile panorama.
export const irradianceFragment = header + `
uniform sampler2D uEnvironment;
uniform float uEnvironmentWidth;
out vec4 fragColor;
void main() {
  int sector = int(gl_FragCoord.x);
  const float tau = 6.28318530718;
  const float pi = 3.14159265359;
  // Longitude, longitude extent, and the lower/upper sine of latitude.
  vec4 window = vec4(-0.09, 0.50, 0.012, 0.169);
  if (sector == 1) window = vec4(0.59, 1.15, 0.016, 0.35);
  if (sector == 2) window = vec4(-pi, tau, 0.135, 0.987);
  if (sector == 3) window = vec4(-pi, tau, -0.96, -0.036);
  float lod = max(0.0, log2(uEnvironmentWidth * window.y / (tau * 10.0)));
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 6; j++) {
    float y = (float(j) + 0.5) / 6.0;
    float v = asin(mix(window.z, window.w, y)) / pi + 0.5;
    for (int i = 0; i < 10; i++) {
      float x = (float(i) + 0.25 + 0.5 * mod(float(j), 2.0)) / 10.0;
      float u = (window.x + window.y * x) / tau + 0.5;
      sum += textureLod(uEnvironment, vec2(u, v), lod).rgb;
    }
  }
  fragColor = vec4(sum * (6.0 / (4.0 * 60.0)), 1.0);
}
`;

export const plantVertex = header + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aSurface;
layout(location = 3) in vec4 aPlant;
layout(location = 4) in vec4 aTraits;
uniform mat4 uClip;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vSurface;
out vec4 vTraits;
out float vHeight;

void main() {
  float angle = aPlant.w;
  mat2 turn = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
  vec3 model = aPosition;
  vec3 normal = aNormal;
  float seed = aTraits.z;
  if (aSurface.x < 0.5) {
    float individual = fract(seed * 19.73 + aSurface.x * 21.84);
    float lift = 0.37 + 0.72 * fract(seed * 7.91) + 0.30 * (individual - 0.5);
    model.y = 0.985 + (model.y - 0.985) * lift;
    normal.y /= lift;
    float twist = (individual - 0.5) * 0.34;
    mat2 curl = mat2(cos(twist), sin(twist), -sin(twist), cos(twist));
    model.xz = curl * model.xz;
    normal.xz = curl * normal.xz;
  }
  if (aSurface.x >= 5.0) {
    float open = 0.37 + 0.76 * fract(seed * 22.49);
    open *= mix(0.76, 1.0, min(aTraits.x, 1.0));
    model.y = 0.988 + (model.y - 0.988) * open;
    normal.y /= open;
    float breadth = 0.84 + 0.33 * fract(seed * 14.13);
    model.x *= breadth;
    normal.x /= breadth;
  }
  model.xz *= aTraits.x;
  normal.xz /= aTraits.x;
  float bend = fract(seed * 19.347);
  float sprout = aSurface.x < 1.5 || aSurface.x >= 5.0 ? 1.0 : (aSurface.x < 2.5 ? smoothstep(0.89, 0.994, model.y) : 0.0);
  float tilt = (0.105 + 1.065 * pow(bend, 1.72) + 0.13 * sin(aPlant.x * 1.73 + aPlant.y * 0.94)) * sprout;
  if (aSurface.x < 0.5) tilt *= 0.69;
  if (aSurface.x >= 5.0) tilt *= 0.74;
  if (aSurface.x > 3.7 && aSurface.x < 5.0) tilt = (0.10 + 0.42 * bend) * smoothstep(0.45, 1.03, model.y);
  mat2 nod = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt));
  model.yz = nod * (model.yz - vec2(1.0, 0.0)) + vec2(1.0, 0.0);
  normal.yz = nod * normal.yz;
  model.xz = turn * model.xz;
  normal.xz = turn * normal.xz;
  vec2 root = aPlant.xy;
  float breeze = sin(dot(root, vec2(0.37, 0.16)) - 0.67 * uTime);
  float front = sin(dot(root, vec2(-0.18, 0.32)) - 1.02 * uTime + 0.58 * breeze);
  float stir = sin(uTime * 1.43 + seed * 6.28 + dot(root, vec2(0.31, -0.18)));
  vec2 wind = vec2(0.116 * breeze + 0.055 * stir + 0.044, 0.085 * front + 0.042 * stir);
  float height = max(0.0, model.y);
  model.xz += wind * height * height;
  normal.y -= dot(normal.xz, 2.0 * wind * height);
  vWorld = aPlant.z * model + vec3(root.x, aTraits.w, root.y);
  vNormal = normalize(normal);
  vSurface = aSurface;
  vTraits = vec4(aTraits.y, seed, aPlant.z, aPlant.w);
  vHeight = aPlant.z * model.y;
  gl_Position = uClip * vec4(vWorld, 1.0);
}
`;

function plantShader(capture) {
  return header + atmosphere + `
#define FLOWER_CAPTURE ${capture ? 1 : 0}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vSurface;
in vec4 vTraits;
in float vHeight;
out vec4 fragColor;
uniform sampler2D uPetals;
uniform sampler2D uBlossoms;
uniform bool uCoverage;

vec3 petalPigment(vec2 uv, float seed, float id) {
  float tile = floor(fract(seed * 3.13 + id * 0.79) * 4.0);
  vec2 offset = vec2(mod(tile, 2.0), floor(tile * 0.5));
  // The atlas has the narrow attachment at the top. Follow its widening fan.
  float width = 0.09 + 0.63 * sin(pow(uv.x, 0.83) * 2.34);
  vec2 point = vec2(0.50 + (uv.y - 0.5) * width, 0.15 + 0.705 * uv.x);
  vec4 photo = texture(uPetals, (offset + point) * 0.5, 0.29);
  vec3 dye = mix(vec3(0.089, 0.046, 0.173), photo.rgb, smoothstep(0.67, 0.98, photo.a));
  float value = dot(dye, vec3(0.27, 0.49, 0.24));
  return mix(vec3(value), dye, 0.66) * vec3(1.00, 0.96, 1.13);
}

void main() {
  vec3 N = normalize(vNormal);
#if FLOWER_CAPTURE
  vec3 V = vec3(0.0, 1.0, 0.0);
#else
  vec3 V = normalize(uEye - vWorld);
#endif
  float nv = dot(N, V);
  vec3 face = nv >= 0.0 ? N : -N;
  float id = vSurface.x;
  float radialFootprint = 2.5 * fwidth(id);
  vec2 uv = vSurface.yz;
  float seed = vTraits.y;
  float shade = vTraits.x;
  float crown = smoothstep(0.14, 0.76, 0.88 * vHeight + 0.12 * vTraits.z);
  vec2 fields = fieldBands(vWorld.xz);
  vec3 petalColor = mix(vec3(0.83, 0.99, 1.22), vec3(1.19, 0.96, 0.95), fields.y);
  vec2 visibility = diskVisibility(vWorld, 0.00072);
  float canopy = canopyVisibility(vWorld);
  vec3 eastern = diskLight() * visibility.x * canopy * (0.77 + 0.23 * crown) * (0.54 + 0.77 * fields.x);
  vec3 rakingLight = horizonLight() * visibility.y * (0.09 + 0.34 * canopy) * (0.40 + 0.60 * crown)
    * (0.78 + 0.22 * fields.x);
  vec3 incident = eastern + rakingLight;
  float nl = dot(face, uShadowDirection);
  float wl = dot(face, uSideDirection);
  vec3 reflected = max(0.0, nl) * eastern + max(0.0, wl) * rakingLight;
  vec3 transmitted = max(0.0, -nl) * eastern + max(0.0, -wl) * rakingLight;
  float skylight = 0.43 + 0.57 * max(0.0, 0.36 + 0.64 * face.y);
  float occlusion = (0.40 + 0.60 * crown) * (0.76 + 0.24 * canopy) * travelerContact(vWorld);
  vec3 fill = domeLight() * (2.59 * skylight * occlusion);
  float coverage = 1.0;
  vec3 color;
  if (id >= 5.0) {
    float tile = floor(fract(seed * 13.77) * 4.0);
    vec2 offset = vec2(mod(tile, 2.0), floor(tile * 0.5));
    vec4 flower = texture(uBlossoms, (uv + offset) * 0.5, 0.24);
    float feather = clamp(fwidth(flower.a) * 1.09, 0.15, 0.48);
    coverage = uCoverage ? smoothstep(0.47 - feather, 0.47 + feather, flower.a) : step(0.47, flower.a);
    if (coverage < 0.004) discard;
    // Trilinear filtering mixes the pigment with the unpainted atlas gutter.
    // Restore the color in the partially covered samples before lighting it.
    flower.rgb /= max(0.51, flower.a);
    float radial = clamp((id - 5.0) * 2.5, 0.0, 1.0);
    vec2 local = uv - vec2(0.498, 0.493);
    float angle = atan(local.y, local.x + 0.000001);
    float lobe = 0.5 + 0.5 * cos(5.0 * (angle - 1.57) + 0.31 * sin(2.0 * angle));
    float value = dot(flower.rgb, vec3(0.29, 0.48, 0.23));
    vec3 dye = mix(vec3(value), flower.rgb, 0.68) * vec3(0.87, 0.77, 0.88);
    dye *= mix(vec3(0.80, 0.81, 1.04), vec3(1.09, 1.06, 1.0), shade);
    float underside = 1.0 - smoothstep(-0.28, 0.19, nv);
    dye = mix(dye, vec3(0.052, 0.043, 0.103) + 0.32 * dye, 0.63 * underside);
    float lip = smoothstep(0.66, 0.99, radial);
    float thin = 0.43 + 0.38 * lobe + 0.39 * lip;
    color = dye * petalColor * (fill + 0.58 * reflected + vec3(0.86, 0.78, 1.09) * transmitted * thin);
#if FLOWER_CAPTURE
    fragColor = vec4(color, 1.0);
    return;
#endif
    float silhouette = 1.0 - min(1.0, abs(nv));
    float velvet = pow(silhouette, 1.7) * (0.33 + 0.67 * max(0.0, -nl));
    color += (0.19 * fill + vec3(0.065, 0.061, 0.153) * incident)
      * (0.24 + 0.76 * lip) * velvet * thin;
    float wet = smoothstep(0.49, 0.94, fract(seed * 49.33));
    float sunAngle = atan(uShadowDirection.z, uShadowDirection.x) - vTraits.w;
    float incidence = angle - sunAngle + (fract(seed * 37.31) - 0.5) * 1.55;
    float lipAngle = incidence - lobe * 0.64;
    float arcWidth = 0.21 + 0.13 * fract(seed * 26.13);
    float crescent = exp(-squared(sin(lipAngle) / arcWidth)) * smoothstep(0.58, 0.94, cos(lipAngle));
    float facet = abs(dot(N, normalize(V + uShadowDirection)));
    float crestWidth = length(vec2(0.080, 0.40 * radialFootprint));
    float crest = exp(-squared((radial - 0.845 - 0.069 * lobe) / crestWidth)) * 0.080 / crestWidth;
    float brokenFold = 0.5 + 0.5 * cos(angle * 10.0 + 2.7 * lobe + 31.0 * seed);
    float beads = 0.085 + 0.915 * smoothstep(0.31, 0.83, brokenFold);
    float glint = wet * crescent * crest * beads * (0.20 + 0.80 * pow(facet, 4.0));
    // The near-facing lip turns back into the transmitted light. Only short
    // folds catch it; the velvet between them stays dark within the same bloom.
    float returned = smoothstep(0.78, 0.991, -cos(lipAngle - 0.37 * sin(3.0 * angle + seed * 19.0)));
    float seam = exp(-squared((radial - 0.83 - 0.083 * lobe) / crestWidth)) * 0.080 / crestWidth;
    float lipFlash = returned * seam * (0.18 + 0.82 * brokenFold * brokenFold)
      * smoothstep(0.37, 0.93, fract(seed * 23.19)) * (0.32 + 0.68 * facet * facet);
    float lowAngle = 1.0 - smoothstep(0.060, 0.18, V.y);
    float dropletAngle = 6.283 * fract(seed * 75.13);
    vec2 beadAt = vec2(cos(dropletAngle), sin(dropletAngle)) * (0.16 + 0.13 * fract(seed * 32.11));
    vec2 beadOffset = (local - beadAt) / vec2(0.031, 0.040);
    float bead = exp(-dot(beadOffset, beadOffset)) * smoothstep(0.66, 0.94, fract(seed * 18.87));
    float lipFace = smoothstep(0.093, 0.212, V.y);
    vec3 glintLight = eastern + 0.54 * rakingLight;
    color += glintLight * (6.47 * glint * (1.0 + 0.62 * lowAngle)
      + (2.6 + 1.8 * lipFace) * bead * (0.20 + 0.80 * facet)) * (0.19 + 0.81 * crown);
    color += glintLight * mix(0.65, 6.48, lipFace) * lipFlash * (0.21 + 0.79 * crown);
  } else if (id < 0.5) {
    float side = 2.0 * uv.y - 1.0;
    float cup = smoothstep(0.025, 0.58, uv.x);
    float type = fract(seed * 8.21);
    vec3 dye = petalPigment(uv, seed, id) * petalColor;
    dye *= mix(vec3(0.79, 0.74, 1.05), vec3(1.22, 1.08, 0.91), 0.62 * shade + 0.38 * type);
    dye *= (0.86 + 0.44 * shade) * (0.57 + 0.43 * cup);
    float crease = cos(10.5 * side + 3.7 * uv.x + 15.9 * id);
    float tissue = 0.71 + 0.29 * crease * cup;
    color = dye * (fill + 0.68 * reflected + vec3(0.81, 0.81, 1.16)
      * transmitted * (0.25 + 0.75 * cup) * tissue);
#if FLOWER_CAPTURE
    fragColor = vec4(color, 1.0);
    return;
#endif

    // Thin, uneven lips pass the sunset through the pigment. Only exposed
    // folds catch a narrow bright line; the surrounding surface is diffuse.
    float rim = max(smoothstep(0.78, 0.99, abs(side)) * sin(uv.x * PI),
      smoothstep(0.77, 0.98, uv.x) * (0.75 + 0.25 * crease));
    float facingLight = abs(dot(N, uShadowDirection));
    float petalLight = smoothstep(0.19, 0.86, 0.60 * facingLight + 0.40 * (1.0 - abs(nv)));
    vec3 edgeDye = mix(vec3(0.085, 0.067, 0.162), vec3(0.159, 0.099, 0.147), type);
    color += edgeDye * rim * petalLight * (0.25 + 0.75 * tissue) * incident * (0.27 + 0.73 * crown);
    float facet = max(0.0, dot(face, normalize(V + uShadowDirection)));
    float sheen = pow(facet, 9.0) * (0.34 + 0.66 * pow(max(0.0, crease), 2.0));
    float brightLip = smoothstep(0.60, 0.95, fract(seed * 17.39 + id * 15.31));
    color += incident * rim * rim * sheen * brightLip * (0.26 + 1.16 * crown);

    // Isolated beads on the fold, small enough to disappear into bokeh at a distance.
    vec2 bead = vec2(0.62 + 0.25 * fract(seed * 38.2 + id * 9.7), 0.22 + 0.56 * fract(seed * 24.7 - id * 8.9));
    vec2 d = (uv - bead) / vec2(0.047, 0.096);
    float dew = exp(-dot(d, d)) * smoothstep(0.79, 0.98, fract(seed * 69.95 + id * 19.87));
    color += (eastern + 0.48 * rakingLight) * 1.62 * dew * (0.17 + 0.83 * pow(facet, 6.0));
  } else if (id < 1.5) {
    vec3 pollen = mix(vec3(0.073, 0.040, 0.035), vec3(0.28, 0.178, 0.076), fract(seed * 13.39));
    color = pollen * (fill + 0.22 * incident + 0.73 * reflected);
  } else if (id < 4.0) {
    float midrib = id > 2.5 ? exp(-abs(uv.y - 0.5) * 31.0) : 0.0;
    vec3 leaf = mix(vec3(0.021, 0.026, 0.034), vec3(0.057, 0.065, 0.069), shade);
    color = leaf * (fill + 0.57 * reflected + 0.22 * transmitted);
    color += 0.009 * midrib * incident;
  } else {
    float ripe = smoothstep(0.14, 0.93, fract(seed * 7.31) + 0.21 * (shade - 0.5));
    float ridges = 0.33 + 0.67 * pow(abs(cos(TAU * uv.y)), 1.7);
    float light = 0.23 + 0.77 * abs(nl);
    float vein = sin(PI * uv.x);
    vec3 husk = mix(vec3(0.079, 0.050, 0.076), vec3(0.45, 0.28, 0.14), ripe * ripe);
    color = husk * (0.77 * fill + incident * light * (0.25 + 0.54 * ripe));
    float turn = 0.22 + 0.78 * pow(0.5 + 0.5 * cos(id * 31.9 + seed * 11.83), 1.25);
    color += incident * (0.076 + 0.88 * ripe * ripe) * turn
      * ridges * (0.18 + 0.82 * vein) * (0.22 + 0.78 * crown);
  }
  // Soften the plant surfaces' toe and high end in scene light.
  float value = dot(color, vec3(0.27, 0.60, 0.13));
  float shoulder = 1.0 - 0.14 * smoothstep(0.035, 0.30, value);
  float toe = (1.0 - smoothstep(0.007, 0.063, value)) * travelerContact(vWorld);
  color = color * shoulder + vec3(0.0021, 0.00155, 0.0039) * toe;
  fragColor = vec4(mist(color, vWorld, incident) * uStore, coverage);
}
`;
}

export const plantFragment = plantShader(false);
export const flowerRadianceFragment = plantShader(true);

const suitMaterials = Object.entries(travelerMaterials)
  .map(([name, id]) => `const int MAT_${name.toUpperCase()} = ${id};`).join('\n') + '\n';
const suitCenters = Object.entries(equipmentCenters)
  .map(([name, center]) => `const vec3 ${name.toUpperCase()}_CENTER = vec3(${center.map(v => v.toFixed(6)).join(', ')});`)
  .join('\n') + '\n';

export const suitVertex = header + suitMaterials + suitCenters + `
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aSurface;
layout(location = 3) in float aPart;
uniform mat4 uClip;
uniform vec3 uTraveler;
uniform vec4 uPose[3];
uniform mat4 uArms[6];
out vec3 vWorld;
out vec3 vLocal;
out vec3 vNormal;
out vec3 vSurface;
flat out vec3 vHelmetCenter;
flat out vec3 vPackCenter;

vec2 turn(vec2 p, float angle) {
  float c = cos(angle), s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 posePoint(vec3 rest, int material, float part) {
  float y = rest.y;
  vec3 p = rest;
  bool pressure = material == MAT_PRESSURE;
  float sleeve = 0.0;
  if (pressure) {
    float outward = abs(rest.x);
    float forearm = (1.0 - smoothstep(-0.163, -0.112, rest.z)) * smoothstep(0.155, 0.218, outward);
    float upper = smoothstep(0.257, 0.373, outward);
    sleeve = mix(forearm, upper, smoothstep(1.13, 1.419, y)) * smoothstep(0.834, 0.883, y)
      * (1.0 - smoothstep(1.601, 1.742, y));
    if (abs(part) > 0.5 && abs(part) < 1.5) {
      sleeve = mix(sleeve, 1.0, 1.0 - smoothstep(1.277, 1.391, y));
    }
    if (sleeve > 0.0) {
      int side = rest.x < 0.0 ? 0 : 3;
      vec4 bind = vec4(rest, 1.0);
      vec3 arm = (uArms[side] * bind).xyz;
      vec3 lower = (uArms[side + 1] * bind).xyz;
      vec3 hand = (uArms[side + 2] * bind).xyz;
      float elbow = 1.0 - smoothstep(1.269, 1.409, y);
      float cuff = 1.0 - smoothstep(0.988, 1.121, y);
      p = mix(p, mix(arm, mix(lower, hand, cuff), elbow), sleeve);
    }
  }

  // The shell and its fittings pivot together above the flexible seal.
  bool helmet = part > 1.5 && part < 2.5;
  bool pack = part > 2.5;
  float neck = helmet ? 1.0 : (material == MAT_RUBBER ? smoothstep(1.600, 1.683, y) : 0.0);
  if (neck > 0.0) {
    vec3 center = NECK_CENTER;
    vec3 q = p - center;
    q.yz = turn(q.yz, neck * uPose[1].y);
    q.xz = turn(q.xz, neck * uPose[1].x);
    q.xy = turn(q.xy, neck * uPose[1].z);
    p = center + q;
  }

  float chest = smoothstep(0.91, 1.31, y) * (1.0 - smoothstep(1.49, 1.65, y));
  float breath = uPose[2].x;
  if (!pack) {
    p.x *= 1.0 + 0.009 * breath * chest * (1.0 - sleeve);
    p.z *= 1.0 + 0.029 * breath * chest * (1.0 - sleeve);
  }
  float trunk = pack || helmet ? 1.0 : max(sleeve, smoothstep(0.24, 1.13, y));
  p.y += 0.009 * breath * trunk;
  // The legs absorb the transfer of weight above the planted boots.
  vec3 hips = vec3(0.0, 0.90, -0.019);
  vec3 q = p - hips;
  q.yz = turn(q.yz, trunk * uPose[1].w);
  q.xz = turn(q.xz, trunk * uPose[0].w);
  q.xy = turn(q.xy, trunk * uPose[2].y);
  return q + hips + trunk * uPose[0].xyz;
}

vec3 toWorld(vec3 local) { return 1.085 * local + uTraveler; }

void main() {
  int material = int(aSurface.x + 0.5);
  vec3 local = posePoint(aPosition, material, aPart);
  // Bend the rest tangent plane with the cloth so the light can travel
  // across the changing fold instead of shading its unposed normal.
  vec3 normal = normalize(aNormal);
  vec3 tangent = normalize(cross(normal, abs(normal.y) < 0.92 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 across = cross(normal, tangent);
  vec3 deformedTangent = posePoint(aPosition + tangent * 0.0025, material, aPart) - local;
  vec3 deformedAcross = posePoint(aPosition + across * 0.0025, material, aPart) - local;
  vNormal = normalize(cross(deformedTangent, deformedAcross));
  vHelmetCenter = toWorld(posePoint(HELMET_CENTER, MAT_HELMET, 2.0));
  vPackCenter = toWorld(posePoint(PACK_CENTER, MAT_CERAMIC, 3.0));
  vLocal = aPosition;
  vWorld = toWorld(local);
  vSurface = aSurface;
  gl_Position = uClip * vec4(vWorld, 1.0);
}
`;

export const shadowFragment = header + `
void main() {}
`;

export const suitFragment = header + atmosphere + suitMaterials + `
in vec3 vWorld;
in vec3 vLocal;
in vec3 vNormal;
in vec3 vSurface;
flat in vec3 vHelmetCenter;
flat in vec3 vPackCenter;
uniform sampler2D uEnvironment;
uniform float uEnvironmentWidth;
uniform sampler2D uFlowerMap;
uniform float uFlowerSpan;
uniform sampler2D uSuitPigment;
uniform sampler2D uSuitWeave;
out vec4 fragColor;

vec3 reflectedWorld(vec3 direction, float roughness) {
  vec2 uv = vec2(atan(direction.x, -direction.z) / TAU + 0.5,
    asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5);
  float lod = log2(1.0 + uEnvironmentWidth * 0.29 * roughness * roughness);
  return textureLod(uEnvironment, uv, lod).rgb * 6.0;
}

vec3 meadowReturn(vec3 world, vec3 N) {
  float height = max(0.16, world.y - 0.67);
  float footprint = (0.21 + 0.41 * height) * float(textureSize(uFlowerMap, 0).x) / uFlowerSpan;
  float lod = log2(max(1.0, footprint));
  vec3 sum = vec3(0.0);
  const vec2 azimuth[6] = vec2[6](vec2(0.966, 0.259), vec2(0.259, 0.966),
    vec2(-0.707, 0.707), vec2(-0.966, -0.259), vec2(-0.259, -0.966), vec2(0.707, -0.707));
  for (int i = 0; i < 6; i++) {
    vec2 offset = azimuth[i] * (1.44 * height);
    vec2 uv = (world.xz - uTraveler.xz + offset) / uFlowerSpan + 0.5;
    vec3 L = vec3(0.821 * azimuth[i].x, -0.570, 0.821 * azimuth[i].y);
    sum += textureLod(uFlowerMap, uv, lod).rgb * max(0.0, dot(N, L));
  }
  return sum * (TAU / 6.0);
}

vec3 fabricNormal(vec3 n, float relief) {
  vec3 dx = dFdx(vWorld), dy = dFdy(vWorld);
  vec3 tx = cross(dy, n), ty = cross(n, dx);
  float det = dot(dx, tx);
  vec3 slope = (dFdx(relief) * tx + dFdy(relief) * ty) * sign(det) / max(0.000001, abs(det));
  return normalize(n - slope / max(1.0, length(slope) * 3.4));
}

float blockedSky(vec3 pos, vec3 normal, vec3 center, float radius) {
  vec3 delta = center - pos;
  float d2 = max(0.0001, dot(delta, delta));
  return min(0.94, radius * radius / d2) * smoothstep(-0.12, 0.85, dot(normal, delta * inversesqrt(d2)));
}

float diskFacet(vec3 N, vec3 V, vec3 R, vec3 L, float halfWidth) {
  vec3 tangent = normalize(cross(L, vec3(0.0, 1.0, 0.0)));
  float along = clamp(dot(R, tangent) / max(0.16, dot(R, L)), -halfWidth, halfWidth);
  vec3 closest = normalize(L + tangent * along);
  return max(0.0, dot(N, normalize(closest + V)));
}

vec3 reflectedLimb(vec3 R, vec3 N, vec3 V, vec3 background) {
  vec3 axis = normalize(HOLE);
  vec3 east = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(east, axis);
  vec2 around = vec2(dot(R, east), dot(R, up));
  if (dot(R, axis) < 0.74 || around.y < -0.055) return vec3(0.0);
  vec2 radial = around / max(0.0001, length(around));
  vec3 across = east * radial.x + up * radial.y;
  vec3 source = normalize(axis + (1.248 * SHADOW_RADIUS) * across);
  vec3 H = normalize(V + source);
  // The thin lensed image occupies only a fraction of a glossy footprint at
  // grazing incidence. Integrate its unresolved width in half-vector space.
  float width = 0.085;
  float overlap = exp(-dot(N - H, N - H) / squared(width));
  vec3 radiance = reflectedWorld(source, 0.080) * 0.6
    + reflectedWorld(normalize(axis + (1.128 * SHADOW_RADIUS) * across), 0.085) * 0.4;
  return max(vec3(0.0), radiance - background) * overlap;
}

vec3 crownReflection(vec3 N, vec3 V) {
  if (N.y < 0.61) return vec3(0.0);
  vec3 axis = normalize(HOLE);
  vec3 east = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(east, axis);
  vec3 collected = vec3(0.0);
  // Integrate the narrow upper arc over the rough outer coating. Its
  // meridional footprint is stretched at grazing incidence on the dome.
  for (int k = 0; k < 5; k++) {
    float angle = 1.43 + 0.078 * float(k);
    vec3 radial = cos(angle) * east + sin(angle) * up;
    vec3 L = normalize(axis + (1.256 * SHADOW_RADIUS) * radial);
    vec3 H = normalize(V + L);
    vec3 t = normalize(cross(H, V));
    vec3 b = cross(t, H);
    float lobe = exp(-squared(dot(N, t) / 0.065) - squared(dot(N, b) / 0.109));
    collected += lobe * reflectedWorld(L, 0.084);
  }
  return 0.84 * collected;
}

vec3 duskReflection(vec3 R) {
  // The raised, rougher part of the coating picks up a broad portion
  // of the real evening sky around the narrow disk reflection.
  vec3 direction = normalize(vec3(-0.61, 0.57, 0.49));
  float width = smoothstep(0.16, 0.94, dot(R, direction));
  float elevation = smoothstep(0.095, 0.46, R.y);
  return reflectedWorld(R, 0.57) * width * elevation * vec3(0.79, 0.95, 1.17);
}

void main() {
  int mat = int(vSurface.x + 0.5);
  vec3 V = normalize(uEye - vWorld);
  vec3 N = normalize(vNormal);
  vec3 p = vLocal;
  bool pressure = mat == MAT_PRESSURE;
  vec3 pigment = vec3(0.0);
  float sourceShade = 0.0;
  float weave = 0.0;
  if (pressure) {
    pigment = texture(uSuitPigment, vSurface.yz).rgb;
    sourceShade = dot(pigment, vec3(0.2126, 0.7152, 0.0722));
    weave = texture(uSuitWeave, vSurface.yz).r - 0.5;
  }
  bool textile = pressure || mat == MAT_HARNESS;
  bool ceramic = mat == MAT_HELMET || mat == MAT_CERAMIC;
  bool metal = mat == MAT_ALLOY || mat == MAT_BRONZE;
  bool soft = mat == MAT_RUBBER || mat == MAT_HOSE || mat == MAT_SEAL;
  float pixel = length(fwidth(p));
  float resolve = 1.0 - smoothstep(0.0033, 0.017, pixel);
  float cloud = noise2(p.xy * vec2(0.55, 0.80) + vec2(0.19, 0.37) * p.z);
  float scuff = noise2(p.xz * vec2(0.97, 1.36) + p.y * vec2(-0.29, 0.82));
  float grain = noise2(p.xy * 2.21 + vec2(p.z * 0.73, -p.z * 1.61));
  float strands = sin(dot(p, vec3(253.0, 38.0, 106.0))) * sin(dot(p, vec3(-37.0, 294.0, 68.0)));
  float relief = (cloud - 0.5) * 0.0025 + (scuff - 0.5) * 0.0009
    + (strands * 0.00040 + weave * 0.0016) * resolve;
  if (textile) N = fabricNormal(N, relief);
  if (ceramic) N = fabricNormal(N, (scuff - 0.5) * 0.0018 + (grain - 0.5) * resolve * 0.0010);
  float nv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - nv, 4.7);
  vec3 R = reflect(-V, N);

  vec2 visibility = diskVisibility(vWorld + N * 0.0040, 0.00028);
  float canopy = mix(canopyVisibility(vWorld), 1.0, smoothstep(0.60, 1.26, p.y));
  vec3 eastern = diskLight() * visibility.x * canopy;
  vec3 rakingLight = horizonLight() * visibility.y * (0.33 + 0.67 * canopy);
  vec3 sky = domeLight();
  vec3 meadow = meadowReturn(vWorld, N);
  vec3 upper = normalize(0.54 * N + vec3(-0.30, 0.77, 0.25));
  vec3 upperSky = reflectedWorld(upper, 0.91);
  float occlusion = 1.0;
  if (p.y < 1.73) {
    occlusion -= 0.68 * blockedSky(vWorld, upper, vHelmetCenter, 0.188);
    if ((textile || soft) && p.z < 0.225) {
      vec3 openBack = normalize(0.72 * N + vec3(0.0, 0.21, 0.48));
      occlusion *= 1.0 - 0.62 * blockedSky(vWorld, openBack, vPackCenter, 0.138);
    }
  }
  float up = smoothstep(-0.40, 0.83, N.y);
  float twilightSide = max(0.0, dot(N, normalize(vec3(-0.79, 0.59, 0.26))));
  float aboveFlowers = smoothstep(0.36, 1.08, p.y);
  vec3 indirect = (sky * (0.65 + 1.55 * up) + upperSky * (0.82 + 1.12 * twilightSide)) * occlusion
    + (0.72 * fieldBounce() + 1.51 * meadow) * aboveFlowers;
  float eastCos = dot(N, uShadowDirection);
  float rakeCos = dot(N, uSideDirection);
  float liftEast = max(0.0, (eastCos + 0.084) / 1.084);
  float liftSide = max(0.0, (rakeCos + 0.139) / 1.139);
  vec3 direct = eastern * liftEast + rakingLight * liftSide;
  float reflectEast = diskFacet(N, V, R, uShadowDirection, 0.23);
  float reflectSide = diskFacet(N, V, R, uSideDirection, 0.375);

  vec3 base = vec3(0.053, 0.052, 0.077);
  float roughness = 0.73;
  if (mat == MAT_PRESSURE) {
    float thermal = smoothstep(0.008, 0.67, pow(sourceShade, 0.71));
    base = mix(vec3(0.041, 0.038, 0.048), vec3(0.377, 0.349, 0.313), thermal);
    base += (pigment - vec3(sourceShade)) * 0.21;
    float yoke = smoothstep(1.39, 1.54, p.y) * smoothstep(0.025, 0.16, p.z)
      * (1.0 - smoothstep(0.18, 0.34, abs(p.x)));
    base *= 1.0 - 0.34 * yoke;
    roughness = mix(0.56, 0.80, thermal);
  }
  if (mat == MAT_HARNESS) base = vec3(0.072, 0.068, 0.079);
  if (soft) {
    base = mat == MAT_SEAL ? vec3(0.025, 0.022, 0.029) : vec3(0.035, 0.036, 0.045);
    roughness = mat == MAT_HOSE ? 0.63 : 0.56;
  }
  if (mat == MAT_RUBBER) {
    float gasket = smoothstep(1.592, 1.682, p.y);
    base = mix(vec3(0.072, 0.065, 0.072), vec3(0.029, 0.028, 0.034), gasket);
    roughness = mix(0.72, 0.58, gasket);
  }
  if (mat == MAT_GRAPHITE) {
    base = vec3(0.041, 0.050, 0.062);
    roughness = 0.46 + 0.19 * cloud;
  }
  if (metal) {
    base = mat == MAT_BRONZE ? vec3(0.229, 0.115, 0.061) : vec3(0.127, 0.109, 0.091);
    roughness = mat == MAT_BRONZE ? 0.39 : 0.31 + 0.12 * scuff;
  }

  float wear = 0.52 * cloud + 0.35 * scuff + 0.13 * grain;
  if (ceramic) {
    base = mat == MAT_HELMET ? vec3(0.273, 0.291, 0.316) : vec3(0.251, 0.257, 0.256);
    base *= 0.72 + 0.40 * wear + 0.19 * smoothstep(0.39, 0.72, scuff);
    roughness = 0.41 + 0.28 * wear;
  }
  if (mat == MAT_HELMET) {
    float nape = smoothstep(0.048, 0.129, p.z);
    float split = p.y - (1.771 + 1.775 * p.x * p.x + 0.030 * p.x);
    float width = length(vec2(0.0026, 0.55 * fwidth(split)));
    float seam = exp(-squared(split / width)) * (0.0026 / width);
    base *= 1.0 - nape * (0.28 * (1.0 - smoothstep(-0.006, 0.004, split)) + 0.52 * seam);
    roughness += 0.12 * nape * (1.0 - smoothstep(-0.004, 0.018, split));
  }
  if (textile) {
    base *= 0.77 + 0.49 * cloud + 0.11 * scuff + 0.063 * resolve * strands;
  }

  float lower = 0.49 + 0.51 * smoothstep(0.43, 1.06, p.y);
  vec3 color = base * (indirect + direct) * lower;
  vec3 env = reflectedWorld(R, roughness);
  if (metal) {
    color = base * (0.41 * direct + 0.53 * indirect) * lower
      + (0.22 + 0.35 * fresnel) * env * mix(vec3(0.75, 0.74, 0.72), 2.2 * base, 0.58)
        * (0.28 + 0.72 * occlusion)
      + (eastern * pow(reflectEast, 20.0) + rakingLight * pow(reflectSide, 19.0)) * (0.17 + 0.54 * base);
  } else {
    float coat = ceramic ? 0.020 + 0.088 * fresnel : 0.011 + (textile ? 0.024 : 0.10) * fresnel;
    color += env * coat * (0.38 + 0.62 * occlusion) * lower;
    if (textile || mat == MAT_HOSE) {
      float velvet = pow(reflectSide, 7.7) * smoothstep(-0.47, 0.51, rakeCos);
      vec3 reflected = eastern * pow(reflectEast, 13.0) + rakingLight * velvet;
      color += reflected * (0.042 + 0.073 * fresnel) * (0.49 + 0.76 * scuff) * lower;
      color += meadow * vec3(0.081, 0.067, 0.087) * aboveFlowers;
      if (pressure) {
        // Grazing light reveals the curved knuckles of the dark gauntlets.
        float gauntlet = (1.0 - smoothstep(0.056, 0.15, sourceShade))
          * smoothstep(0.19, 0.29, abs(p.x)) * smoothstep(0.85, 0.92, p.y)
          * (1.0 - smoothstep(1.14, 1.25, p.y)) * (1.0 - smoothstep(-0.14, -0.082, p.z));
        color += gauntlet * (0.038 * env + (0.022 + 0.091 * fresnel) * reflected);
      }
    }
    if (ceramic) {
      vec3 satin = (eastern * pow(reflectEast, 18.0) + rakingLight * pow(reflectSide, 13.0))
        * (0.024 + 0.035 * scuff) * (0.45 + 0.55 * occlusion);
      color += satin;
      if (mat == MAT_HELMET) {
        color += reflectedLimb(R, N, V, env * 0.62) * (0.026 + 0.15 * fresnel);
        color += crownReflection(N, V) * (0.028 + 0.184 * fresnel);
      }
    }
  }

  if (mat == MAT_VISOR) {
    vec3 outer = reflectedWorld(R, 0.107 + 0.044 * scuff);
    float smoked = smoothstep(1.75, 1.98, p.y);
    vec3 gilding = vec3(1.18, 0.84, 0.48);
    color = mix(vec3(0.019, 0.012, 0.018), vec3(0.041, 0.027, 0.017), smoked);
    color += outer * gilding * (0.075 + 0.73 * fresnel);
    color += duskReflection(R) * 0.29;
    color += reflectedLimb(R, N, V, outer * 0.61) * (0.16 + 0.89 * fresnel);
    color += crownReflection(N, V) * (0.21 + 0.77 * fresnel);
  }
  if (mat == MAT_INDICATOR) {
    color = vec3(1.21, 0.53, 0.155) * (0.81 + 0.19 * pow(nv, 3.0)) * (0.97 + 0.03 * sin(uTime * 1.1));
  }
  fragColor = vec4(mist(color, vWorld, eastern + rakingLight) * uStore, 1.0);
}
`;

export const pollenVertex = header + `
layout(location = 0) in vec4 aPollen;
layout(location = 1) in float aSize;
uniform mat4 uClip;
uniform float uTime;
uniform float uAspectPixels;
out vec2 vLight;

void main() {
  float id = aPollen.w;
  float time = uTime * (0.27 + 0.33 * id);
  vec3 world = aPollen.xyz + vec3(
    sin(time + id * 103.0) * 0.89,
    cos(time + id * 76.0) * 0.33,
    sin(time * 0.61 - id * 41.0) * 0.56
  );
  vec4 clip = uClip * vec4(world, 1.0);
  float twinkle = smoothstep(-0.7, 1.0, sin(time * 2.71 + id * 55.0));
  gl_PointSize = clamp(aSize * uAspectPixels / max(clip.w, 1.3), 1.4, 7.0);
  vLight = vec2(twinkle * (1.0 - smoothstep(11.0, 48.0, clip.w)), id);
  gl_Position = clip;
}
`;

export const pollenFragment = header + `
in vec2 vLight;
uniform float uStore;
out vec4 fragColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float brightness = exp(-d * d * 5.4) * (1.0 - smoothstep(0.65, 1.0, d)) * vLight.x;
  vec3 color = mix(vec3(0.71, 0.41, 0.17), vec3(0.86, 0.65, 0.92), vLight.y * vLight.y);
  fragColor = vec4(brightness * color * uStore * 0.26, 0.0);
}
`;

const lensDepth = `
uniform sampler2D uDepth;
uniform vec2 uPlanes;
float depthAt(vec2 uv) {
  float z = textureLod(uDepth, uv, 0.0).r;
  return (uPlanes.x * uPlanes.y) / mix(uPlanes.y, uPlanes.x, z);
}
`;

const optics = lensDepth + `
uniform vec2 uPixel;
uniform float uLensFocus;
uniform float uLensBlurScale;
const float MAX_NEAR = 5.0;

// Signed circle radius at 900 lines. The sky has a narrow residual blur
// so the disk filaments and their wider atmospheric glow read separately.
float circleOfConfusion(float distance) {
  float error = 1.0 / uLensFocus - 1.0 / distance;
  float sky = smoothstep(uPlanes.y * 0.70, uPlanes.y * 0.97, distance);
  if (error < 0.0) return -MAX_NEAR * (1.0 - exp(error * 132.0 / MAX_NEAR));
  return mix(min(2.75, error * 58.0), 1.45, sky);
}

float lensPixels() { return uLensBlurScale / (900.0 * uPixel.y); }

vec2 pupil(vec2 ray, vec2 uv) {
  vec2 axis = (uv - 0.5) * vec2(1.18, 1.0);
  float eccentricity = length(axis);
  axis /= max(eccentricity, 0.0001);
  float clip = 0.26 * smoothstep(0.17, 0.74, eccentricity);
  return (ray - axis * (dot(axis, ray) * clip)) * vec2(1.085, 0.95);
}
`;

function apertureDisk(count) {
  const points = Array.from({ length: count }, (_, i) => {
    const r = Math.sqrt((i + 0.45) / count);
    const theta = i * Math.PI * (3 - Math.sqrt(5));
    return `vec2(${(Math.cos(theta) * r).toFixed(5)}, ${(Math.sin(theta) * r).toFixed(5)})`;
  });
  return `const int TAPS = ${count};\nconst vec2 disk[TAPS] = vec2[TAPS](${points.join(', ')});\n`;
}

export const lensPrefilterFragment = header + optics + `
in vec2 vUV;
uniform sampler2D uImage;
out vec4 fragColor;

void main() {
  vec3 color = vec3(0.0);
  float nearSum = 0.0;
  float nearMax = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 offset = vec2(float(i & 1), float(i >> 1)) - 0.5;
    vec2 uv = vUV + offset * uPixel;
    color += textureLod(uImage, uv, 0.0).rgb;
    float radius = max(0.0, -circleOfConfusion(depthAt(uv)));
    nearSum += radius;
    nearMax = max(nearMax, radius);
  }
  fragColor = vec4(color * 0.25, mix(nearSum * 0.25, nearMax, 0.28) / MAX_NEAR);
}
`;

export function foregroundLensFragment(economy) {
  return header + optics + apertureDisk(economy ? 24 : 42) + `
in vec2 vUV;
uniform sampler2D uPrefiltered;
out vec4 fragColor;

void main() {
  // Look beyond the current pixel: a defocused blossom covers part of the
  // sharper layer behind its silhouette, including the traveler's suit.
  vec2 probe = uPixel * MAX_NEAR * lensPixels() * 0.63;
  float support = textureLod(uPrefiltered, vUV, 0.0).a;
  support = max(support, textureLod(uPrefiltered, vUV + probe, 0.0).a);
  support = max(support, textureLod(uPrefiltered, vUV - probe, 0.0).a);
  support = max(support, textureLod(uPrefiltered, vUV + vec2(probe.x, -probe.y), 0.0).a);
  support = max(support, textureLod(uPrefiltered, vUV + vec2(-probe.x, probe.y), 0.0).a);
  float search = support * MAX_NEAR * lensPixels();
  if (search < 1.45) { fragColor = vec4(0.0); return; }
  search += 0.6;

  vec3 energy = vec3(0.0);
  float coverage = 0.0;
  for (int i = 0; i < TAPS; i++) {
    vec2 ray = disk[i];
    vec4 tap = textureLod(uPrefiltered, vUV + pupil(ray, vUV) * uPixel * search, 0.0);
    float radius = tap.a * MAX_NEAR * lensPixels();
    float area = search * search / max(2.25, radius * radius);
    float weight = min(6.0, area) * smoothstep(-0.78, 0.78, radius - search * length(ray))
      * smoothstep(1.4, 3.9, radius);
    energy += tap.rgb * weight;
    coverage += weight;
  }
  float alpha = min(1.0, coverage / float(TAPS));
  fragColor = vec4(energy * alpha / max(coverage, 0.0001), alpha);
}
`;
}

export function lensFragment(economy) {
  return header + optics + apertureDisk(economy ? 18 : 30) + `
in vec2 vUV;
uniform sampler2D uImage;
uniform sampler2D uPrefiltered;
uniform sampler2D uForeground;
out vec4 fragColor;

void main() {
  vec4 foreground = textureLod(uForeground, vUV, 0.0);
  vec3 center = textureLod(uImage, vUV, 0.0).rgb;
  float depth = depthAt(vUV);
  float coc = circleOfConfusion(depth) * lensPixels();
  float radius = abs(coc);
  vec3 image = center;
  if (foreground.a < 0.985 && radius > 0.50) {
    float prefilter = smoothstep(2.15, 4.65, radius);
    float weights = mix(1.12, 0.28, prefilter);
    vec3 sum = center * weights;
    for (int i = 0; i < TAPS; i++) {
      vec2 ray = disk[i];
      vec2 uv = vUV + uPixel * radius * pupil(ray, vUV);
      float tapDepth = depthAt(uv);
      float nearer = max(0.0, (depth - tapDepth) / depth);
      float farther = max(0.0, (tapDepth - depth) / depth);
      float weight = (1.03 - 0.19 * dot(ray, ray)) * (1.0 - 0.68 * smoothstep(0.07, 0.32, farther));
      if (coc > 0.0) weight *= 1.0 - 0.97 * smoothstep(0.055, 0.19, nearer);
      vec3 sampleColor = textureLod(uImage, uv, 0.0).rgb;
      if (prefilter > 0.01) sampleColor = mix(sampleColor, textureLod(uPrefiltered, uv, 0.0).rgb, prefilter);
      sum += sampleColor * weight;
      weights += weight;
    }
    image = mix(center, sum / weights, smoothstep(0.48, 2.48, radius));
  }
  fragColor = vec4(image * (1.0 - foreground.a) + foreground.rgb, 1.0);
}
`;
}

export const bloomFragment = header + `
in vec2 vUV;
uniform sampler2D uImage;
uniform vec2 uStep;
uniform float uThreshold;
uniform float uStore;
out vec4 fragColor;
const float BLOOM_STORE = 0.28;

vec3 sampleLight(vec2 uv) {
  vec3 value = textureLod(uImage, uv, 0.0).rgb;
  if (uThreshold < 0.5) return value;
  float top = max(max(value.r, value.g), value.b);
  return value * smoothstep(0.24 * uStore, 1.38 * uStore, top) * (BLOOM_STORE / uStore);
}

void main() {
  vec3 bloom = sampleLight(vUV) * 0.227027;
  bloom += (sampleLight(vUV + uStep * 1.384615) + sampleLight(vUV - uStep * 1.384615)) * 0.316216;
  bloom += (sampleLight(vUV + uStep * 3.230769) + sampleLight(vUV - uStep * 3.230769)) * 0.070270;
  fragColor = vec4(bloom, 1.0);
}
`;

// The wider lobe of the point spread function includes the low-luminance
// meadow. It is filtered in linear light, before the print curve and grain.
export const lensDiffusionFragment = header + `
in vec2 vUV;
uniform sampler2D uImage;
uniform vec2 uPixel;
out vec4 fragColor;
void main() {
  vec2 pitch = uPixel * clamp(1.0 / (960.0 * uPixel.y), 0.57, 2.7);
  vec2 a = vec2(2.34, 0.78) * pitch;
  vec2 b = vec2(-0.80, 2.12) * pitch;
  vec3 sum = textureLod(uImage, vUV, 0.0).rgb * 0.20;
  sum += (textureLod(uImage, vUV + a, 0.0).rgb + textureLod(uImage, vUV - a, 0.0).rgb
    + textureLod(uImage, vUV + b, 0.0).rgb + textureLod(uImage, vUV - b, 0.0).rgb) * 0.13;
  sum += (textureLod(uImage, vUV + a + b, 0.0).rgb + textureLod(uImage, vUV + a - b, 0.0).rgb
    + textureLod(uImage, vUV - a + b, 0.0).rgb + textureLod(uImage, vUV - a - b, 0.0).rgb) * 0.07;
  fragColor = vec4(sum, 1.0);
}
`;

export const finishFragment = header + lensDepth + `
in vec2 vUV;
uniform sampler2D uImage;
uniform sampler2D uDiffusion;
uniform sampler2D uBloom0;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform sampler2D uBloom3;
uniform vec2 uPixel;
uniform vec3 uMeadowProjection;
uniform float uTime;
uniform float uStore;
out vec4 fragColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float luma(vec3 rgb) {
  return dot(rgb, vec3(0.27, 0.62, 0.11));
}

vec3 scene(vec2 uv) {
  return textureLod(uImage, uv, 0.0).rgb;
}

void main() {
  vec2 field = (vUV - 0.5) * vec2(1.12, 0.90);
  float eccentricity = smoothstep(0.08, 0.68, length(field));
  vec2 axis = length(field) > 0.0001 ? normalize(field) : vec2(1.0, 0.0);
  vec2 pitch = uPixel * clamp(1.0 / (960.0 * uPixel.y), 0.57, 2.7);
  vec2 wide = pitch * axis * (0.99 + 0.63 * eccentricity);
  vec2 narrow = pitch * vec2(-axis.y, axis.x) * (0.92 + 0.15 * eccentricity);
  vec3 directImage = scene(vUV);
  vec3 core = directImage * 0.19;
  core += (scene(vUV + wide) + scene(vUV - wide) + scene(vUV + narrow) + scene(vUV - narrow)) * 0.135;
  core += (scene(vUV + wide + narrow) + scene(vUV + wide - narrow)
    + scene(vUV - wide + narrow) + scene(vUV - wide - narrow)) * 0.0675;
  vec3 shoulder = textureLod(uDiffusion, vUV, 0.0).rgb;
  // A small asymmetric tail off-axis. Warm pin lights scatter a little
  // farther into shadow; uniform patches retain exactly the same exposure.
  vec3 tail = textureLod(uDiffusion, vUV - wide * (1.4 + eccentricity), 0.0).rgb * 0.44
    + textureLod(uDiffusion, vUV + wide * 1.74 + narrow * 1.2, 0.0).rgb * 0.28
    + textureLod(uDiffusion, vUV + wide * 1.74 - narrow * 1.2, 0.0).rgb * 0.28;
  vec3 rgb = mix(core, shoulder, 0.18 + 0.045 * eccentricity);
  rgb = mix(rgb, tail, vec3(0.15, 0.105, 0.092));
  float distance = depthAt(vUV);
  float worldY = uMeadowProjection.x + distance * (uMeadowProjection.y + (2.0 * vUV.y - 1.0) * uMeadowProjection.z);
  float meadow = (1.0 - smoothstep(0.91, 1.24, worldY)) * (1.0 - smoothstep(68.0, 175.0, distance));
  rgb = mix(rgb, directImage, mix(0.36, 0.23, eccentricity) * (1.0 - 0.16 * meadow));
  rgb = mix(rgb, shoulder, 0.093 * meadow);
  vec3 bloom = textureLod(uBloom0, vUV, 0.0).rgb * 0.17 + textureLod(uBloom1, vUV, 0.0).rgb * 0.14;
  bloom += textureLod(uBloom2, vUV, 0.0).rgb * 0.17 + textureLod(uBloom3, vUV, 0.0).rgb * 0.22;
  rgb += bloom * (uStore / 0.28);
  vec2 frame = (vUV - 0.5) * vec2(1.06, 0.88);
  float falloff = 1.0 - 0.34 * smoothstep(0.22, 0.69, length(frame));
  vec3 color = (rgb / uStore) * 1.16 * falloff;
  float toe = 0.73 + 0.27 * smoothstep(0.014, 0.20, luma(color));
  color = color * toe * (1.0 + min(color, vec3(5.0)) * 0.021) / (1.0 + color);
  color = mix(12.92 * color, 1.055 * pow(max(vec3(0.0), color), vec3(1.0 / 2.4)) - 0.055,
    step(vec3(0.0031308), color));
  float grain = hash(gl_FragCoord.xy + 11.0 * floor(uTime * 12.0)) - 0.5;
  float filmGrain = 0.0049 + 0.0048 * smoothstep(0.48, 0.94, 1.0 - vUV.y);
  color += grain * filmGrain;
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

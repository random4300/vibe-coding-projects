export const TAU = 2 * Math.PI;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const scale = (v, k) => v.map(x => x * k);
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const unit = (v) => scale(v, 1 / (Math.hypot(...v) || 1));

export function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function cameraFor(eye, yaw, pitch, aspect, viewScale = 1) {
  const forward = [
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
  const right = [Math.cos(yaw), 0, Math.sin(yaw)];
  const up = cross(right, forward);
  const nh = 0.18;
  const fh = 580;
  const vertical = Math.max(0.252, 0.183 / aspect) * viewScale;
  const horizontal = vertical * aspect;
  const zScale = (fh + nh) / (fh - nh);
  const zOffset = -2 * fh * nh / (fh - nh);
  const clip = new Float32Array(16);
  for (let i = 0; i < 3; i++) {
    clip[i * 4] = right[i] / horizontal;
    clip[i * 4 + 1] = up[i] / vertical;
    clip[i * 4 + 2] = forward[i] * zScale;
    clip[i * 4 + 3] = forward[i];
  }
  clip[12] = -dot(right, eye) / horizontal;
  clip[13] = -dot(up, eye) / vertical;
  clip[14] = zOffset - dot(forward, eye) * zScale;
  clip[15] = -dot(forward, eye);
  return { eye, forward, right, up, horizontal, vertical, clip, near: nh, far: fh };
}

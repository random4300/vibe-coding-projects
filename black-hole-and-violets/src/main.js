import { cameraFor, clamp, lerp } from './math.js';
import { HorizonRenderer } from './renderer.js';

const canvas = document.getElementById('world');
const failure = document.getElementById('error');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobile = matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
const quality = new URLSearchParams(location.search).get('quality');
const economy = quality === 'low' || (quality !== 'high' && mobile);
const adaptive = quality !== 'high' && quality !== 'low';
const eye = [0.0, 3.02, -0.80];
const touches = new Map();

let lens = 1.06;
let goal = lens;
let renderer;
let assets;
let frameRequest = 0;
let time = 0;
let previousFrame = 0;
let scale = 1;
let meanFrame = 16.7;
let qualityCheck = 0;

function zoom(amount) {
  goal = clamp(goal * Math.exp(amount), 0.775, 1.31);
}

function schedule() {
  if (renderer && !frameRequest && !document.hidden) frameRequest = requestAnimationFrame(render);
}

function render(now) {
  frameRequest = 0;
  if (!renderer || document.hidden) return;
  const interval = previousFrame ? now - previousFrame : 16.7;
  previousFrame = now;
  const dt = Math.min(interval / 1000, 0.05);
  const calm = reducedMotion.matches;
  time += dt * (calm ? 0.60 : 1);
  if (adaptive) {
    meanFrame = lerp(meanFrame, interval, 0.045);
    if (now - qualityCheck > 2100) {
      if (meanFrame > 24 && scale > 0.64) scale = Math.max(0.64, scale * 0.88);
      else if (meanFrame < 17.7 && scale < 1) scale = Math.min(1, scale + 0.075);
      qualityCheck = now;
    }
  }

  const wide = Math.max(1, canvas.clientWidth);
  const tall = Math.max(1, canvas.clientHeight);
  const budget = economy ? 1_050_000 : 2_520_000;
  const ratio = Math.min(devicePixelRatio || 1, economy ? 1.45 : 1.65, Math.sqrt(budget / (wide * tall)),
    renderer.limit / Math.max(wide, tall)) * scale;
  const width = Math.max(2, Math.round(wide * ratio));
  const height = Math.max(2, Math.round(tall * ratio));

  const next = lerp(lens, goal, 1 - Math.exp(-dt * 7.1));
  lens = calm || Math.abs(next - goal) < 0.00015 ? goal : next;
  const aspect = wide / tall;
  const portrait = clamp((1.10 - aspect) / 0.55, 0, 1);
  const viewScale = 1.06 + (lens - 1.06) * (1 - portrait * 0.28);
  const camera = cameraFor(eye, 0.005 - portrait * 0.036, 0.009, aspect, viewScale);
  try {
    renderer.resize(width, height);
    renderer.draw(camera, time, !adaptive || scale > 0.79);
  } catch (error) {
    if (!renderer.gl.isContextLost()) showError(error);
    return;
  }
  if (canvas.dataset.ready !== 'true') {
    canvas.dataset.ready = 'true';
    canvas.removeAttribute('aria-busy');
  }
  schedule();
}

function showError(error, detail = '场景需要支持 WebGL 2 的浏览器。请确认浏览器已启用硬件加速，然后重新加载。') {
  console.error(error);
  delete canvas.dataset.ready;
  canvas.removeAttribute('aria-busy');
  failure.textContent = detail;
  failure.hidden = false;
  renderer = null;
}

async function sceneImage(name) {
  const image = new Image();
  image.src = new URL('../assets/' + name, import.meta.url).href;
  await image.decode();
  return image;
}

async function initialize() {
  if (!assets) {
    try {
      const geometry = fetch(new URL('../assets/eva-body.bin', import.meta.url)).then(response => {
        if (!response.ok) throw new Error('The pressure suit mesh could not be loaded');
        return response.arrayBuffer();
      });
      const names = ['viola-petals.png', 'viola-blossoms.png', 'interstellar-dust.png', 'eva-fabric.webp', 'eva-weave.webp'];
      const [petals, blossoms, dust, pigment, weave, body] = await Promise.all([...names.map(sceneImage), geometry]);
      assets = { petals, blossoms, dust, pigment, weave, body };
    } catch (error) {
      showError(error, '场景材质加载失败。请检查项目资源后重新加载。');
      return;
    }
  }
  try {
    renderer = new HorizonRenderer(canvas, economy, assets);
    failure.hidden = true;
    previousFrame = 0;
    schedule();
  } catch (error) {
    showError(error);
  }
}

canvas.addEventListener('wheel', event => {
  if (!renderer) return;
  event.preventDefault();
  const unit = event.deltaMode === 0 ? 1 : (event.deltaMode === 1 ? 18 : innerHeight);
  zoom(clamp(event.deltaY * unit * 0.00086, -0.28, 0.28));
}, { passive: false });

window.addEventListener('keydown', event => {
  if (!renderer || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === '+' || event.key === '=') zoom(-0.115);
  else if (event.key === '-') zoom(0.115);
  else return;
  event.preventDefault();
});

canvas.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'touch' || !renderer) return;
  touches.set(event.pointerId, [event.clientX, event.clientY]);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  const before = touches.get(event.pointerId);
  if (!before) return;
  const after = [event.clientX, event.clientY];
  if (touches.size === 2) {
    const other = [...touches.entries()].find(([id]) => id !== event.pointerId)[1];
    const previousSpan = Math.hypot(before[0] - other[0], before[1] - other[1]);
    const span = Math.hypot(after[0] - other[0], after[1] - other[1]);
    if (previousSpan > 6 && span > 6) zoom(Math.log(previousSpan / span));
  }
  touches.set(event.pointerId, after);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, event => touches.delete(event.pointerId));
}

document.addEventListener('visibilitychange', () => {
  previousFrame = 0;
  if (document.hidden) touches.clear();
  schedule();
});
window.addEventListener('resize', schedule);
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  renderer = null;
  touches.clear();
  delete canvas.dataset.ready;
  canvas.setAttribute('aria-busy', 'true');
});
canvas.addEventListener('webglcontextrestored', initialize);

requestAnimationFrame(() => requestAnimationFrame(initialize));

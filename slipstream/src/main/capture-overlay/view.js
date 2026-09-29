'use strict';
const selection = document.getElementById('selection');
const dim = document.getElementById('dim');
const pointer = document.getElementById('pointer');
let origin = null;
let rect = null;
let submitted = false;
const point = event => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
const cancel = () => { if (!submitted) { submitted = true; void window.captureOverlay.act('cancel'); } };
document.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
document.addEventListener('contextmenu', event => { event.preventDefault(); cancel(); });
document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || submitted) return;
  origin = point(event); rect = null;
  document.body.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove', event => {
  const current = point(event);
  pointer.style.left = `${current.x}px`; pointer.style.top = `${current.y}px`;
  if (!origin || submitted) return;
  rect = { x: Math.min(origin.x, current.x), y: Math.min(origin.y, current.y), width: Math.abs(current.x - origin.x), height: Math.abs(current.y - origin.y) };
  selection.hidden = false; dim.hidden = true;
  Object.assign(selection.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.getElementById('size').textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
});
document.addEventListener('pointerup', async event => {
  if (!origin || event.button !== 0 || submitted) return;
  origin = null;
  if (!rect || rect.width < 8 || rect.height < 8) { selection.hidden = true; dim.hidden = false; return; }
  submitted = true;
  try { if (!await window.captureOverlay.act('select', rect)) submitted = false; }
  catch { submitted = false; }
});
window.captureOverlay.act('ready').then(({ image }) => {
  const screenImage = document.getElementById('screen');
  screenImage.onload = () => void window.captureOverlay.act('visible');
  screenImage.src = image;
}).catch(cancel);

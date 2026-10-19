// La isla: la cápsula de estado del centro de la barra (el PC500) que se
// transforma en los avisos y vuelve, como la Dynamic Island.
//
// Es un phase morph (PLAN_DISENO.md, sección 2): ancho y alto son dos springs
// con duraciones distintas. Al abrirse lidera el ancho y lo sigue el alto; al
// cerrarse, al revés. El radio sale del alto en cada cuadro (cápsula hasta
// 22 px). Los dos springs se redirigen sin saltos si llega otro aviso a mitad
// de camino. El contenido cruza en CSS: el estado se va en el primer tramo y
// el mensaje entra en el último.

import { SpringValue, fromDurationBounce } from './springs.js';

const OPEN_WIDTH = fromDurationBounce(0.42, 0.18);
const OPEN_HEIGHT = fromDurationBounce(0.5, 0.12);
const CLOSE_HEIGHT = fromDurationBounce(0.4, 0);
const CLOSE_WIDTH = fromDurationBounce(0.5, 0);
const RESIZE = fromDurationBounce(0.35, 0);
const MAX_RADIUS = 22;
const SHOW_MS = 4500;
const AFTER_HOVER_MS = 1500;
const ICONS = { info: '#i-info', success: '#i-check-circle', error: '#i-alert' };

export function createIsland({ island, status, message, text, icon, reducedMotion }) {
  let width = null;
  let height = null;
  let frame = 0;
  let mode = 'status';
  let timer = 0;
  let hovered = false;

  // Escala de tiempo solo para revisar la animación en cámara lenta.
  const now = () => (performance.now() / 1000) * (globalThis.tenveoTimeScale ?? 1);

  const compactSize = () => ({ w: status.offsetWidth, h: status.offsetHeight });
  const messageSize = () => ({ w: message.offsetWidth, h: message.offsetHeight });

  function paint(w, h) {
    island.style.width = `${w.toFixed(1)}px`;
    island.style.height = `${h.toFixed(1)}px`;
    island.style.borderRadius = `${Math.min(MAX_RADIUS, h / 2).toFixed(1)}px`;
  }

  function step() {
    const t = now();
    const settled = width.isSettled(t, 0.2, 2) && height.isSettled(t, 0.2, 2);
    if (settled) {
      frame = 0;
      paint(width.target, height.target);
      return;
    }
    paint(width.sample(t).value, height.sample(t).value);
    frame = requestAnimationFrame(step);
  }

  // Lleva la isla al tamaño pedido con los springs de cada canal. Si ya se
  // movía, sigue desde su posición y velocidad actuales.
  function morphTo({ w, h }, widthSpring, heightSpring) {
    const t = now();
    if (!width || reducedMotion.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      width = new SpringValue(w, widthSpring);
      height = new SpringValue(h, heightSpring);
      paint(w, h);
      return;
    }
    width.retarget(w, t, widthSpring);
    height.retarget(h, t, heightSpring);
    if (!frame) frame = requestAnimationFrame(step);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (hovered) return;
      collapse();
    }, ms);
  }

  function collapse() {
    clearTimeout(timer);
    if (mode === 'status') return;
    mode = 'status';
    island.dataset.mode = 'status';
    morphTo(compactSize(), CLOSE_WIDTH, CLOSE_HEIGHT);
  }

  // En reposo la isla sigue el ancho de su estado (por ejemplo, otra latencia).
  new ResizeObserver(() => {
    if (mode !== 'status') return;
    morphTo(compactSize(), RESIZE, RESIZE);
  }).observe(status);

  island.addEventListener('pointerenter', () => {
    hovered = true;
    clearTimeout(timer);
  });
  island.addEventListener('pointerleave', () => {
    hovered = false;
    if (mode === 'message') schedule(AFTER_HOVER_MS);
  });
  // Un clic en el aviso lo cierra; en reposo, el estado abre Ajustes (app.js).
  message.addEventListener('click', collapse);

  island.dataset.mode = 'status';

  return {
    show(textContent, kind = 'info') {
      if (!textContent) return;
      text.textContent = textContent;
      icon.querySelector('use').setAttribute('href', ICONS[kind] ?? ICONS.info);
      island.dataset.kind = kind;
      mode = 'message';
      island.dataset.mode = 'message';
      morphTo(messageSize(), OPEN_WIDTH, OPEN_HEIGHT);
      schedule(SHOW_MS);
    },
    collapse,
  };
}

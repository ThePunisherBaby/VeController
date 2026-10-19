// Modelo del estudio de producción (el reemplazo de OBS): escenas con fuentes
// en capas, cada una con su posición, tamaño, recorte, opacidad y chroma key.
// Es puro, sin DOM ni red: lo usan la ventana, el proceso principal (para
// validar lo que guarda) y las pruebas. Las coordenadas son píxeles de la salida.

export const SOURCE_TYPES = Object.freeze(['pc500', 'camera', 'screen', 'image', 'video', 'text', 'color']);

export const SOURCE_LABELS = Object.freeze({
  pc500: 'Programa del PC500',
  camera: 'Cámara',
  screen: 'Pantalla o ventana',
  image: 'Imagen',
  video: 'Video',
  text: 'Texto',
  color: 'Color',
});

// Salidas permitidas. 4K30 va con aviso: en una Mac de 2014 codifica al límite.
export const OUTPUTS = Object.freeze([
  Object.freeze({ id: '720p30', width: 1280, height: 720, fps: 30 }),
  Object.freeze({ id: '720p60', width: 1280, height: 720, fps: 60 }),
  Object.freeze({ id: '1080p30', width: 1920, height: 1080, fps: 30 }),
  Object.freeze({ id: '1080p60', width: 1920, height: 1080, fps: 60 }),
  Object.freeze({ id: '1440p60', width: 2560, height: 1440, fps: 60, warning: true }),
  Object.freeze({ id: '2160p30', width: 3840, height: 2160, fps: 30, warning: true }),
]);

export const DEFAULT_OUTPUT = '1080p60';

// Transición al cambiar de escena: corte o fundido (300 ms, como OBS).
export const TRANSITIONS = Object.freeze(['fade', 'cut']);
export const DEFAULT_TRANSITION = Object.freeze({ kind: 'fade', ms: 300 });

// Tipos de letra del texto: los del sistema, que la Mac siempre tiene.
export const TEXT_FONTS = Object.freeze({
  system: Object.freeze({ label: 'SF Pro', css: 'system-ui, -apple-system, sans-serif' }),
  rounded: Object.freeze({ label: 'SF Pro Rounded', css: 'ui-rounded, system-ui, sans-serif' }),
  serif: Object.freeze({ label: 'New York', css: 'ui-serif, Georgia, serif' }),
  mono: Object.freeze({ label: 'SF Mono', css: 'ui-monospace, Menlo, monospace' }),
});
const MAX_SCENES = 100;
const MAX_SOURCES = 60;
const MIN_SIZE = 16;
const HEX = /^#[0-9a-f]{6}$/i;
const MEDIA = /^[a-f0-9]{8,64}\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm)$/i;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const finite = (n, fallback) => (Number.isFinite(Number(n)) ? Number(n) : fallback);
const text = (value, fallback, max = 120) => (typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback);

let counter = 0;
export function createId(prefix) {
  counter = (counter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function outputFor(id) {
  return OUTPUTS.find((o) => o.id === id) ?? OUTPUTS.find((o) => o.id === DEFAULT_OUTPUT);
}

export function defaultSettings(type) {
  switch (type) {
    case 'camera':
      return { deviceId: '', label: '' };
    case 'screen':
      return { sourceId: '', label: '' };
    case 'image':
      return { media: '', fileName: '' };
    case 'video':
      return { media: '', fileName: '', loop: true, restart: true };
    case 'text':
      return { text: 'Texto', font: 'system', size: 72, bold: true, color: '#ffffff', align: 'center', shadow: false, background: '#000000', backgroundOpacity: 0 };
    case 'color':
      return { color: '#1e6ef4' };
    default:
      return {};
  }
}

// Tamaño natural por omisión, hasta conocer el real (una imagen recién cargada).
function defaultNatural(type, canvas) {
  if (type === 'text') return { width: 640, height: 160 };
  if (type === 'image') return { width: 640, height: 360 };
  return { width: canvas.width, height: canvas.height };
}

/** Posición y tamaño para mostrar algo de tamaño natural dentro de la salida. */
export function fitTransform(natural, canvas, mode = 'fit') {
  const nw = Math.max(1, natural.width);
  const nh = Math.max(1, natural.height);
  if (mode === 'center') {
    return { x: Math.round((canvas.width - nw) / 2), y: Math.round((canvas.height - nh) / 2), width: nw, height: nh };
  }
  const scale = mode === 'fill' ? Math.max(canvas.width / nw, canvas.height / nh) : Math.min(canvas.width / nw, canvas.height / nh);
  const width = Math.round(nw * scale);
  const height = Math.round(nh * scale);
  return { x: Math.round((canvas.width - width) / 2), y: Math.round((canvas.height - height) / 2), width, height };
}

export function createSource(type, canvas, options = {}) {
  if (!SOURCE_TYPES.includes(type)) throw new RangeError(`Tipo de fuente desconocido: ${type}`);
  const natural = options.natural ?? defaultNatural(type, canvas);
  const full = ['pc500', 'camera', 'screen', 'video', 'color'].includes(type);
  return {
    id: createId('fuente'),
    type,
    name: options.name ?? SOURCE_LABELS[type],
    visible: true,
    locked: false,
    natural: { width: natural.width, height: natural.height },
    transform: full ? fitTransform(natural, canvas, type === 'color' ? 'fill' : 'fit') : fitTransform(natural, canvas, 'center'),
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    opacity: 1,
    chroma: { enabled: false, color: '#00ff00', similarity: 0.4, smoothness: 0.08, spill: 0.1 },
    settings: { ...defaultSettings(type), ...options.settings },
  };
}

export function createScene(name = 'Escena') {
  return { id: createId('escena'), name, sources: [] };
}

/** Una producción nueva: una escena con el programa del PC500 a pantalla completa. */
export function createProduction() {
  const canvas = outputFor(DEFAULT_OUTPUT);
  const scene = createScene('Escena 1');
  scene.sources.push(createSource('pc500', canvas));
  return { version: 1, output: DEFAULT_OUTPUT, transition: { ...DEFAULT_TRANSITION }, scenes: [scene], liveScene: scene.id };
}

function normalizeSettings(type, input = {}) {
  const base = defaultSettings(type);
  const out = { ...base };
  for (const key of Object.keys(base)) {
    const value = input[key];
    const fallback = base[key];
    if (typeof fallback === 'boolean') out[key] = typeof value === 'boolean' ? value : fallback;
    else if (typeof fallback === 'number') out[key] = finite(value, fallback);
    else if (HEX.test(String(fallback))) out[key] = HEX.test(String(value)) ? String(value).toLowerCase() : fallback;
    else out[key] = typeof value === 'string' ? value.slice(0, key === 'text' ? 2000 : 300) : fallback;
  }
  if (type === 'text') {
    out.size = clamp(out.size, 8, 400);
    out.backgroundOpacity = clamp(out.backgroundOpacity, 0, 1);
    if (!['left', 'center', 'right'].includes(out.align)) out.align = 'center';
    if (!Object.hasOwn(TEXT_FONTS, out.font)) out.font = 'system';
  }
  if ((type === 'image' || type === 'video') && out.media && !MEDIA.test(out.media)) out.media = '';
  return out;
}

export function normalizeSource(input, canvas) {
  if (!input || typeof input !== 'object' || !SOURCE_TYPES.includes(input.type)) return null;
  const source = createSource(input.type, canvas);
  source.id = text(input.id, source.id, 64);
  source.name = text(input.name, source.name, 80);
  source.visible = input.visible !== false;
  source.locked = input.locked === true;
  const natural = input.natural ?? {};
  source.natural = { width: clamp(finite(natural.width, source.natural.width), 1, 16384), height: clamp(finite(natural.height, source.natural.height), 1, 16384) };
  const t = input.transform ?? {};
  source.transform = {
    x: clamp(finite(t.x, source.transform.x), -4 * canvas.width, 5 * canvas.width),
    y: clamp(finite(t.y, source.transform.y), -4 * canvas.height, 5 * canvas.height),
    width: clamp(finite(t.width, source.transform.width), MIN_SIZE, 8 * canvas.width),
    height: clamp(finite(t.height, source.transform.height), MIN_SIZE, 8 * canvas.height),
  };
  const c = input.crop ?? {};
  for (const side of ['top', 'right', 'bottom', 'left']) source.crop[side] = clamp(finite(c[side], 0), 0, 16384);
  source.opacity = clamp(finite(input.opacity, 1), 0, 1);
  const k = input.chroma ?? {};
  source.chroma = {
    enabled: k.enabled === true,
    color: HEX.test(String(k.color)) ? String(k.color).toLowerCase() : source.chroma.color,
    similarity: clamp(finite(k.similarity, source.chroma.similarity), 0, 1),
    smoothness: clamp(finite(k.smoothness, source.chroma.smoothness), 0, 1),
    spill: clamp(finite(k.spill, source.chroma.spill), 0, 1),
  };
  source.settings = normalizeSettings(source.type, input.settings);
  return source;
}

/** Acepta solo una producción válida: lo que no cumple se descarta o se corrige. */
export function normalizeProduction(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.scenes)) return createProduction();
  const output = OUTPUTS.some((o) => o.id === input.output) ? input.output : DEFAULT_OUTPUT;
  const canvas = outputFor(output);
  const ids = new Set();
  const scenes = [];
  for (const raw of input.scenes.slice(0, MAX_SCENES)) {
    if (!raw || typeof raw !== 'object') continue;
    const scene = createScene(text(raw.name, 'Escena', 80));
    if (typeof raw.id === 'string' && raw.id && !ids.has(raw.id)) scene.id = raw.id.slice(0, 64);
    ids.add(scene.id);
    for (const rawSource of Array.isArray(raw.sources) ? raw.sources.slice(0, MAX_SOURCES) : []) {
      const source = normalizeSource(rawSource, canvas);
      if (source && !scene.sources.some((s) => s.id === source.id)) scene.sources.push(source);
    }
    scenes.push(scene);
  }
  if (!scenes.length) return createProduction();
  const liveScene = scenes.some((s) => s.id === input.liveScene) ? input.liveScene : scenes[0].id;
  const t = input.transition ?? {};
  const transition = {
    kind: TRANSITIONS.includes(t.kind) ? t.kind : DEFAULT_TRANSITION.kind,
    ms: Math.round(clamp(finite(t.ms, DEFAULT_TRANSITION.ms), 50, 5000)),
  };
  return { version: 1, output, transition, scenes, liveScene };
}

export const sceneById = (doc, id) => doc.scenes.find((scene) => scene.id === id) ?? null;
export const liveSceneOf = (doc) => sceneById(doc, doc.liveScene) ?? doc.scenes[0];

/** La fuente visible y sin candado más arriba bajo el punto (x, y). */
export function hitTest(scene, x, y) {
  for (let i = scene.sources.length - 1; i >= 0; i--) {
    const s = scene.sources[i];
    if (!s.visible || s.locked) continue;
    const t = s.transform;
    if (x >= t.x && x <= t.x + t.width && y >= t.y && y <= t.y + t.height) return s;
  }
  return null;
}

/**
 * Imán: acerca los bordes y el centro de la fuente a los bordes y el centro de
 * la salida si están a menos de threshold píxeles. Devuelve también las guías
 * que se activaron, para dibujarlas.
 */
export function snapTransform(t, canvas, threshold = 12) {
  const result = { ...t };
  const guides = [];
  const tryAxis = (axis, size, lines) => {
    const start = t[axis];
    const candidates = [
      { offset: 0, value: start },
      { offset: t[size] / 2, value: start + t[size] / 2 },
      { offset: t[size], value: start + t[size] },
    ];
    let best = null;
    for (const line of lines) {
      for (const candidate of candidates) {
        const distance = Math.abs(candidate.value - line);
        if (distance <= threshold && (!best || distance < best.distance)) best = { distance, position: line - candidate.offset, line };
      }
    }
    if (best) {
      result[axis] = Math.round(best.position);
      guides.push({ axis, at: best.line });
    }
  };
  tryAxis('x', 'width', [0, canvas.width / 2, canvas.width]);
  tryAxis('y', 'height', [0, canvas.height / 2, canvas.height]);
  return { transform: result, guides };
}

/**
 * Nuevo tamaño al arrastrar una manija: n, s, e, w o sus esquinas (ne, nw, se,
 * sw). En las esquinas se mantiene la proporción salvo que free sea true.
 */
export function resizeTransform(t, handle, dx, dy, { free = false, aspect = t.width / t.height } = {}) {
  let { x, y, width, height } = t;
  if (handle.includes('e')) width += dx;
  if (handle.includes('w')) {
    width -= dx;
    x += dx;
  }
  if (handle.includes('s')) height += dy;
  if (handle.includes('n')) {
    height -= dy;
    y += dy;
  }
  const corner = handle.length === 2;
  if (corner && !free && aspect > 0) {
    // La proporción la manda el eje que más se movió.
    const byWidth = Math.abs(width - t.width) / t.width >= Math.abs(height - t.height) / t.height;
    if (byWidth) {
      const next = width / aspect;
      if (handle.includes('n')) y += height - next;
      height = next;
    } else {
      const next = height * aspect;
      if (handle.includes('w')) x += width - next;
      width = next;
    }
  }
  if (width < MIN_SIZE) {
    if (handle.includes('w')) x -= MIN_SIZE - width;
    width = MIN_SIZE;
  }
  if (height < MIN_SIZE) {
    if (handle.includes('n')) y -= MIN_SIZE - height;
    height = MIN_SIZE;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Lo que queda de la fuente después del recorte, en sus píxeles. */
export function croppedSize(source) {
  const { natural: n, crop: c } = source;
  return { width: Math.max(1, n.width - c.left - c.right), height: Math.max(1, n.height - c.top - c.bottom) };
}

/** Ajustar, llenar o centrar la parte visible de la fuente en la salida. */
export function fitSource(source, canvas, mode) {
  return fitTransform(croppedSize(source), canvas, mode);
}

/**
 * Cambia el recorte como OBS: lo que queda no se estira ni se mueve. El recuadro
 * se achica del lado recortado manteniendo la escala. Nunca deja menos de 1 px.
 */
export function applyCrop(source, next) {
  const { natural: n, crop: old, transform: t } = source;
  const before = croppedSize(source);
  const sx = t.width / before.width;
  const sy = t.height / before.height;
  const crop = {};
  for (const side of ['top', 'right', 'bottom', 'left']) crop[side] = Math.max(0, Math.round(finite(next[side], old[side])));
  crop.right = Math.min(crop.right, n.width - 1);
  crop.left = Math.min(crop.left, n.width - 1 - crop.right);
  crop.bottom = Math.min(crop.bottom, n.height - 1);
  crop.top = Math.min(crop.top, n.height - 1 - crop.bottom);
  const width = n.width - crop.left - crop.right;
  const height = n.height - crop.top - crop.bottom;
  const transform = {
    x: Math.round(t.x + (crop.left - old.left) * sx),
    y: Math.round(t.y + (crop.top - old.top) * sy),
    width: Math.max(MIN_SIZE, Math.round(width * sx)),
    height: Math.max(MIN_SIZE, Math.round(height * sy)),
  };
  return { crop, transform };
}

/**
 * Cambia la resolución de salida y escala todas las fuentes en proporción: la
 * composición se ve igual en 720p que en 4K.
 */
export function changeOutput(doc, outputId) {
  const from = outputFor(doc.output);
  const to = outputFor(outputId);
  const k = to.width / from.width;
  const scenes = doc.scenes.map((scene) => ({
    ...scene,
    sources: scene.sources.map((source) => {
      const t = source.transform;
      return { ...source, transform: { x: Math.round(t.x * k), y: Math.round(t.y * k), width: Math.max(MIN_SIZE, Math.round(t.width * k)), height: Math.max(MIN_SIZE, Math.round(t.height * k)) } };
    }),
  }));
  return { ...doc, output: to.id, scenes };
}

/** Lleva una fuente a otra posición de la pila (0 es la de más abajo). */
export function moveSource(scene, id, toIndex) {
  const from = scene.sources.findIndex((s) => s.id === id);
  if (from < 0) return false;
  const to = clamp(Math.round(toIndex), 0, scene.sources.length - 1);
  if (to === from) return false;
  const [source] = scene.sources.splice(from, 1);
  scene.sources.splice(to, 0, source);
  return true;
}

/** Recorte en fracciones de la imagen (0 a 1), para el shader. */
export function cropUv(source) {
  const { width, height } = source.natural;
  const c = source.crop;
  const left = clamp(c.left / width, 0, 1);
  const right = clamp(c.right / width, 0, 1);
  const top = clamp(c.top / height, 0, 1);
  const bottom = clamp(c.bottom / height, 0, 1);
  return { u0: left, v0: top, u1: Math.max(left, 1 - right), v1: Math.max(top, 1 - bottom) };
}

/** Copia una escena con identificadores nuevos (para duplicarla). */
export function duplicateScene(scene, name = `${scene.name} (copia)`) {
  const copy = createScene(name);
  copy.sources = scene.sources.map((source) => ({ ...structuredClone(source), id: createId('fuente') }));
  return copy;
}

/**
 * La imagen que dibuja cada fuente: el PC500, una cámara, una pantalla, un video
 * o una imagen se comparten entre fuentes y escenas; el texto es de cada fuente.
 * El color no necesita imagen.
 */
export function resourceKey(source) {
  switch (source.type) {
    case 'pc500':
      return 'pc500';
    case 'camera':
      return source.settings.deviceId ? `camera:${source.settings.deviceId}` : '';
    case 'screen':
      return source.settings.sourceId ? `screen:${source.settings.sourceId}` : '';
    case 'video':
      return source.settings.media ? `video:${source.settings.media}` : '';
    case 'image':
      return source.settings.media ? `image:${source.settings.media}` : '';
    case 'text':
      return `text:${source.id}`;
    default:
      return '';
  }
}

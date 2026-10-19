// Vista Producción: el estudio que reemplaza a OBS dentro de la app.
//
// La producción (escenas con sus fuentes) vive aquí y se guarda en el proceso
// principal (production.json). Cada cambio se ve en la salida al instante y
// entra en el historial: ⌘Z lo deshace y ⇧⌘Z lo rehace. Como en OBS sin el
// modo estudio, la escena elegida es la que está en la salida.

import {
  OUTPUTS,
  SOURCE_LABELS,
  TEXT_FONTS,
  applyCrop,
  changeOutput,
  createProduction,
  createScene,
  createSource,
  createId,
  duplicateScene,
  fitSource,
  fitTransform,
  hitTest,
  liveSceneOf,
  moveSource,
  normalizeProduction,
  outputFor,
  resizeTransform,
  resourceKey,
  sceneById,
  snapTransform,
} from '../../core/production.js';
import { createProductionEngine, layoutText } from './production-engine.js';

const SAVE_DELAY_MS = 250;
const HISTORY_LIMIT = 100;
const GROUP_MS = 1000; // cambios seguidos de un mismo campo: un solo paso de ⌘Z
const SNAP_PX = 8; // imán, en píxeles de pantalla
const DRAG_PX = 3; // menos que esto es un clic, no un arrastre
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const ICONS = {
  pc500: 'i-src-pc500',
  camera: 'i-camera',
  screen: 'i-src-screen',
  image: 'i-src-image',
  video: 'i-src-video',
  text: 'i-src-text',
  color: 'i-src-color',
};
const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function svgIcon(id, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((value, key) => value[key], object);
  target[last] = value;
}

const once = (target, event) =>
  new Promise((resolve, reject) => {
    target.addEventListener(event, resolve, { once: true });
    target.addEventListener('error', () => reject(new Error('No se pudo leer el archivo.')), { once: true });
  });

const mediaUrl = (media) => new URL(`/media/${media}`, location.href).href;
const baseName = (file) => String(file).replace(/\.[^.]+$/, '').slice(0, 80) || 'Archivo';

async function measureMedia(kind, media) {
  if (kind === 'image') {
    const image = new Image();
    image.src = mediaUrl(media);
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.src = mediaUrl(media);
  try {
    await once(video, 'loadedmetadata');
    return { width: video.videoWidth || 1920, height: video.videoHeight || 1080 };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

export async function createStudio({ backend, pgm, toast = () => {}, describePc500 = () => '' }) {
  const $ = (id) => document.getElementById(id);
  const els = {
    view: $('studio-view'),
    outputArea: $('output-area'),
    frame: $('output-frame'),
    output: $('output'),
    canvas: $('output-canvas'),
    overlay: $('output-overlay'),
    label: $('output-label'),
    dropHint: $('drop-hint'),
    sceneList: $('scene-list'),
    sourceList: $('source-list'),
    sceneRemove: $('scene-remove'),
    sourceAdd: $('source-add'),
    sourceUp: $('source-up'),
    sourceDown: $('source-down'),
    sourceRemove: $('source-remove'),
    paneOutput: $('pane-output'),
    paneSource: $('pane-source'),
    resolution: $('out-resolution'),
    outWarning: $('out-warning'),
    durationRow: $('out-duration-row'),
    name: $('insp-name'),
    sub: $('insp-sub'),
    icon: $('insp-icon'),
    camera: $('insp-camera'),
    screen: $('insp-screen'),
    file: $('insp-file'),
    fileTitle: $('insp-file-title'),
    font: $('insp-font'),
    aspect: $('insp-aspect'),
    chromaRows: document.querySelectorAll('#pane-source [data-chroma]'),
    swatches: document.querySelectorAll('#pane-source .swatch'),
    captureDialog: $('capture-dialog'),
    captureStatus: $('capture-status'),
    captureScreens: $('capture-screens'),
    captureWindows: $('capture-windows'),
  };

  const loaded = await backend.send('getProduction');
  let doc = normalizeProduction(loaded?.ok ? loaded.result : createProduction());
  let selectedId = null;
  let visible = false;
  let clipboard = null;
  let renaming = null;
  let devices = [];
  let drag = null;
  let pickResolve = null;
  // Fuentes recién agregadas: se ajustan a la salida cuando se sabe su tamaño real.
  const autoFit = new Set();
  const history = { undo: [], redo: [], group: '', at: 0 };
  const listeners = new Set();

  const canvasSize = () => outputFor(doc.output);
  const live = () => liveSceneOf(doc);
  const selected = () => live().sources.find((source) => source.id === selectedId) ?? null;

  const engine = createProductionEngine({
    canvas: els.canvas,
    pgm,
    onNatural: applyNatural,
    onStatus: () => scheduleRender(),
  });
  engine.setOutput(doc.output);
  // El motor guarda la escena aunque todavía no dibuje: la muestra al abrir Producción.
  engine.show(live());

  // --- Historial y guardado ---

  function remember(group = '') {
    const now = performance.now();
    if (group && group === history.group && now - history.at < GROUP_MS) {
      history.at = now;
      return;
    }
    history.undo.push(JSON.stringify({ doc, selectedId }));
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    history.redo = [];
    history.group = group;
    history.at = now;
  }

  // Deshacer no cambia de escena: la que está en la salida se queda, si existe.
  function restore(from, to) {
    const entry = from.pop();
    if (!entry) return false;
    to.push(JSON.stringify({ doc, selectedId }));
    const state = JSON.parse(entry);
    const keepLive = doc.liveScene;
    doc = state.doc;
    if (sceneById(doc, keepLive)) doc.liveScene = keepLive;
    selectedId = live().sources.some((source) => source.id === state.selectedId) ? state.selectedId : null;
    history.group = '';
    engine.setOutput(doc.output);
    changed();
    return true;
  }

  const undo = () => restore(history.undo, history.redo);
  const redo = () => restore(history.redo, history.undo);

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    backend.send('saveProduction', doc).then((response) => {
      if (response?.ok === false) toast(`No se pudo guardar la producción: ${response.error}`, 'error');
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  // Todo cambio pasa por aquí: se dibuja, se guarda y se avisa a la consola.
  function changed({ transition = null, activated = false } = {}) {
    engine.show(live(), { transition, activated });
    scheduleSave();
    scheduleRender();
    for (const listener of listeners) listener();
  }

  // --- Tamaños reales ---

  function applyNatural(key, size) {
    const canvas = canvasSize();
    let touched = false;
    for (const scene of doc.scenes) {
      for (const source of scene.sources) {
        if (source.type === 'text' || resourceKey(source) !== key) continue;
        if (source.natural.width === size.width && source.natural.height === size.height) continue;
        source.natural = { width: size.width, height: size.height };
        if (autoFit.has(source.id)) {
          source.transform = fitSource(source, canvas, 'fit');
          autoFit.delete(source.id);
        }
        touched = true;
      }
    }
    if (touched) changed();
  }

  // El texto cambia de tamaño con lo que dice: la caja crece desde su
  // alineación y conserva la escala que le dio el usuario.
  function refitText(source, before) {
    const layout = layoutText(source.settings, 1);
    const t = source.transform;
    const sx = t.width / Math.max(1, before.width);
    const sy = t.height / Math.max(1, before.height);
    const width = Math.max(16, Math.round(layout.width * sx));
    const height = Math.max(16, Math.round(layout.height * sy));
    const align = source.settings.align;
    const x = align === 'left' ? t.x : align === 'right' ? t.x + t.width - width : Math.round(t.x + (t.width - width) / 2);
    source.natural = { width: layout.width, height: layout.height };
    source.transform = { x, y: Math.round(t.y + (t.height - height) / 2), width, height };
  }

  // --- Escenas ---

  function goLive(id) {
    if (id === doc.liveScene || !sceneById(doc, id)) return;
    doc.liveScene = id;
    selectedId = null;
    changed({ transition: doc.transition, activated: true });
  }

  function nextSceneName() {
    const numbers = doc.scenes.map((scene) => Number(/^Escena (\d+)$/.exec(scene.name)?.[1] ?? 0));
    return `Escena ${Math.max(0, ...numbers) + 1}`;
  }

  function insertScene(scene) {
    const index = doc.scenes.findIndex((s) => s.id === doc.liveScene);
    doc.scenes.splice(index + 1, 0, scene);
    doc.liveScene = scene.id;
    selectedId = null;
    changed({ transition: doc.transition, activated: true });
  }

  // Como una carpeta nueva en el Finder: entra con el nombre listo para escribir.
  function addScene(rename = true) {
    remember();
    const scene = createScene(nextSceneName());
    scene.sources.push(createSource('pc500', canvasSize()));
    insertScene(scene);
    renderNow();
    if (rename) startRename('scene', scene.id);
  }

  function duplicateLiveScene() {
    remember();
    insertScene(duplicateScene(live()));
  }

  function removeScene(id = doc.liveScene) {
    if (doc.scenes.length <= 1) return;
    const index = doc.scenes.findIndex((scene) => scene.id === id);
    if (index < 0) return;
    remember();
    const [removed] = doc.scenes.splice(index, 1);
    if (doc.liveScene === id) {
      doc.liveScene = doc.scenes[Math.min(index, doc.scenes.length - 1)].id;
      selectedId = null;
      changed({ transition: doc.transition, activated: true });
    } else changed();
    toast(`Se quitó la escena «${removed.name}». ⌘Z la recupera.`, 'info');
  }

  function moveScene(id, delta) {
    const index = doc.scenes.findIndex((scene) => scene.id === id);
    const to = index + delta;
    if (index < 0 || to < 0 || to >= doc.scenes.length) return;
    remember();
    const [scene] = doc.scenes.splice(index, 1);
    doc.scenes.splice(to, 0, scene);
    changed();
  }

  function rename(list, id, name) {
    const target = list === 'scene' ? sceneById(doc, id) : live().sources.find((source) => source.id === id);
    if (!target || target.name === name) return;
    remember();
    target.name = name.slice(0, 80);
    changed();
  }

  // --- Fuentes ---

  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    scheduleRender();
  }

  function insertSource(source) {
    remember();
    const scene = live();
    // Como en OBS, lo nuevo entra al frente; el color, al fondo, de base.
    if (source.type === 'color') scene.sources.unshift(source);
    else scene.sources.push(source);
    selectedId = source.id;
    changed();
  }

  function sourceById(id) {
    return live().sources.find((source) => source.id === id) ?? null;
  }

  function editSource(id, group, edit) {
    const source = sourceById(id);
    if (!source) return;
    remember(group);
    edit(source);
    changed();
  }

  function removeSource(id = selectedId) {
    const scene = live();
    const index = scene.sources.findIndex((source) => source.id === id);
    if (index < 0) return;
    remember();
    scene.sources.splice(index, 1);
    if (selectedId === id) selectedId = null;
    changed();
  }

  function shiftSource(id, delta) {
    const scene = live();
    const index = scene.sources.findIndex((source) => source.id === id);
    if (index < 0) return;
    const to = delta === Infinity ? scene.sources.length - 1 : delta === -Infinity ? 0 : index + delta;
    if (to < 0 || to >= scene.sources.length || to === index) return;
    remember();
    moveSource(scene, id, to);
    changed();
  }

  function cloneSource(source, offset) {
    const copy = { ...structuredClone(source), id: createId('fuente') };
    if (offset) copy.transform = { ...copy.transform, x: copy.transform.x + offset, y: copy.transform.y + offset };
    return copy;
  }

  function duplicateSource(id = selectedId) {
    const source = sourceById(id);
    if (source) insertSource({ ...cloneSource(source, 24), name: `${source.name} (copia)` });
  }

  function pasteSource() {
    if (!clipboard) return;
    const overlaps = live().sources.some((s) => s.transform.x === clipboard.transform.x && s.transform.y === clipboard.transform.y);
    insertSource(cloneSource(clipboard, overlaps ? 24 : 0));
  }

  function fit(id, mode) {
    editSource(id, '', (source) => {
      source.transform = fitSource(source, canvasSize(), mode);
      autoFit.delete(source.id);
    });
  }

  // --- Agregar ---

  async function refreshDevices() {
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput' && device.deviceId);
    } catch {
      devices = [];
    }
    scheduleRender();
  }

  async function addMedia(kind) {
    const response = await backend.send('importMedia', kind);
    if (!response?.ok) {
      if (response?.error) toast(response.error, 'error');
      return;
    }
    if (response.result) await addImported(response.result);
  }

  async function addImported({ media, kind, fileName }, at = null) {
    let natural;
    try {
      natural = await measureMedia(kind, media);
    } catch {
      toast(`No se pudo abrir «${fileName}».`, 'error');
      return;
    }
    const canvas = canvasSize();
    const source = createSource(kind, canvas, { natural, name: baseName(fileName), settings: { media, fileName } });
    // Una imagen más grande que la salida entra ajustada; si se soltó en un punto, va centrada ahí.
    if (kind === 'image' && (natural.width > canvas.width || natural.height > canvas.height)) source.transform = fitTransform(natural, canvas, 'fit');
    if (at && kind === 'image') {
      const t = source.transform;
      source.transform = { ...t, x: Math.round(at.x - t.width / 2), y: Math.round(at.y - t.height / 2) };
    }
    insertSource(source);
  }

  function addText() {
    const settings = createSource('text', canvasSize()).settings;
    const layout = layoutText(settings, 1);
    const source = createSource('text', canvasSize(), { natural: { width: layout.width, height: layout.height } });
    insertSource(source);
    renderNow();
    const field = els.paneSource.querySelector('[data-field="settings.text"]');
    field?.focus();
    field?.select();
  }

  function addCamera(deviceId) {
    const device = devices.find((d) => d.deviceId === deviceId);
    const label = device?.label ?? '';
    const source = createSource('camera', canvasSize(), { name: label || SOURCE_LABELS.camera, settings: { deviceId, label } });
    autoFit.add(source.id);
    insertSource(source);
  }

  async function addScreen() {
    const choice = await pickCapture();
    if (!choice) return;
    const source = createSource('screen', canvasSize(), { name: choice.name || SOURCE_LABELS.screen, settings: { sourceId: choice.id, label: choice.name } });
    autoFit.add(source.id);
    insertSource(source);
  }

  async function addSource(type, extra) {
    if (type === 'pc500') insertSource(createSource('pc500', canvasSize()));
    else if (type === 'camera') addCamera(extra);
    else if (type === 'screen') await addScreen();
    else if (type === 'image' || type === 'video') await addMedia(type);
    else if (type === 'text') addText();
    else if (type === 'color') insertSource(createSource('color', canvasSize()));
  }

  async function allowCameras() {
    const response = await backend.send('mediaAccess', 'camera', true);
    if (response?.result === 'granted') {
      await refreshDevices();
      openAddMenu();
    } else {
      toast('Sin permiso para las cámaras. Habilítalo en Ajustes del Sistema › Privacidad › Cámara.', 'error');
      backend.send('openPrivacySettings', 'camera');
    }
  }

  // Menú nativo de la Mac, debajo del botón +.
  async function openAddMenu() {
    await refreshDevices();
    const access = await backend.send('mediaAccess', 'camera');
    const cameraItems =
      access?.result === 'not-determined' || access?.result === 'denied'
        ? [{ id: 'camera-allow', label: 'Permitir el uso de cámaras…' }]
        : devices.length
          ? devices.map((device, i) => ({ id: `add:camera:${device.deviceId}`, label: device.label || `Cámara ${i + 1}` }))
          : [{ id: '', label: 'No hay cámaras conectadas', enabled: false }];
    const rect = els.sourceAdd.getBoundingClientRect();
    const response = await backend.send('popupMenu', {
      x: rect.left,
      y: rect.bottom + 4,
      items: [
        { id: 'add:pc500', label: SOURCE_LABELS.pc500 },
        { label: 'Cámara', submenu: cameraItems },
        { id: 'add:screen', label: 'Pantalla o ventana…' },
        { type: 'separator' },
        { id: 'add:image', label: 'Imagen…' },
        { id: 'add:video', label: 'Video…' },
        { type: 'separator' },
        { id: 'add:text', label: 'Texto' },
        { id: 'add:color', label: 'Color' },
      ],
    });
    const id = response?.result;
    if (!id) return;
    if (id === 'camera-allow') return allowCameras();
    const [, type, ...rest] = id.split(':');
    await addSource(type, rest.join(':'));
  }

  // --- Pantalla o ventana ---

  function captureItem(source) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'capture';
    button.dataset.action = 'capture-choose';
    button.dataset.id = source.id;
    button.dataset.name = source.name;
    const thumb = document.createElement('span');
    thumb.className = 'capture-thumb';
    if (source.thumbnail) {
      const img = document.createElement('img');
      img.src = source.thumbnail;
      img.alt = '';
      thumb.append(img);
    }
    const name = document.createElement('span');
    name.className = 'capture-name';
    if (source.icon) {
      const icon = document.createElement('img');
      icon.src = source.icon;
      icon.alt = '';
      icon.className = 'capture-icon';
      name.append(icon);
    }
    name.append(source.name);
    button.append(thumb, name);
    return button;
  }

  async function loadCaptures() {
    els.captureStatus.textContent = 'Buscando pantallas y ventanas…';
    const response = await backend.send('listCaptureSources');
    if (!response?.ok) {
      els.captureStatus.textContent = response?.error ?? 'No se pudo buscar.';
      return;
    }
    const { status, sources } = response.result;
    const screens = sources.filter((s) => s.kind === 'screen');
    const windows = sources.filter((s) => s.kind === 'window');
    els.captureScreens.replaceChildren(...screens.map(captureItem));
    els.captureWindows.replaceChildren(...windows.map(captureItem));
    $('capture-windows-section').hidden = !windows.length;
    if (status !== 'granted') {
      els.captureStatus.replaceChildren(
        'macOS todavía no deja que Tenveo Studio grabe la pantalla. Habilítalo en Ajustes del Sistema › Privacidad › Grabación de pantalla y vuelve a abrir la app. ',
      );
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'link-btn';
      open.dataset.action = 'capture-privacy';
      open.textContent = 'Abrir Ajustes del Sistema';
      els.captureStatus.append(open);
    } else els.captureStatus.textContent = 'Elige qué quieres mostrar en la escena.';
  }

  function pickCapture() {
    pickResolve?.(null);
    els.captureDialog.showModal();
    loadCaptures();
    return new Promise((resolve) => {
      pickResolve = resolve;
    });
  }

  function closeCapture(choice = null) {
    const resolve = pickResolve;
    pickResolve = null;
    if (els.captureDialog.open) els.captureDialog.close();
    resolve?.(choice);
  }

  async function replaceMedia(id) {
    const source = sourceById(id);
    if (!source || (source.type !== 'image' && source.type !== 'video')) return;
    const response = await backend.send('importMedia', source.type);
    if (!response?.ok || !response.result) return;
    const { media, fileName } = response.result;
    let natural;
    try {
      natural = await measureMedia(source.type, media);
    } catch {
      toast(`No se pudo abrir «${fileName}».`, 'error');
      return;
    }
    editSource(id, '', (s) => {
      const keepName = s.name === baseName(s.settings.fileName);
      const t = s.transform;
      // El archivo nuevo ocupa la misma caja, con su proporción y sin recorte.
      const height = Math.max(16, Math.round((t.width * natural.height) / natural.width));
      s.settings = { ...s.settings, media, fileName };
      s.natural = natural;
      s.crop = { top: 0, right: 0, bottom: 0, left: 0 };
      s.transform = { x: t.x, y: Math.round(t.y + (t.height - height) / 2), width: t.width, height };
      if (keepName) s.name = baseName(fileName);
    });
  }

  async function replaceScreen(id) {
    const choice = await pickCapture();
    if (!choice) return;
    editSource(id, '', (source) => {
      const keepName = source.name === source.settings.label || source.name === SOURCE_LABELS.screen;
      source.settings = { ...source.settings, sourceId: choice.id, label: choice.name };
      if (keepName) source.name = choice.name || SOURCE_LABELS.screen;
      autoFit.add(source.id);
    });
  }

  // --- Propiedades ---

  function fieldValue(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'number' || input.type === 'range') {
      const n = Number(input.value);
      if (input.value === '' || !Number.isFinite(n)) return undefined;
      return n / Number(input.dataset.scale || 1);
    }
    return input.value;
  }

  function applyField(source, path, value) {
    if (path.startsWith('transform.')) {
      const key = path.slice('transform.'.length);
      const t = { ...source.transform };
      if ((key === 'width' || key === 'height') && els.aspect.checked) {
        const aspect = t.width / t.height;
        if (key === 'width') {
          t.width = Math.max(16, Math.round(value));
          t.height = Math.max(16, Math.round(t.width / aspect));
        } else {
          t.height = Math.max(16, Math.round(value));
          t.width = Math.max(16, Math.round(t.height * aspect));
        }
      } else t[key] = key === 'width' || key === 'height' ? Math.max(16, Math.round(value)) : Math.round(value);
      source.transform = t;
      autoFit.delete(source.id);
    } else if (path === 'name') {
      source.name = String(value).slice(0, 80) || SOURCE_LABELS[source.type];
    } else if (path === 'opacity') {
      source.opacity = clamp(value, 0, 1);
    } else if (path.startsWith('chroma.')) {
      setPath(source, path, typeof value === 'number' ? clamp(value, 0, 1) : value);
    } else if (path === 'settings.deviceId') {
      const label = devices.find((d) => d.deviceId === value)?.label ?? '';
      if (source.name === source.settings.label || source.name === SOURCE_LABELS.camera) source.name = label || SOURCE_LABELS.camera;
      source.settings = { ...source.settings, deviceId: value, label };
      autoFit.add(source.id);
    } else if (path.startsWith('settings.')) {
      const before = { ...source.natural };
      if (path === 'settings.size') value = clamp(Math.round(value), 8, 400);
      setPath(source, path, value);
      if (source.type === 'text') refitText(source, before);
    }
  }

  function onField(input) {
    const source = selected();
    const path = input.dataset.field;
    const value = fieldValue(input);
    if (!source || value === undefined) return;
    if (input.type === 'radio' && !input.checked) return;
    // Mientras se borra el nombre para escribir otro, no se pisa con el de siempre.
    if (path === 'name' && !String(value).trim()) return;
    editSource(source.id, `field:${source.id}:${path}`, (s) => applyField(s, path, value));
  }

  function onCrop(input) {
    const source = selected();
    const value = fieldValue(input);
    if (!source || value === undefined) return;
    editSource(source.id, `crop:${source.id}`, (s) => {
      const next = applyCrop(s, { ...s.crop, [input.dataset.crop]: value });
      s.crop = next.crop;
      s.transform = next.transform;
    });
  }

  function onOutputField(input) {
    const path = input.dataset.out;
    if (path === 'output') {
      if (input.value === doc.output) return;
      remember();
      doc = changeOutput(doc, input.value);
      engine.setOutput(doc.output);
      changed();
      return;
    }
    const value = path === 'transition.ms' ? fieldValue(input) : input.value;
    if (value === undefined) return;
    remember(`out:${path}`);
    setPath(doc, path, path === 'transition.ms' ? clamp(Math.round(value), 50, 5000) : value);
    scheduleSave();
    scheduleRender();
  }

  // Un campo con el foco no se pisa mientras se escribe, salvo que ahora muestre
  // otra fuente.
  function setInput(input, value, owner = '') {
    const typing = document.activeElement === input && !['checkbox', 'radio', 'range'].includes(input.type) && input.dataset.owner === owner;
    input.dataset.owner = owner;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (input.type === 'radio') input.checked = input.value === value;
    else if (!typing) {
      const text = input.type === 'number' || input.type === 'range' ? String(Math.round(Number(value) * Number(input.dataset.scale || 1))) : String(value ?? '');
      if (input.value !== text) input.value = text;
    }
    if (input.type === 'range') {
      const out = input.nextElementSibling;
      const scale = Number(input.dataset.scale || 1);
      const text = scale === 100 ? `${input.value} %` : input.value;
      if (out && out.textContent !== text) out.textContent = text;
      const min = Number(input.min || 0);
      const fill = `${(((Number(input.value) - min) / (Number(input.max || 100) - min)) * 100).toFixed(1)}%`;
      if (input.style.getPropertyValue('--fill') !== fill) input.style.setProperty('--fill', fill);
    }
  }

  function statusText(source) {
    const key = resourceKey(source);
    if (source.type === 'color' || source.type === 'text') return '';
    if (!key) return { camera: 'Elige una cámara', screen: 'Elige una pantalla o ventana', image: 'Sin imagen', video: 'Sin video' }[source.type] ?? '';
    const status = engine.status(key);
    if (!visible || status?.state === 'live') return '';
    if (status?.state === 'error') return status.message;
    if (source.type === 'pc500') return describePc500() || 'Esperando el video del PC500…';
    return 'Abriendo…';
  }

  function cameraOptions(source) {
    const options = devices.map((device, i) => new Option(device.label || `Cámara ${i + 1}`, device.deviceId));
    if (source.settings.deviceId && !devices.some((d) => d.deviceId === source.settings.deviceId)) {
      options.unshift(new Option(`${source.settings.label || 'Cámara'} (desconectada)`, source.settings.deviceId));
    }
    if (!options.length) options.push(new Option('No hay cámaras conectadas', ''));
    const signature = options.map((o) => `${o.value}=${o.text}`).join('|');
    if (els.camera.dataset.signature !== signature) {
      els.camera.dataset.signature = signature;
      els.camera.replaceChildren(...options);
    }
  }

  function renderInspector() {
    const source = selected();
    els.paneOutput.hidden = Boolean(source);
    els.paneSource.hidden = !source;
    if (!source) {
      setInput(els.resolution, doc.output);
      els.outWarning.hidden = !outputFor(doc.output).warning;
      for (const input of els.paneOutput.querySelectorAll('[data-out^="transition"]')) setInput(input, getPath(doc, input.dataset.out));
      els.durationRow.hidden = doc.transition.kind === 'cut';
      return;
    }
    for (const part of els.paneSource.querySelectorAll('[data-for]')) {
      const hidden = !part.dataset.for.split(' ').includes(source.type);
      if (part.hidden !== hidden) part.hidden = hidden;
    }
    els.icon.setAttribute('href', `#${ICONS[source.type]}`);
    const size = source.type === 'color' ? '' : ` · ${source.natural.width} × ${source.natural.height}`;
    const status = statusText(source);
    els.sub.textContent = `${SOURCE_LABELS[source.type]}${status ? ` · ${status}` : size}`;
    if (source.type === 'camera') cameraOptions(source);
    if (source.type === 'screen') els.screen.textContent = source.settings.label || 'Ninguna';
    if (source.type === 'image' || source.type === 'video') {
      els.fileTitle.textContent = source.type === 'image' ? 'Imagen' : 'Video';
      els.file.textContent = source.settings.fileName || 'Ninguno';
      els.file.title = source.settings.fileName;
    }
    for (const input of els.paneSource.querySelectorAll('[data-field]')) setInput(input, getPath(source, input.dataset.field), source.id);
    for (const input of els.paneSource.querySelectorAll('[data-crop]')) setInput(input, source.crop[input.dataset.crop], source.id);
    for (const row of els.chromaRows) row.hidden = !source.chroma.enabled;
    for (const swatch of els.swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === source.chroma.color));
    $('chroma-section').hidden = source.type === 'color';
  }

  // --- Listas ---

  let scenesSignature = '';
  let sourcesSignature = '';

  function listItem(list, id, selected, name) {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.setAttribute('role', 'option');
    row.dataset.list = list;
    row.dataset.id = id;
    row.setAttribute('aria-selected', String(selected));
    const label = document.createElement('span');
    label.className = 'item-name';
    label.textContent = name;
    row.append(label);
    return row;
  }

  function itemButton(action, icon, label, pressed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item-btn';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', String(pressed));
    button.tabIndex = -1;
    button.append(svgIcon(icon));
    return button;
  }

  function renderLists() {
    const scene = live();
    const scenes = JSON.stringify([doc.liveScene, doc.scenes.map((s) => [s.id, s.name])]);
    if (scenes !== scenesSignature && renaming?.list !== 'scene') {
      scenesSignature = scenes;
      els.sceneList.replaceChildren(...doc.scenes.map((s) => listItem('scene', s.id, s.id === doc.liveScene, s.name)));
    }
    const sources = JSON.stringify([scene.id, selectedId, scene.sources.map((s) => [s.id, s.name, s.type, s.visible, s.locked, Boolean(statusText(s))])]);
    if (sources !== sourcesSignature && renaming?.list !== 'source') {
      sourcesSignature = sources;
      const rows = [...scene.sources].reverse().map((source) => {
        const row = listItem('source', source.id, source.id === selectedId, source.name);
        row.classList.toggle('is-off', !source.visible);
        row.classList.toggle('is-waiting', Boolean(statusText(source)));
        row.prepend(svgIcon(ICONS[source.type], 'icon item-icon'));
        row.append(
          itemButton('source-visible', source.visible ? 'i-eye' : 'i-eye-slash', source.visible ? `Ocultar ${source.name}` : `Mostrar ${source.name}`, !source.visible),
          itemButton('source-lock', source.locked ? 'i-lock' : 'i-lock-open', source.locked ? `Desbloquear ${source.name}` : `Bloquear ${source.name}`, source.locked),
        );
        return row;
      });
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'Esta escena no tiene fuentes. Agrega una con +.';
        rows.push(empty);
      }
      els.sourceList.replaceChildren(...rows);
    }
    const index = scene.sources.findIndex((s) => s.id === selectedId);
    els.sceneRemove.disabled = doc.scenes.length <= 1;
    els.sourceUp.disabled = index < 0 || index === scene.sources.length - 1;
    els.sourceDown.disabled = index <= 0;
    els.sourceRemove.disabled = index < 0;
  }

  function startRename(list, id) {
    const container = list === 'scene' ? els.sceneList : els.sourceList;
    const row = container.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const label = row?.querySelector('.item-name');
    if (!label) return;
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = label.textContent;
    input.maxLength = 80;
    input.spellcheck = false;
    input.setAttribute('aria-label', list === 'scene' ? 'Nombre de la escena' : 'Nombre de la fuente');
    renaming = { list, id };
    label.replaceWith(input);
    input.focus();
    input.select();
    const finish = (commit) => {
      if (!renaming) return;
      renaming = null;
      scenesSignature = '';
      sourcesSignature = '';
      const name = input.value.trim();
      if (commit && name) rename(list, id, name);
      else scheduleRender();
      container.focus();
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  // --- Salida: selección, manijas y guías ---

  const selection = document.createElement('div');
  selection.className = 'selection';
  selection.hidden = true;
  for (const handle of HANDLES) {
    const knob = document.createElement('span');
    knob.className = `handle handle--${handle}`;
    knob.dataset.handle = handle;
    selection.append(knob);
  }
  const guideX = Object.assign(document.createElement('div'), { className: 'guide guide--x', hidden: true });
  const guideY = Object.assign(document.createElement('div'), { className: 'guide guide--y', hidden: true });
  const placeholders = document.createElement('div');
  placeholders.className = 'placeholders';
  els.overlay.append(placeholders, selection, guideX, guideY);
  let placeholdersSignature = '';

  function place(element, t, k) {
    element.style.left = `${(t.x * k).toFixed(1)}px`;
    element.style.top = `${(t.y * k).toFixed(1)}px`;
    element.style.width = `${(t.width * k).toFixed(1)}px`;
    element.style.height = `${(t.height * k).toFixed(1)}px`;
  }

  function renderOverlay() {
    const canvas = canvasSize();
    const k = els.output.clientWidth / canvas.width;
    const scene = live();
    const waiting = scene.sources.filter((s) => s.visible).map((s) => [s, statusText(s)]).filter(([, text]) => text);
    const signature = JSON.stringify([k, waiting.map(([s, text]) => [s.id, text, s.transform])]);
    if (signature !== placeholdersSignature) {
      placeholdersSignature = signature;
      // Dentro de lo visible y apartado del borde redondeado de la salida.
      const inset = 8 / k;
      const boxes = waiting
        .map(([source, text]) => {
          const t = source.transform;
          const rect = { x: Math.max(t.x, inset), y: Math.max(t.y, inset) };
          rect.width = Math.min(t.x + t.width, canvas.width - inset) - rect.x;
          rect.height = Math.min(t.y + t.height, canvas.height - inset) - rect.y;
          return { source, text, rect };
        })
        .filter(({ rect }) => rect.width >= 24 / k && rect.height >= 24 / k)
        .map(({ source, text, rect }) => {
          const box = document.createElement('div');
          box.className = 'placeholder-box';
          place(box, rect, k);
          box.append(svgIcon(ICONS[source.type]));
          const label = document.createElement('span');
          label.textContent = text;
          box.append(label);
          return box;
        });
      placeholders.replaceChildren(...boxes);
    }
    const source = selected();
    selection.hidden = !source;
    if (source) {
      place(selection, source.transform, k);
      selection.classList.toggle('is-locked', source.locked);
    }
    const guides = drag?.guides ?? [];
    const gx = guides.find((g) => g.axis === 'x');
    const gy = guides.find((g) => g.axis === 'y');
    guideX.hidden = !gx;
    guideY.hidden = !gy;
    if (gx) guideX.style.left = `${(gx.at * k).toFixed(1)}px`;
    if (gy) guideY.style.top = `${(gy.at * k).toFixed(1)}px`;
  }

  function renderLabel() {
    const text = `${live().name} · ${doc.output}`;
    if (els.label.textContent !== text) els.label.textContent = text;
  }

  let renderQueued = false;
  function renderNow() {
    renderQueued = false;
    renderLists();
    renderInspector();
    renderOverlay();
    renderLabel();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderNow);
  }

  // --- Puntero sobre la salida ---

  function toCanvas(event) {
    const rect = els.output.getBoundingClientRect();
    const k = canvasSize().width / rect.width;
    return { x: (event.clientX - rect.left) * k, y: (event.clientY - rect.top) * k, k };
  }

  els.overlay.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    els.overlay.focus({ preventScroll: true });
    const point = toCanvas(event);
    const handle = event.target.closest('[data-handle]')?.dataset.handle;
    // Dentro de la fuente elegida se arrastra esa, aunque otra la tape.
    const current = selected();
    const t = current?.transform;
    const inside = t && !current.locked && point.x >= t.x && point.x <= t.x + t.width && point.y >= t.y && point.y <= t.y + t.height;
    const source = handle || inside ? current : hitTest(live(), point.x, point.y);
    if (!source) {
      select(null);
      return;
    }
    select(source.id);
    if (source.locked) return;
    event.preventDefault();
    drag = { id: source.id, handle, start: point, from: { ...source.transform }, moved: false, guides: [], pointerId: event.pointerId };
    els.overlay.setPointerCapture(event.pointerId);
  });

  els.overlay.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = toCanvas(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX * point.k) return;
    const source = sourceById(drag.id);
    if (!source) return;
    if (!drag.moved) {
      drag.moved = true;
      remember();
      autoFit.delete(source.id);
      els.frame.classList.add('is-dragging');
    }
    const canvas = canvasSize();
    if (drag.handle) {
      // Las esquinas mantienen la proporción; con Mayúsculas, libre.
      source.transform = resizeTransform(drag.from, drag.handle, dx, dy, { free: event.shiftKey });
      drag.guides = [];
    } else {
      const moved = { ...drag.from, x: Math.round(drag.from.x + dx), y: Math.round(drag.from.y + dy) };
      // El imán acerca bordes y centro a los de la salida; Mayúsculas lo apaga.
      const snapped = event.shiftKey ? { transform: moved, guides: [] } : snapTransform(moved, canvas, SNAP_PX * point.k);
      source.transform = snapped.transform;
      drag.guides = snapped.guides;
    }
    engine.show(live());
    scheduleRender();
  });

  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    drag = null;
    els.frame.classList.remove('is-dragging');
    if (moved) changed();
    else scheduleRender();
  };
  els.overlay.addEventListener('pointerup', endDrag);
  els.overlay.addEventListener('pointercancel', endDrag);
  els.overlay.addEventListener('lostpointercapture', endDrag);

  new ResizeObserver(() => {
    placeholdersSignature = '';
    scheduleRender();
  }).observe(els.output);

  // --- Archivos arrastrados desde el Finder ---

  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  els.outputArea.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    els.dropHint.hidden = false;
  });
  els.outputArea.addEventListener('dragleave', (event) => {
    if (!els.outputArea.contains(event.relatedTarget)) els.dropHint.hidden = true;
  });
  els.outputArea.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    els.dropHint.hidden = true;
    const point = toCanvas(event);
    for (const file of event.dataTransfer.files) {
      const response = await backend.send('importMediaPath', backend.pathForFile?.(file) ?? '');
      if (response?.ok && response.result) await addImported(response.result, point);
      else toast(`«${file.name}» no es una imagen ni un video que se pueda usar.`, 'error');
    }
  });

  // --- Menús contextuales ---

  async function popup(event, items) {
    event.preventDefault();
    const response = await backend.send('popupMenu', { x: event.clientX, y: event.clientY, items });
    return response?.result ?? null;
  }

  async function sceneMenu(event, id) {
    const index = doc.scenes.findIndex((scene) => scene.id === id);
    const choice = await popup(event, [
      { id: 'rename', label: 'Renombrar' },
      { id: 'duplicate', label: 'Duplicar' },
      { type: 'separator' },
      { id: 'up', label: 'Subir', enabled: index > 0 },
      { id: 'down', label: 'Bajar', enabled: index < doc.scenes.length - 1 },
      { type: 'separator' },
      { id: 'remove', label: 'Quitar', enabled: doc.scenes.length > 1 },
    ]);
    if (choice === 'rename') startRename('scene', id);
    else if (choice === 'duplicate') {
      goLive(id);
      duplicateLiveScene();
    } else if (choice === 'up') moveScene(id, -1);
    else if (choice === 'down') moveScene(id, 1);
    else if (choice === 'remove') removeScene(id);
  }

  async function sourceMenu(event, id) {
    const scene = live();
    const source = sourceById(id);
    if (!source) return;
    select(id);
    const index = scene.sources.indexOf(source);
    const top = index === scene.sources.length - 1;
    const choice = await popup(event, [
      { id: 'rename', label: 'Renombrar' },
      { id: 'duplicate', label: 'Duplicar' },
      { id: 'copy', label: 'Copiar' },
      { id: 'paste', label: 'Pegar', enabled: Boolean(clipboard) },
      { type: 'separator' },
      { id: 'visible', label: 'Mostrar', checked: source.visible },
      { id: 'lock', label: 'Bloquear', checked: source.locked },
      { type: 'separator' },
      { id: 'fit', label: 'Ajustar a la salida' },
      { id: 'fill', label: 'Llenar la salida' },
      { id: 'center', label: 'Tamaño original' },
      { id: 'uncrop', label: 'Quitar el recorte', enabled: Object.values(source.crop).some(Boolean) },
      { type: 'separator' },
      { id: 'front', label: 'Al frente', enabled: !top },
      { id: 'forward', label: 'Subir', enabled: !top },
      { id: 'backward', label: 'Bajar', enabled: index > 0 },
      { id: 'back', label: 'Al fondo', enabled: index > 0 },
      { type: 'separator' },
      { id: 'remove', label: 'Quitar' },
    ]);
    const actions = {
      rename: () => startRename('source', id),
      duplicate: () => duplicateSource(id),
      copy: () => {
        clipboard = structuredClone(source);
      },
      paste: pasteSource,
      visible: () => editSource(id, '', (s) => (s.visible = !s.visible)),
      lock: () => editSource(id, '', (s) => (s.locked = !s.locked)),
      fit: () => fit(id, 'fit'),
      fill: () => fit(id, 'fill'),
      center: () => fit(id, 'center'),
      uncrop: () =>
        editSource(id, '', (s) => {
          const next = applyCrop(s, { top: 0, right: 0, bottom: 0, left: 0 });
          s.crop = next.crop;
          s.transform = next.transform;
        }),
      front: () => shiftSource(id, Infinity),
      forward: () => shiftSource(id, 1),
      backward: () => shiftSource(id, -1),
      back: () => shiftSource(id, -Infinity),
      remove: () => removeSource(id),
    };
    actions[choice]?.();
  }

  els.sceneList.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.list-item');
    if (row) sceneMenu(event, row.dataset.id);
  });
  els.sourceList.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.list-item');
    if (row) sourceMenu(event, row.dataset.id);
  });
  els.overlay.addEventListener('contextmenu', async (event) => {
    const point = toCanvas(event);
    const source = hitTest(live(), point.x, point.y);
    if (source) {
      sourceMenu(event, source.id);
      return;
    }
    const choice = await popup(event, [{ id: 'paste', label: 'Pegar', enabled: Boolean(clipboard) }]);
    if (choice === 'paste') pasteSource();
  });

  // --- Clics y teclado ---

  const ACTIONS = {
    'scene-add': () => addScene(),
    'scene-duplicate': duplicateLiveScene,
    'scene-remove': () => removeScene(),
    'source-add': openAddMenu,
    'source-up': () => shiftSource(selectedId, 1),
    'source-down': () => shiftSource(selectedId, -1),
    'source-remove': () => removeSource(),
    'source-fit': (target) => selectedId && fit(selectedId, target.dataset.mode),
    'chroma-preset': (target) => selectedId && editSource(selectedId, '', (s) => (s.chroma.color = target.dataset.color)),
    'capture-pick': () => selectedId && replaceScreen(selectedId),
    'capture-close': () => closeCapture(null),
    'capture-refresh': loadCaptures,
    'capture-choose': (target) => closeCapture({ id: target.dataset.id, name: target.dataset.name }),
    'capture-privacy': () => backend.send('openPrivacySettings', 'screen'),
    'media-replace': () => selectedId && replaceMedia(selectedId),
  };

  function onClick(event) {
    const target = event.target.closest('[data-action]');
    const row = event.target.closest('.list-item');
    if (target && Object.hasOwn(ACTIONS, target.dataset.action)) {
      ACTIONS[target.dataset.action](target);
      return;
    }
    if (target && row && (target.dataset.action === 'source-visible' || target.dataset.action === 'source-lock')) {
      const key = target.dataset.action === 'source-visible' ? 'visible' : 'locked';
      editSource(row.dataset.id, '', (s) => (s[key] = !s[key]));
      return;
    }
    if (!row || renaming) return;
    if (row.dataset.list === 'scene') goLive(row.dataset.id);
    else select(row.dataset.id);
  }

  els.view.addEventListener('click', onClick);
  els.captureDialog.addEventListener('click', onClick);
  els.captureDialog.addEventListener('close', () => closeCapture(null));
  for (const list of [els.sceneList, els.sourceList]) {
    list.addEventListener('dblclick', (event) => {
      const row = event.target.closest('.list-item');
      if (row && !event.target.closest('.item-btn')) startRename(row.dataset.list, row.dataset.id);
    });
  }

  // Flechas en las listas: escena anterior o siguiente, fuente de arriba o de abajo.
  function onListKey(event, list) {
    const ids = list === 'scene' ? doc.scenes.map((s) => s.id) : [...live().sources].reverse().map((s) => s.id);
    const current = list === 'scene' ? doc.liveScene : selectedId;
    const index = ids.indexOf(current);
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (step) {
      event.preventDefault();
      const next = ids[clamp(index < 0 ? 0 : index + step, 0, ids.length - 1)];
      if (next) list === 'scene' ? goLive(next) : select(next);
      return true;
    }
    if (event.key === 'Enter' && current) {
      event.preventDefault();
      startRename(list, current);
      return true;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && current) {
      event.preventDefault();
      list === 'scene' ? removeScene(current) : removeSource(current);
      return true;
    }
    return false;
  }

  function onKeyDown(event) {
    if (els.captureDialog.open) return false;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.target.closest('input, textarea, select')) return false;
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return true;
    }
    if (mod && key === 'd' && selectedId) {
      event.preventDefault();
      duplicateSource();
      return true;
    }
    if (mod && key === 'c' && selected()) {
      clipboard = structuredClone(selected());
      return true;
    }
    if (mod && key === 'v' && clipboard) {
      event.preventDefault();
      pasteSource();
      return true;
    }
    if (mod || event.altKey) return false;
    const list = event.target.closest('.list');
    if (list) return onListKey(event, list === els.sceneList ? 'scene' : 'source');
    const source = selected();
    if (!source) return false;
    const step = event.shiftKey ? 10 : 1;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (nudge) {
      event.preventDefault();
      if (source.locked) return true;
      editSource(source.id, `nudge:${source.id}`, (s) => {
        s.transform = { ...s.transform, x: s.transform.x + nudge[0], y: s.transform.y + nudge[1] };
        autoFit.delete(s.id);
      });
      return true;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      removeSource(source.id);
      return true;
    }
    if (event.key === 'Escape') {
      select(null);
      return true;
    }
    return false;
  }

  els.paneSource.addEventListener('input', (event) => {
    const field = event.target.closest('[data-field]');
    if (field && field.type !== 'checkbox' && field.type !== 'radio' && field.tagName !== 'SELECT') onField(field);
    const crop = event.target.closest('[data-crop]');
    if (crop) onCrop(crop);
  });
  els.paneSource.addEventListener('change', (event) => {
    const field = event.target.closest('[data-field]');
    if (field) onField(field);
    // Al terminar de escribir se muestra el valor que quedó (por ejemplo, el mínimo de 16).
    scheduleRender();
  });
  els.paneOutput.addEventListener('change', (event) => {
    const input = event.target.closest('[data-out]');
    if (input) onOutputField(input);
  });
  // Las flechas con Mayúsculas suben o bajan de a 10 en los campos de números.
  els.view.addEventListener('keydown', (event) => {
    const input = event.target;
    if (input.type !== 'number' || !event.shiftKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    input.value = String(Number(input.value || 0) + (event.key === 'ArrowUp' ? 10 : -10));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // --- Arranque ---

  // Como en los ajustes de la cámara del iPhone: «1080p HD a 60 fps».
  const outputName = (o) => `${o.height === 2160 ? '4K' : `${o.height}p${o.height <= 1080 ? ' HD' : ''}`} a ${o.fps} fps`;
  els.resolution.replaceChildren(...OUTPUTS.map((o) => new Option(outputName(o), o.id)));
  els.font.replaceChildren(...Object.entries(TEXT_FONTS).map(([id, font]) => new Option(font.label, id)));
  addEventListener('beforeunload', () => {
    if (saveTimer) save();
  });

  // Para las pruebas automáticas (smoke:ui) y para revisar a mano.
  globalThis.tenveoStudio = {
    get doc() {
      return doc;
    },
    get selectedId() {
      return selectedId;
    },
    addSource,
    addImported,
    select,
    goLive,
    addScene,
    undo,
    redo,
    save,
    stats: () => engine.stats,
    status: (key) => engine.status(key),
    probe: (points) => engine.probe(points),
    edit: (id, edit) => editSource(id, '', edit),
    // Cambia un campo de la fuente elegida como lo haría Propiedades.
    set: (path, value) => selectedId && editSource(selectedId, '', (source) => applyField(source, path, value)),
  };

  let watchingDevices = false;
  return {
    show(on) {
      if (visible === on) return;
      visible = on;
      engine.setActive(on);
      if (on) {
        // Las cámaras se buscan recién al abrir Producción, no al abrir la app.
        if (!watchingDevices) navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
        watchingDevices = true;
        refreshDevices();
      }
      scheduleRender();
    },
    onKeyDown,
    goLive,
    scenes: () => doc.scenes.map(({ id, name }) => ({ id, name })),
    liveScene: () => doc.liveScene,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: scheduleRender,
  };
}

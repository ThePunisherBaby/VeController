// Motor del estudio de producción, del lado de la ventana.
//
// Enciende lo que usa la escena en vivo y le pasa sus imágenes al compositor
// (production-worker.js):
//   - cámaras y pantallas: getUserMedia → MediaStreamTrackProcessor, y los
//     cuadros van directo al worker por un stream transferido;
//   - videos: un <video> sin mostrar, cuadro por cuadro (VideoFrame);
//   - imágenes: las decodifica el worker (también GIF animados);
//   - textos: se dibujan aquí con la letra del sistema, a la escala a la que se
//     ven, para que salgan nítidos;
//   - el programa del PC500: el worker del monitor PGM manda una copia de cada
//     cuadro por un MessagePort.
// Lo que deja de usarse se apaga unos segundos después, así volver a una
// escena es instantáneo.

import { TEXT_FONTS, cropUv, outputFor, resourceKey } from '../../core/production.js';

const RELEASE_AFTER_MS = 8000;

const mediaUrl = (media) => new URL(`/media/${media}`, location.href).href;

/** Cómo se acomoda un texto: tamaño de cada renglón y de la caja, sin dibujarlo. */
export function layoutText(settings, scale = 1) {
  const size = Math.max(1, settings.size * scale);
  const family = TEXT_FONTS[settings.font]?.css ?? TEXT_FONTS.system.css;
  const font = `${settings.bold ? 700 : 400} ${size}px ${family}`;
  const lines = String(settings.text || ' ').split('\n');
  const ctx = layoutText.ctx ?? (layoutText.ctx = new OffscreenCanvas(1, 1).getContext('2d'));
  ctx.font = font;
  const widths = lines.map((line) => ctx.measureText(line || ' ').width);
  const lineHeight = Math.ceil(size * 1.2);
  const boxed = settings.backgroundOpacity > 0;
  const padX = Math.ceil(boxed ? size * 0.45 : size * 0.12) + (settings.shadow ? Math.ceil(size * 0.15) : 0);
  const padY = Math.ceil(boxed ? size * 0.25 : size * 0.06) + (settings.shadow ? Math.ceil(size * 0.15) : 0);
  const width = Math.ceil(Math.max(...widths)) + padX * 2;
  const height = lineHeight * lines.length + padY * 2;
  return { font, lines, widths, lineHeight, padX, padY, width, height, size };
}

async function rasterizeText(settings, scale) {
  const layout = layoutText(settings, scale);
  const canvas = new OffscreenCanvas(layout.width, layout.height);
  const ctx = canvas.getContext('2d');
  if (settings.backgroundOpacity > 0) {
    ctx.globalAlpha = settings.backgroundOpacity;
    ctx.fillStyle = settings.background;
    ctx.beginPath();
    ctx.roundRect(0, 0, layout.width, layout.height, layout.size * 0.22);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (settings.shadow) {
    ctx.shadowColor = 'rgb(0 0 0 / 0.55)';
    ctx.shadowBlur = layout.size * 0.12;
    ctx.shadowOffsetY = layout.size * 0.04;
  }
  ctx.font = layout.font;
  ctx.fillStyle = settings.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = settings.align;
  const x = settings.align === 'left' ? layout.padX : settings.align === 'right' ? layout.width - layout.padX : layout.width / 2;
  layout.lines.forEach((line, i) => ctx.fillText(line, x, layout.padY + layout.lineHeight * (i + 0.5)));
  return createImageBitmap(canvas, { premultiplyAlpha: 'none' });
}

export function createProductionEngine({ canvas, pgm, onNatural = () => {}, onStatus = () => {} }) {
  const worker = new Worker(new URL('./production-worker.js', import.meta.url), { type: 'module' });
  let output = outputFor();
  const offscreen = canvas.transferControlToOffscreen();
  worker.postMessage({ type: 'init', canvas: offscreen, width: output.width, height: output.height }, [offscreen]);

  // El programa del PC500 llega directo del worker del monitor PGM.
  const channel = new MessageChannel();
  worker.postMessage({ type: 'port', port: channel.port1 }, [channel.port1]);
  pgm?.tap(channel.port2);

  let active = false;
  let scene = null;
  const resources = new Map(); // key → { handle, timer, error }
  const status = new Map(); // key → { state: 'opening' | 'live' | 'error', message }
  const texts = new Map(); // id de la fuente → firma del último texto dibujado
  const probes = new Map(); // pruebas: id → resolve
  let probeId = 0;
  let stats = null;

  function setStatus(key, state, message = '') {
    const prev = status.get(key);
    if (prev?.state === state && prev.message === message) return;
    status.set(key, { state, message });
    onStatus();
  }

  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'natural') onNatural(message.key, { width: message.width, height: message.height });
    else if (message.type === 'signal') {
      if (message.on) setStatus(message.key, 'live');
      else if (status.get(message.key)?.state === 'live') setStatus(message.key, resources.has(message.key) ? 'opening' : 'off');
    } else if (message.type === 'stats') {
      stats = message.stats;
      globalThis.tenveoProductionStats = stats;
    } else if (message.type === 'probe') {
      probes.get(message.id)?.(message.pixels);
      probes.delete(message.id);
    } else if (message.type === 'lost') {
      // La GPU se reinició: se vuelven a mandar los textos.
      texts.clear();
      if (scene) syncTexts(scene);
    } else if (message.type === 'error') console.warn('[Producción]', message.message);
  };

  // --- Cámaras, pantallas y videos ---

  function startTrack(key, stream) {
    const [track] = stream.getVideoTracks();
    const processor = new MediaStreamTrackProcessor({ track });
    worker.postMessage({ type: 'stream', key, readable: processor.readable }, [processor.readable]);
    track.addEventListener('ended', () => {
      if (resources.has(key)) setStatus(key, 'error', 'La fuente se desconectó.');
    });
    return {
      stop() {
        for (const t of stream.getTracks()) t.stop();
      },
    };
  }

  async function openCamera(key, deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: output.fps } },
    });
    return startTrack(key, stream);
  }

  async function openScreen(key, sourceId) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 3840, maxHeight: 2160, maxFrameRate: output.fps } },
    });
    return startTrack(key, stream);
  }

  function openVideo(key, media, loop) {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = loop;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = mediaUrl(media);
    let stopped = false;
    let handle = 0;
    const pump = (_now, meta) => {
      if (stopped) return;
      try {
        const frame = new VideoFrame(video, { timestamp: Math.round(meta.mediaTime * 1e6) });
        worker.postMessage({ type: 'frame', key, frame }, [frame]);
      } catch {
        // Un cuadro que no se pudo copiar: llega el siguiente.
      }
      handle = video.requestVideoFrameCallback(pump);
    };
    handle = video.requestVideoFrameCallback(pump);
    video.addEventListener('error', () => setStatus(key, 'error', 'No se pudo reproducir el video.'));
    video.play().catch((error) => {
      if (!stopped) setStatus(key, 'error', `No se pudo reproducir el video: ${error.message}`);
    });
    return {
      video,
      restart() {
        video.currentTime = 0;
        video.play().catch(() => {});
      },
      stop() {
        stopped = true;
        video.cancelVideoFrameCallback(handle);
        video.pause();
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  function describeError(key, error) {
    const name = error?.name ?? '';
    if (key.startsWith('camera:')) {
      if (name === 'NotAllowedError') return 'Sin permiso para la cámara. Habilítalo en Ajustes del Sistema › Privacidad › Cámara.';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'La cámara no está conectada.';
      if (name === 'NotReadableError') return 'Otra app está usando la cámara.';
    }
    if (key.startsWith('screen:')) {
      if (name === 'NotAllowedError') return 'Sin permiso para grabar la pantalla. Habilítalo en Ajustes del Sistema › Privacidad › Grabación de pantalla y vuelve a abrir la app.';
      return 'Esa pantalla o ventana ya no está. Elige otra.';
    }
    return String(error?.message ?? error);
  }

  function acquire(key, source) {
    const entry = { handle: null, timer: 0 };
    resources.set(key, entry);
    const kind = key.split(':')[0];
    if (kind === 'pc500') {
      pgm?.setTap(true);
      setStatus(key, 'opening');
      return;
    }
    if (kind === 'image') {
      worker.postMessage({ type: 'image', key, url: mediaUrl(source.settings.media) });
      setStatus(key, 'opening');
      return;
    }
    if (kind === 'video') {
      entry.handle = openVideo(key, source.settings.media, source.settings.loop);
      setStatus(key, 'opening');
      return;
    }
    if (kind === 'camera' || kind === 'screen') {
      setStatus(key, 'opening');
      const id = key.slice(kind.length + 1);
      const open = kind === 'camera' ? openCamera(key, id) : openScreen(key, id);
      open.then(
        (handle) => {
          if (resources.get(key) === entry) entry.handle = handle;
          else handle.stop();
        },
        (error) => {
          if (resources.get(key) === entry) setStatus(key, 'error', describeError(key, error));
        },
      );
    }
  }

  function release(key) {
    const entry = resources.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    resources.delete(key);
    entry.handle?.stop();
    if (key === 'pc500') pgm?.setTap(false);
    worker.postMessage({ type: 'release', key });
    status.delete(key);
    onStatus();
  }

  // Deja encendido justo lo que se usa; lo demás se apaga más tarde.
  function want(sources) {
    const wanted = new Map();
    for (const source of sources) {
      const key = resourceKey(source);
      if (key && !key.startsWith('text:') && !wanted.has(key)) wanted.set(key, source);
    }
    for (const [key, source] of wanted) {
      const entry = resources.get(key);
      if (!entry) acquire(key, source);
      else if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = 0;
      }
    }
    for (const [key, entry] of resources) {
      if (!wanted.has(key) && !entry.timer) entry.timer = setTimeout(() => release(key), RELEASE_AFTER_MS);
    }
  }

  // --- Textos ---

  function textScale(source) {
    const scale = source.transform.width / Math.max(1, source.natural.width);
    return Math.min(4, Math.max(0.25, Math.round(scale * 4) / 4));
  }

  function syncTexts(current) {
    const alive = new Set();
    for (const source of current.sources) {
      if (source.type !== 'text') continue;
      alive.add(source.id);
      const scale = textScale(source);
      const signature = JSON.stringify([source.settings, scale]);
      if (texts.get(source.id) === signature) continue;
      texts.set(source.id, signature);
      const key = resourceKey(source);
      rasterizeText(source.settings, scale).then((bitmap) => {
        if (texts.get(source.id) === signature) worker.postMessage({ type: 'bitmap', key, bitmap }, [bitmap]);
        else bitmap.close();
      });
    }
    for (const id of texts.keys()) {
      if (alive.has(id)) continue;
      texts.delete(id);
      worker.postMessage({ type: 'release', key: `text:${id}` });
    }
  }

  // --- Escena ---

  function layersOf(current) {
    return current.sources
      .filter((source) => source.visible)
      .map((source) => ({
        key: resourceKey(source),
        type: source.type,
        color: source.type === 'color' ? source.settings.color : '',
        transform: source.transform,
        uv: cropUv(source),
        opacity: source.opacity,
        chroma: source.chroma,
      }));
  }

  function syncVideos(current, activated) {
    for (const source of current.sources) {
      if (source.type !== 'video') continue;
      const handle = resources.get(resourceKey(source))?.handle;
      if (!handle) continue;
      if (handle.video.loop !== source.settings.loop) handle.video.loop = source.settings.loop;
      if (activated && source.settings.restart) handle.restart();
    }
  }

  return {
    /** Muestra una escena. transition: { kind, ms } al cambiar de escena; null al editarla. */
    show(next, { transition = null, activated = false } = {}) {
      scene = next;
      if (!active || !next) return;
      want(next.sources);
      syncTexts(next);
      syncVideos(next, activated);
      const fade = transition?.kind === 'fade' ? { ms: transition.ms } : null;
      worker.postMessage({ type: 'scene', layers: layersOf(next), transition: fade });
    },
    setOutput(id) {
      output = outputFor(id);
      worker.postMessage({ type: 'output', width: output.width, height: output.height });
    },
    /** Sin la vista a la vista (y nada al aire) no se dibuja y las fuentes se apagan. */
    setActive(on) {
      if (active === on) return;
      active = on;
      worker.postMessage({ type: 'active', on });
      if (on && scene) this.show(scene);
      else if (!on) want([]);
    },
    status(key) {
      return status.get(key) ?? null;
    },
    /** Pruebas: el color [r, g, b, a] de unos puntos de la salida, en sus píxeles. */
    probe(points) {
      const id = ++probeId;
      return new Promise((resolve) => {
        probes.set(id, resolve);
        worker.postMessage({ type: 'probe', id, points });
      });
    },
    get stats() {
      return stats;
    },
    releaseAll() {
      for (const key of [...resources.keys()]) release(key);
    },
  };
}

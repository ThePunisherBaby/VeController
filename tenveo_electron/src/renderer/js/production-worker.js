// Compositor del estudio de producción (worker, WebGL2).
//
// Dibuja la escena en vivo en el canvas de la salida. Cada fuente es un
// rectángulo con su imagen (o un color), recortado y con su opacidad. Si se
// pide, lleva chroma key: el mismo de OBS, por distancia en CbCr, con
// similitud, suavidad y reducción del derrame. Al cambiar de escena hace un
// fundido entre las dos, dibujadas cada una en su propia textura.
//
// Solo dibuja cuando algo cambió: un cuadro nuevo de una fuente que se ve, la
// escena o una transición en curso. Un cuadro de video se dibuja apenas llega
// si el compositor está libre (como el monitor PGM: menos latencia y ningún
// cuadro perdido); lo demás espera al próximo cuadro de la pantalla. Con la
// ventana oculta no hay cuadros de pantalla y un temporizador hace de reloj.
//
// Mensajes que recibe:
//   init { canvas, width, height }     el canvas de la salida
//   output { width, height }           resolución de salida
//   scene { layers, transition }       capas de la escena en vivo (abajo → arriba)
//   frame { key, frame }               último cuadro (VideoFrame) de una fuente
//   stream { key, readable }           cuadros de una cámara o una pantalla
//   bitmap { key, bitmap }             imagen fija (texto)
//   image { key, url }                 imagen de la producción (PNG, JPEG, GIF animado…)
//   release { key }                    ya no se usa: se libera
//   port { port }                      cuadros del programa del PC500 (pgm-worker)
//   active { on }                      dibujar o no (vista oculta y nada al aire)
//   probe { id, points }               pruebas: color de unos píxeles de la salida
// Mensajes que manda: natural { key, width, height }, signal { key, on },
// stats { … }, probe { id, pixels } y error { message }.

const VERTEX = `#version 300 es
in vec2 a_pos;
uniform vec4 u_rect;   // x, y, ancho y alto en píxeles de la salida
uniform vec2 u_canvas;
uniform vec4 u_uv;     // u0, v0 (arriba a la izquierda), u1, v1
out vec2 v_uv;
void main() {
  vec2 px = u_rect.xy + a_pos * u_rect.zw;
  vec2 clip = px / u_canvas * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = mix(u_uv.xy, u_uv.zw, a_pos);
}`;

// Chroma key como el filtro de OBS (chroma_key_filter_v2): distancia del
// color a la clave en CbCr, promediada con 4 vecinos para suavizar el borde.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform bool u_solid;
uniform vec4 u_color;
uniform float u_opacity;
uniform bool u_chroma;
uniform vec2 u_key;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;
uniform vec2 u_texel;
out vec4 outColor;

const vec4 CB = vec4(-0.100644, -0.338572, 0.439216, 0.501961);
const vec4 CR = vec4(0.439216, -0.398942, -0.040274, 0.501961);

float chromaDistance(vec3 rgb) {
  return distance(u_key, vec2(dot(rgb, CB.xyz) + CB.w, dot(rgb, CR.xyz) + CR.w));
}

float filteredDistance(vec3 rgb, vec2 uv) {
  vec2 half_texel = u_texel * 0.5;
  vec2 a = vec2(u_texel.x, half_texel.y);
  vec2 b = vec2(half_texel.x, -u_texel.y);
  float d = chromaDistance(texture(u_tex, uv - a).rgb);
  d += chromaDistance(texture(u_tex, uv + a).rgb);
  d += chromaDistance(texture(u_tex, uv - b).rgb);
  d += chromaDistance(texture(u_tex, uv + b).rgb);
  return (d * 2.0 + chromaDistance(rgb)) / 9.0;
}

void main() {
  vec4 c = u_solid ? u_color : texture(u_tex, v_uv);
  if (u_chroma) {
    float base = filteredDistance(c.rgb, v_uv) - u_similarity;
    float mask = pow(clamp(base / max(u_smoothness, 0.0001), 0.0, 1.0), 1.5);
    float spill = pow(clamp(base / max(u_spill, 0.0001), 0.0, 1.0), 1.5);
    float gray = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(gray), c.rgb, spill);
    c.a *= mask;
  }
  c.a *= u_opacity;
  outColor = vec4(c.rgb * c.a, c.a);
}`;

const FULL_UV = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });
// Las texturas que dibuja WebGL quedan de abajo hacia arriba.
const TARGET_UV = Object.freeze({ u0: 0, v0: 1, u1: 1, v1: 0 });

let canvas = null;
let gl = null;
let program = null;
let loc = null;
let lost = false;
let active = true;
let size = { width: 1920, height: 1080 };

let current = []; // capas de la escena en vivo
let fade = null; // { from, start, ms } mientras dura el fundido
let targets = null; // dos texturas del tamaño de la salida, para el fundido

const sources = new Map(); // key → { texture, width, height, pending, ready }
const streams = new Map(); // key → reader de una cámara o una pantalla
const images = new Map(); // key → { url, token }

const stats = { draws: 0, frames: 0, uploads: 0, last: 0, fps: 0 };
let probes = []; // pedidos de las pruebas, que se leen al terminar el próximo cuadro

function post(message) {
  self.postMessage(message);
}

// --- WebGL ---

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  return shader;
}

function setupGl() {
  gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    desynchronized: true,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('Esta Mac no tiene WebGL2: el estudio no puede dibujar la salida.');
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');
  gl.useProgram(program);
  const names = ['u_rect', 'u_canvas', 'u_uv', 'u_tex', 'u_solid', 'u_color', 'u_opacity', 'u_chroma', 'u_key', 'u_similarity', 'u_smoothness', 'u_spill', 'u_texel'];
  loc = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
  gl.uniform1i(loc.u_tex, 0);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // Alfa sin premultiplicar en las texturas: el shader la aplica al final.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  targets = null;
}

function newTexture() {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function ensureTargets() {
  if (targets && targets.width === size.width && targets.height === size.height) return targets;
  if (targets) {
    for (const t of targets.list) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
  }
  const list = [0, 1].map(() => {
    const texture = newTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { texture, framebuffer };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  targets = { width: size.width, height: size.height, list };
  return targets;
}

function hexColor(hex) {
  const n = Number.parseInt(String(hex).slice(1), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function keyCbCr(hex) {
  const [r, g, b] = hexColor(hex);
  return [-0.100644 * r - 0.338572 * g + 0.439216 * b + 0.501961, 0.439216 * r - 0.398942 * g - 0.040274 * b + 0.501961];
}

// --- Imágenes de las fuentes ---

function entryFor(key) {
  let entry = sources.get(key);
  if (!entry) {
    entry = { texture: null, width: 0, height: 0, pending: null, ready: false };
    sources.set(key, entry);
  }
  return entry;
}

function closeImage(image) {
  try {
    image?.close();
  } catch {
    // Ya estaba cerrada.
  }
}

// Llega una imagen nueva de una fuente: se guarda solo la última.
function accept(key, image) {
  const entry = entryFor(key);
  closeImage(entry.pending);
  entry.pending = image;
  stats.frames += 1;
  const width = image.displayWidth ?? image.width;
  const height = image.displayHeight ?? image.height;
  if (width !== entry.width || height !== entry.height) {
    const first = !entry.width;
    entry.width = width;
    entry.height = height;
    post({ type: 'natural', key, width, height });
    if (first) post({ type: 'signal', key, on: true });
  }
  if (isShown(key)) drawSoon();
}

function forget(key) {
  const entry = sources.get(key);
  if (!entry) return;
  closeImage(entry.pending);
  if (entry.texture && gl) gl.deleteTexture(entry.texture);
  sources.delete(key);
  post({ type: 'signal', key, on: false });
  if (isShown(key)) requestDraw();
}

function upload(entry) {
  if (!entry.pending) return entry.ready;
  if (!entry.texture) entry.texture = newTexture();
  gl.bindTexture(gl.TEXTURE_2D, entry.texture);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.pending);
    entry.ready = true;
    stats.uploads += 1;
  } catch (error) {
    post({ type: 'error', message: `No se pudo dibujar una fuente: ${error.message}` });
  }
  closeImage(entry.pending);
  entry.pending = null;
  return entry.ready;
}

async function readStream(key, readable) {
  const reader = readable.getReader();
  streams.get(key)?.cancel().catch(() => {});
  streams.set(key, reader);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (streams.get(key) !== reader) {
        closeImage(value);
        break;
      }
      accept(key, value);
    }
  } catch {
    // La cámara o la pantalla se cerró.
  } finally {
    if (streams.get(key) === reader) {
      streams.delete(key);
      forget(key);
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Decodifica con ImageDecoder: también anima los GIF y WebP animados.
async function loadImage(key, url) {
  const token = {};
  images.set(key, { url, token });
  const alive = () => images.get(key)?.token === token;
  let decoder = null;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`no se encontró (${response.status})`);
    const type = response.headers.get('content-type') || 'image/png';
    decoder = new ImageDecoder({ data: response.body, type, premultiplyAlpha: 'none' });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (track?.animated) await decoder.completed;
    for (let index = 0; alive(); ) {
      const { image } = await decoder.decode({ frameIndex: index });
      if (!alive()) {
        closeImage(image);
        break;
      }
      const ms = (image.duration ?? 0) / 1000;
      accept(key, image);
      const count = track?.frameCount ?? 1;
      if (!track?.animated || count <= 1) break;
      // Como los navegadores: un cuadro de menos de 20 ms dura 100 ms.
      await sleep(ms >= 20 ? ms : 100);
      index = (index + 1) % count;
    }
  } catch (error) {
    if (alive()) post({ type: 'error', message: `No se pudo abrir la imagen: ${error.message}` });
  } finally {
    decoder?.close();
  }
}

function release(key) {
  const reader = streams.get(key);
  if (reader) {
    streams.delete(key);
    reader.cancel().catch(() => {});
  }
  images.delete(key);
  forget(key);
}

// --- Dibujo ---

function isShown(key) {
  if (!key) return false;
  const uses = (layers) => layers.some((layer) => layer.key === key);
  return uses(current) || Boolean(fade && uses(fade.from));
}

let queued = false;
let raf = 0;
let timer = 0;
let lastDraw = -Infinity;
const MIN_GAP_MS = 10; // dos cuadros que llegan juntos se dibujan en uno

// Un cuadro de video nuevo: si hace un rato que no se dibuja, ahora mismo.
function drawSoon() {
  if (!queued && !fade && performance.now() - lastDraw >= MIN_GAP_MS) runDraw();
  else requestDraw();
}

function requestDraw() {
  if (queued || !gl || lost || !active) return;
  queued = true;
  raf = requestAnimationFrame(runDraw);
  timer = setTimeout(runDraw, 34);
}

function runDraw() {
  cancelAnimationFrame(raf);
  clearTimeout(timer);
  queued = false;
  if (!gl || lost || !active) return;
  draw(performance.now());
}

function drawRect(rect, uv) {
  gl.uniform4f(loc.u_rect, rect.x, rect.y, rect.width, rect.height);
  gl.uniform4f(loc.u_uv, uv.u0, uv.v0, uv.u1, uv.v1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawLayers(layers) {
  gl.viewport(0, 0, size.width, size.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(loc.u_canvas, size.width, size.height);
  for (const layer of layers) {
    if (!(layer.opacity > 0)) continue;
    const solid = layer.type === 'color';
    if (solid) {
      const [r, g, b] = hexColor(layer.color);
      gl.uniform4f(loc.u_color, r, g, b, 1);
    } else {
      const entry = sources.get(layer.key);
      if (!entry || !upload(entry)) continue;
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.uniform2f(loc.u_texel, 1 / Math.max(1, entry.width), 1 / Math.max(1, entry.height));
    }
    gl.uniform1i(loc.u_solid, solid ? 1 : 0);
    gl.uniform1f(loc.u_opacity, layer.opacity);
    const chroma = layer.chroma;
    const keyed = Boolean(chroma?.enabled) && !solid;
    gl.uniform1i(loc.u_chroma, keyed ? 1 : 0);
    if (keyed) {
      const [cb, cr] = keyCbCr(chroma.color);
      gl.uniform2f(loc.u_key, cb, cr);
      gl.uniform1f(loc.u_similarity, chroma.similarity);
      gl.uniform1f(loc.u_smoothness, chroma.smoothness);
      gl.uniform1f(loc.u_spill, chroma.spill);
    }
    drawRect(layer.transform, solid ? FULL_UV : layer.uv);
  }
}

// Curva suave para el fundido (ease in-out).
const ease = (t) => t * t * (3 - 2 * t);

function drawTarget(texture, opacity) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(loc.u_solid, 0);
  gl.uniform1i(loc.u_chroma, 0);
  gl.uniform1f(loc.u_opacity, opacity);
  drawRect({ x: 0, y: 0, width: size.width, height: size.height }, TARGET_UV);
}

// Se lee justo después de dibujar (sin preserveDrawingBuffer, el cuadro ya
// presentado no se puede leer) y sin frenar la GPU: los píxeles van a un
// búfer y se recogen cuando la GPU avisa que terminó.
function readProbes() {
  if (!probes.length) return;
  const pending = probes;
  probes = [];
  for (const { id, points } of pending) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, points.length * 4, gl.STREAM_READ);
    points.forEach(({ x, y }, i) => {
      gl.readPixels(Math.round(x), size.height - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, i * 4);
    });
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const collect = () => {
      if (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
        setTimeout(collect, 2);
        return;
      }
      gl.deleteSync(sync);
      const data = new Uint8Array(points.length * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(buffer);
      post({ type: 'probe', id, pixels: points.map((_, i) => [...data.subarray(i * 4, i * 4 + 4)]) });
    };
    setTimeout(collect, 2);
  }
}

function draw(now) {
  stats.draws += 1;
  lastDraw = now;
  try {
    paint(now);
  } finally {
    readProbes();
  }
}

function paint(now) {
  if (!fade) {
    drawLayers(current);
    return;
  }
  const t = Math.min(1, (now - fade.start) / fade.ms);
  if (t >= 1) {
    const from = fade.from;
    fade = null;
    drawLayers(current);
    releaseUnused(from);
    return;
  }
  const { list } = ensureTargets();
  gl.bindFramebuffer(gl.FRAMEBUFFER, list[0].framebuffer);
  drawLayers(fade.from);
  gl.bindFramebuffer(gl.FRAMEBUFFER, list[1].framebuffer);
  drawLayers(current);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, size.width, size.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawTarget(list[0].texture, 1);
  drawTarget(list[1].texture, ease(t));
  requestDraw();
}

// Al terminar el fundido, la página ya puede apagar lo que usaba la escena anterior.
function releaseUnused(from) {
  const keys = new Set(from.map((layer) => layer.key).filter((key) => key && !isShown(key)));
  if (keys.size) post({ type: 'faded', keys: [...keys] });
}

function setScene(layers, transition) {
  const animate = transition && transition.ms > 0 && active && gl && !lost && current.length;
  if (animate) fade = { from: fade ? fade.from : current, start: performance.now(), ms: transition.ms };
  else if (fade) {
    releaseUnused(fade.from);
    fade = null;
  }
  current = Array.isArray(layers) ? layers : [];
  requestDraw();
}

function setOutput(width, height) {
  if (!(width > 0 && height > 0)) return;
  size = { width, height };
  if (canvas && (canvas.width !== width || canvas.height !== height)) {
    canvas.width = width;
    canvas.height = height;
  }
  requestDraw();
}

// Si la GPU se reinicia, se arma todo de nuevo: los videos traen su próximo
// cuadro solos; las imágenes se vuelven a leer y los textos los manda la página.
function onRestored() {
  lost = false;
  setupGl();
  const statics = [];
  for (const [key, entry] of sources) {
    entry.texture = null;
    entry.ready = false;
    if (key.startsWith('text:')) statics.push(key);
  }
  for (const [key, { url }] of images) loadImage(key, url);
  if (statics.length) post({ type: 'lost', keys: statics });
  requestDraw();
}

function handle(message) {
  switch (message.type) {
    case 'init':
      canvas = message.canvas;
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        lost = true;
      });
      canvas.addEventListener('webglcontextrestored', onRestored);
      try {
        setupGl();
      } catch (error) {
        post({ type: 'error', message: String(error.message ?? error) });
      }
      setOutput(message.width, message.height);
      break;
    case 'output':
      setOutput(message.width, message.height);
      break;
    case 'scene':
      setScene(message.layers, message.transition);
      break;
    case 'frame':
      accept(message.key, message.frame);
      break;
    case 'bitmap':
      accept(message.key, message.bitmap);
      break;
    case 'stream':
      readStream(message.key, message.readable);
      break;
    case 'image':
      loadImage(message.key, message.url);
      break;
    case 'release':
      release(message.key);
      break;
    case 'end':
      forget(message.key);
      break;
    case 'port':
      message.port.onmessage = (event) => handle(event.data);
      break;
    case 'active':
      active = Boolean(message.on);
      if (active) requestDraw();
      break;
    case 'probe':
      // Se lee el próximo cuadro que se dibuje; si nada se mueve, se dibuja uno.
      probes.push({ id: message.id, points: message.points });
      setTimeout(() => {
        if (probes.length) requestDraw();
      }, 50);
      break;
    default:
      break;
  }
}

self.onmessage = (event) => handle(event.data);

setInterval(() => {
  const now = performance.now();
  const seconds = (now - (stats.last || now)) / 1000;
  stats.fps = seconds > 0 ? Math.round(stats.draws / seconds) : 0;
  stats.last = now;
  post({ type: 'stats', stats: { fps: stats.fps, frames: stats.frames, uploads: stats.uploads, layers: current.length, sources: sources.size, fading: Boolean(fade), active } });
  stats.draws = 0;
  stats.frames = 0;
  stats.uploads = 0;
}, 1000);

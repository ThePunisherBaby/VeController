// Recibe el video del PC500 por la red y lo entrega a la ventana como FLV.
//
// Dos modos:
//   push: la app abre un servidor RTMP (puerto 1935) y el PC500 transmite a
//         rtmp://<IP de la Mac>:1935/live con la clave de la app.
//   pull: la app se conecta al servidor RTMP del propio PC500
//         (rtmp://<IP del PC500>:1935/live/<clave>).
//
// El video se reenvía sin recodificar como FLV por HTTP en 127.0.0.1, con la
// cabecera y el último GOP guardados para que la imagen arranque al instante.
// El protocolo RTMP sale de Node-Media-Server (vendor/node-media-server).

import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import AMF from './vendor/node-media-server/protocol/amf.js';
import Flv from './vendor/node-media-server/protocol/flv.js';
import Rtmp from './vendor/node-media-server/protocol/rtmp.js';
import RtmpClient from './vendor/node-media-server/protocol/rtmp_client.js';
import logger from './vendor/node-media-server/core/logger.js';
import { localIPv4Networks } from './lan-discovery.js';

logger.level = 'error';

const STREAM_APP = 'live';
const MAX_GOP_TAGS = 2048;
// Sin paquetes durante este tiempo se da el video por cortado, aunque la
// conexión siga abierta (el servidor del PC500 la mantiene si se apaga STREAM).
const STALL_MS = 3000;

// Resolución y cuadros por segundo de los metadatos del stream. Los servidores
// también mandan otros mensajes de datos (onStatus…), que no son metadatos.
export function videoInfoFromPacket(packet) {
  if (packet?.codec_type !== 18 || !packet.data?.includes?.('onMetaData')) return null;
  try {
    const meta = AMF.decodeAmf0Data(packet.data).dataObj;
    if (!meta || typeof meta !== 'object') return null;
    const number = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
    return { width: number(meta.width), height: number(meta.height), fps: Math.round(number(meta.framerate)), audio: Boolean(meta.audiocodecid) };
  } catch {
    return null;
  }
}

// El cliente RTMP usa el analizador de URL estándar, que no acepta IPv6 con
// zona (fe80::1%en0) y deja los corchetes en el host. Este analizador resuelve
// las IPv6 entre corchetes y deja el resto al original.
const BRACKETED = /^rtmp:\/\/\[([^\]]+)\](?::(\d+))?\/([^/?]+)\/([^?]+)(?:\?.*)?$/i;
const originalParseUrl = RtmpClient.parseUrl;
export function parseRtmpUrl(rtmpUrl) {
  const match = BRACKETED.exec(String(rtmpUrl));
  if (!match) return originalParseUrl(rtmpUrl);
  return {
    host: decodeURIComponent(match[1]),
    port: Number(match[2]) || 1935,
    app: decodeURIComponent(match[3]),
    streamName: decodeURIComponent(match[4]),
    query: {},
  };
}
RtmpClient.parseUrl = parseRtmpUrl;

// Guarda lo necesario para que un reproductor nuevo arranque sin esperar el
// próximo cuadro clave, y reparte cada etiqueta FLV a los suscriptores.
export class FlvRelay {
  #meta = null;
  #audioHeader = null;
  #videoHeader = null;
  #gop = [];
  #subscribers = new Set();

  get hasVideo() {
    return this.#videoHeader !== null;
  }

  get subscriberCount() {
    return this.#subscribers.size;
  }

  push(packet) {
    const tag = Flv.createMessage(packet);
    switch (packet.flags) {
      case 0:
        this.#audioHeader = tag;
        break;
      case 2:
        this.#videoHeader = tag;
        break;
      case 3:
        this.#gop = [tag];
        break;
      case 1:
      case 4:
        if (this.#gop.length > 0) this.#gop.push(tag);
        if (this.#gop.length > MAX_GOP_TAGS) this.#gop = [];
        break;
      case 5:
        if (packet.data?.includes?.('onMetaData')) this.#meta = tag;
        break;
      default:
        break;
    }
    for (const subscriber of this.#subscribers) subscriber.write(tag);
  }

  subscribe(subscriber) {
    // La cabecera declara audio solo si el stream lo trae: si no, el
    // reproductor podría quedarse esperando un audio que nunca llega.
    subscriber.write(Flv.createHeader(this.#audioHeader !== null, true));
    for (const tag of [this.#meta, this.#audioHeader, this.#videoHeader]) {
      if (tag) subscriber.write(tag);
    }
    for (const tag of this.#gop) subscriber.write(tag);
    this.#subscribers.add(subscriber);
    return () => this.#subscribers.delete(subscriber);
  }

  // Corta a todos: el siguiente stream empieza con tiempos nuevos.
  reset() {
    this.#meta = null;
    this.#audioHeader = null;
    this.#videoHeader = null;
    this.#gop = [];
    for (const subscriber of this.#subscribers) subscriber.end();
    this.#subscribers.clear();
  }
}

export class VideoReceiver extends EventEmitter {
  #relay = new FlvRelay();
  #stallMs;
  #http = null;
  #httpPort = 0;
  #rtmpServer = null;
  #publisher = null;
  #pull = null;
  #pullTimer = null;
  #stallTimer = null;
  #lastPacketAt = 0;
  #config = { mode: 'off' };
  #status = { mode: 'off', state: 'off', playUrl: '', rtmpUrls: [], key: '', source: '', error: '', info: null };

  constructor({ stallMs = STALL_MS } = {}) {
    super();
    this.#stallMs = stallMs;
  }

  get status() {
    return this.#status;
  }

  get relay() {
    return this.#relay;
  }

  // mode: 'push' | 'pull' | 'off'. Para push: { key, rtmpPort, rtmpHost }.
  // Para pull: { url, tcUrl }. tcUrl es la dirección que se le anuncia al
  // servidor; algunos la leen, así que conviene que sea una que conozcan.
  async configure(config = {}) {
    const next = { mode: 'off', rtmpPort: 1935, rtmpHost: '0.0.0.0', ...config };
    if (JSON.stringify(next) === JSON.stringify(this.#config)) return this.#status;
    await this.#teardown();
    this.#config = next;
    if (next.mode === 'off') {
      this.#setStatus({ mode: 'off', state: 'off', playUrl: '', rtmpUrls: [], key: '', source: '', error: '', info: null });
      return this.#status;
    }
    await this.#startHttp();
    if (next.mode === 'push') await this.#startPush(next);
    else if (next.mode === 'pull') this.#startPull(next);
    return this.#status;
  }

  async stop() {
    await this.configure({ mode: 'off' });
  }

  async #teardown() {
    clearTimeout(this.#pullTimer);
    this.#pullTimer = null;
    clearInterval(this.#stallTimer);
    this.#stallTimer = null;
    if (this.#pull) {
      const client = this.#pull;
      this.#pull = null;
      try {
        client.disconnect();
      } catch {
        // Ya estaba cerrado.
      }
    }
    if (this.#publisher) {
      this.#publisher.destroy();
      this.#publisher = null;
    }
    this.#relay.reset();
    if (this.#rtmpServer) {
      const server = this.#rtmpServer;
      this.#rtmpServer = null;
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }

  #setStatus(patch) {
    this.#status = { ...this.#status, ...patch };
    this.emit('status', this.#status);
  }

  #onPacket(packet) {
    this.#lastPacketAt = Date.now();
    const info = videoInfoFromPacket(packet);
    if (info) this.#setStatus({ info });
    this.#relay.push(packet);
  }

  // --- Entrega local en FLV ---

  async #startHttp() {
    if (this.#http) return;
    this.#http = http.createServer((req, res) => {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (req.method !== 'GET' || !req.url.startsWith('/live.flv')) {
        res.writeHead(404, cors);
        res.end();
        return;
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'video/x-flv', 'Cache-Control': 'no-cache' });
      req.socket.setNoDelay(true);
      const unsubscribe = this.#relay.subscribe({ write: (tag) => res.write(tag), end: () => res.end() });
      req.on('close', unsubscribe);
    });
    await new Promise((resolve, reject) => {
      this.#http.once('error', reject);
      this.#http.listen(0, '127.0.0.1', () => resolve());
    });
    this.#httpPort = this.#http.address().port;
  }

  get playUrl() {
    return this.#httpPort ? `http://127.0.0.1:${this.#httpPort}/live.flv` : '';
  }

  async close() {
    await this.stop();
    if (this.#http) {
      const server = this.#http;
      this.#http = null;
      this.#httpPort = 0;
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }

  // --- Modo push: el PC500 transmite a esta Mac ---

  async #startPush({ key, rtmpPort, rtmpHost }) {
    const server = net.createServer((socket) => this.#onRtmpSocket(socket, key));
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(rtmpPort, rtmpHost, () => resolve());
      });
    } catch (error) {
      const message = error.code === 'EADDRINUSE'
        ? `El puerto ${rtmpPort} está ocupado. Cierra otro servidor RTMP o cambia el puerto.`
        : `No se pudo abrir el puerto ${rtmpPort}: ${error.message}`;
      this.#setStatus({ mode: 'push', state: 'error', error: message, playUrl: '', rtmpUrls: [], key });
      return;
    }
    this.#rtmpServer = server;
    const port = server.address().port;
    const rtmpUrls = localIPv4Networks().map((n) => `rtmp://${n.address}:${port}/${STREAM_APP}`);
    this.#setStatus({ mode: 'push', state: 'listening', error: '', playUrl: this.playUrl, rtmpUrls, key, source: '' });
  }

  get rtmpPort() {
    return this.#rtmpServer?.address()?.port ?? 0;
  }

  #onRtmpSocket(socket, key) {
    socket.setNoDelay(true);
    const rtmp = new Rtmp();
    let isPublisher = false;
    let rejected = false;
    const reject = () => {
      rejected = true;
      socket.destroy();
    };

    // Se valida antes de que el protocolo responda "publicación aceptada", así
    // un codificador con otra clave ve el error al instante.
    const acceptPublish = rtmp.onPublish.bind(rtmp);
    rtmp.onPublish = (message) => {
      const name = String(message?.streamName ?? '').split('?')[0];
      const busy = this.#publisher && this.#publisher !== socket;
      if (rtmp.streamApp !== STREAM_APP || name !== key || busy) {
        reject();
        return;
      }
      acceptPublish(message);
    };
    // Esta app no reparte video por RTMP.
    rtmp.onPlay = reject;

    rtmp.onConnectCallback = (req) => {
      // Solo se acepta la app "live" con la clave de esta Mac.
      if (req.app !== STREAM_APP || req.name !== key) {
        rejected = true;
        socket.destroy();
      }
    };
    rtmp.onPushCallback = () => {
      // El protocolo avisa la conexión y la publicación seguidas.
      if (rejected || socket.destroyed) return;
      if (this.#publisher && this.#publisher !== socket) {
        socket.destroy();
        return;
      }
      this.#publisher = socket;
      isPublisher = true;
      this.#relay.reset();
      this.#setStatus({ state: 'receiving', source: socket.remoteAddress ?? '', error: '', info: null });
    };
    rtmp.onPlayCallback = () => socket.destroy();
    rtmp.onOutputCallback = (buffer) => {
      if (!socket.destroyed) socket.write(buffer);
    };
    rtmp.onPacketCallback = (packet) => {
      if (isPublisher) this.#onPacket(packet);
    };
    socket.on('data', (data) => {
      const error = rtmp.parserData(data);
      if (error) socket.destroy();
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (!isPublisher || this.#publisher !== socket) return;
      this.#publisher = null;
      this.#relay.reset();
      if (this.#config.mode === 'push') this.#setStatus({ state: 'listening', source: '', info: null });
    });
  }

  // --- Modo pull: la Mac lee el servidor RTMP del PC500 ---

  // Estados: connecting (buscando el servidor), waiting (conectado, sin video:
  // STREAM apagado) y receiving.
  #startPull({ url, tcUrl }) {
    this.#setStatus({ mode: 'pull', state: 'connecting', error: '', playUrl: this.playUrl, rtmpUrls: [], key: '', source: url, info: null });
    this.#stallTimer = setInterval(() => {
      if (this.#status.state !== 'receiving' || Date.now() - this.#lastPacketAt < this.#stallMs) return;
      this.#relay.reset();
      this.#setStatus({ state: 'waiting', info: null });
    }, Math.min(1000, this.#stallMs));
    const attempt = async () => {
      if (this.#config.mode !== 'pull') return;
      const client = new RtmpClient();
      this.#pull = client;
      const retry = (message) => {
        if (this.#pull !== client) return;
        this.#pull = null;
        this.#relay.reset();
        this.#setStatus({ state: 'connecting', error: message ?? '', info: null });
        this.#pullTimer = setTimeout(attempt, 3000);
      };
      client.onPacketCallback = (packet) => {
        if (this.#pull !== client) return;
        if (this.#status.state !== 'receiving') this.#setStatus({ state: 'receiving', error: '' });
        this.#onPacket(packet);
      };
      // El servidor del PC500 avisa cuando STREAM se apaga, sin cortar la conexión.
      client.onStatusCallback = (code) => {
        if (this.#pull !== client || code !== 'NetStream.Play.UnpublishNotify') return;
        this.#relay.reset();
        this.#setStatus({ state: 'waiting', info: null });
      };
      client.onCloseCallback = () => retry('Se cortó el video del PC500.');
      client.onErrorCallback = (error) => retry(`No se pudo leer el video: ${error.message}`);
      try {
        await client.connect(url);
        if (tcUrl) client.baseUri = tcUrl;
        await client.sendConnect();
        await client.sendCreateStream();
        await client.sendPlay(client.urlInfo.streamName);
        client.startHeartbeat();
        if (this.#pull === client && this.#status.state === 'connecting') this.#setStatus({ state: 'waiting', error: '' });
      } catch (error) {
        try {
          client.disconnect();
        } catch {
          // Ya estaba cerrado.
        }
        retry(`No se pudo leer el video: ${error.message}`);
      }
    };
    attempt();
  }
}

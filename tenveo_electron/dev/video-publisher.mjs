// Emisor de video de prueba (proceso principal de Electron).
// Publica por RTMP una carta de ajuste en H.264, como lo haría el PC500 al
// transmitir. Uso: PUBLISH_URL=rtmp://127.0.0.1:1935/live/clave electron dev/video-publisher.mjs
// (y PUBLISH_WIDTH, PUBLISH_HEIGHT, PUBLISH_FPS, PUBLISH_BITRATE, PUBLISH_GOP)

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RtmpClient from '../src/main/vendor/node-media-server/protocol/rtmp_client.js';
import logger from '../src/main/vendor/node-media-server/core/logger.js';

logger.level = 'error';
const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.PUBLISH_URL;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry() {
  const deadline = Date.now() + 20000;
  for (;;) {
    const client = new RtmpClient();
    try {
      await client.connect(url);
      await client.sendConnect();
      await client.sendCreateStream();
      await client.sendPublish(client.urlInfo.streamName);
      return client;
    } catch (error) {
      try {
        client.disconnect();
      } catch {
        // Ya estaba cerrado.
      }
      if (Date.now() > deadline) throw error;
      await delay(300);
    }
  }
}

function videoPacket(dts, body) {
  return { codec_type: 9, codec_id: 7, dts, pts: dts, size: body.length, data: body, flags: 0, duration: 0, offset: 0 };
}

// Si el servidor RTMP se cierra antes que el emisor, mandar un cuadro lanza un
// error, y un error sin atrapar en el proceso principal abre un diálogo modal
// que deja el proceso colgado. El emisor sale solo en esos casos.
process.on('SIGTERM', () => app.exit(0));

app.whenReady().then(async () => {
  let client;
  try {
    client = await connectWithRetry();
  } catch (error) {
    console.error('[emisor] no se pudo publicar:', error.message);
    app.exit(1);
    return;
  }
  console.log(`[emisor] publicando en ${url}`);
  client.onCloseCallback = () => app.exit(0);
  client.onErrorCallback = () => app.exit(0);
  const send = (packet) => {
    try {
      client.sendPacket(packet);
    } catch {
      app.exit(0);
    }
  };

  let sentHeader = false;
  let frames = 0;
  ipcMain.on('publisher:chunk', (_event, chunk) => {
    if (!sentHeader) {
      if (!chunk.description || !chunk.key) return;
      const header = Buffer.concat([Buffer.from([0x17, 0x00, 0, 0, 0]), Buffer.from(chunk.description)]);
      send(videoPacket(0, header));
      sentHeader = true;
    }
    const dts = Math.round(chunk.timestamp);
    let data = Buffer.from(chunk.data);
    // PUBLISH_CORRUPT_AT=N manda el cuadro N con datos rotos, para probar que
    // el monitor se recupera de un error del decodificador.
    if (Number(process.env.PUBLISH_CORRUPT_AT) === frames + 1) data = Buffer.from(data.map((_, i) => (i * 97 + 13) & 0xff));
    const body = Buffer.concat([Buffer.from([chunk.key ? 0x17 : 0x27, 0x01, 0, 0, 0]), data]);
    send(videoPacket(dts, body));
    frames += 1;
    if (frames === 1 || frames % 90 === 0) console.log(`[emisor] ${frames} cuadros enviados`);
  });
  ipcMain.on('publisher:error', (_event, message) => {
    console.error('[emisor]', message);
    app.exit(2);
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(here, 'video-publisher-preload.cjs'), contextIsolation: true, sandbox: true },
  });
  // PUBLISH_WIDTH, PUBLISH_HEIGHT, PUBLISH_FPS, PUBLISH_BITRATE y PUBLISH_GOP
  // cambian el video; por defecto, 640x360 a 30 cuadros y 1 Mbit/s.
  const query = {};
  for (const name of ['width', 'height', 'fps', 'bitrate', 'gop']) {
    const value = process.env[`PUBLISH_${name.toUpperCase()}`];
    if (value) query[name] = value;
  }
  win.loadFile(path.join(here, 'video-publisher.html'), { query });
});

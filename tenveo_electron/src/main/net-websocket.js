// WebSocket del proceso principal, hecho para el control del PC500:
//   - Sin compresión: en mensajes tan chicos solo suma latencia.
//   - Con ping (librería ws), que usa el latido de TenveoService.
//   - Acepta IPv6 de enlace local con zona (ws://[fe80::1%25en0]:8089). Las
//     URL estándar no aceptan zonas, así que el socket se abre a mano.

import net from 'node:net';
import WebSocket from 'ws';

const ZONED = /^(wss?):\/\/\[([^\]]+%25[^\]]+)\](?::(\d+))?(\/.*)?$/i;

export function parseZonedUrl(url) {
  const match = ZONED.exec(String(url));
  if (!match) return null;
  return {
    host: decodeURIComponent(match[2]),
    port: Number(match[3]) || (match[1].toLowerCase() === 'wss' ? 443 : 80),
    path: match[4] || '/',
  };
}

export class LowLatencyWebSocket extends WebSocket {
  constructor(url) {
    const options = { perMessageDeflate: false, handshakeTimeout: 3000 };
    const zoned = parseZonedUrl(url);
    if (zoned) {
      super(`ws://pc500.local:${zoned.port}${zoned.path}`, {
        ...options,
        createConnection: () => net.connect({ host: zoned.host, port: zoned.port }),
      });
    } else {
      super(url, options);
    }
  }
}

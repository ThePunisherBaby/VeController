// Sirve la interfaz para usarla en el navegador.
// Uso: npm run web
//      npm run web -- --port 8765 --host 0.0.0.0   (por ejemplo, en un Codespace)
// En este modo el puente USB lo abre start_app.sh --web o tenveo_bridge.py.

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(fileURLToPath(new URL('../src', import.meta.url)));
const ALLOWED = new Set(['renderer', 'core']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(arg('port', process.env.PORT || 8765));
const host = arg('host', process.env.HOST || '127.0.0.1');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (relative === '') {
      res.writeHead(302, { Location: `/renderer/index.html${url.search}` });
      res.end();
      return;
    }
    const file = path.resolve(SRC, relative);
    if (!file.startsWith(SRC + path.sep) || !ALLOWED.has(relative.split('/')[0])) {
      res.writeHead(404);
      res.end('No encontrado');
      return;
    }
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('No encontrado');
  }
});

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Tenveo Studio (web) en http://${shown}:${port}/`);
  console.log('Presiona Ctrl+C para detener.');
});

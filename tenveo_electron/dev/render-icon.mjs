// Dibuja el ícono de la app y arma build/icon.icns (lo usa electron-builder).
//
// Sigue la grilla de íconos de macOS: lienzo de 1024 px y cuerpo "squircle"
// (superelipse) de 824 px con su sombra. Encima, la marca: una cortina (wipe)
// entre PGM, en rojo, y PVW, en verde, con la manija de la transición.
// Cada tamaño se rasteriza del SVG a su medida, así queda nítido.
//
// Uso: npm run icon

import { app, BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const buildDir = path.join(projectDir, 'build');

/** Superelipse (n = 5), la forma de los íconos de Apple. */
function squircle(cx, cy, r, n = 5, steps = 360) {
  const points = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = cx + r * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = cy + r * Math.sign(s) * Math.abs(s) ** (2 / n);
    points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

const body = squircle(512, 512, 412);
const tile = squircle(512, 512, 248);
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="graphite" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3c3c41"/>
      <stop offset="1" stop-color="#121214"/>
    </linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff6158"/>
      <stop offset="0.5" stop-color="#e3261d"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0.5" stop-color="#2fd35a"/>
      <stop offset="1" stop-color="#17a83f"/>
    </linearGradient>
    <filter id="body-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity="0.32"/>
    </filter>
    <filter id="tile-shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <filter id="knob-shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.35"/>
    </filter>
    <clipPath id="tile-clip"><path d="${tile}"/></clipPath>
  </defs>
  <path d="${body}" fill="url(#graphite)" filter="url(#body-shadow)"/>
  <g filter="url(#tile-shadow)">
    <g clip-path="url(#tile-clip)">
      <rect x="250" y="250" width="524" height="524" fill="url(#green)"/>
      <path d="M250 250H774L250 774Z" fill="url(#red)"/>
    </g>
  </g>
  <path d="M686 338 338 686" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
  <circle cx="512" cy="512" r="44" fill="#fff" filter="url(#knob-shadow)"/>
</svg>`;

const SIZES = [16, 32, 64, 128, 256, 512, 1024];
const ICONSET = {
  'icon_16x16.png': 16,
  'icon_16x16@2x.png': 32,
  'icon_32x32.png': 32,
  'icon_32x32@2x.png': 64,
  'icon_128x128.png': 128,
  'icon_128x128@2x.png': 256,
  'icon_256x256.png': 256,
  'icon_256x256@2x.png': 512,
  'icon_512x512.png': 512,
  'icon_512x512@2x.png': 1024,
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 });
  try {
    await win.loadURL('data:text/html,<!doctype html><title>icono</title>');
    const pngs = await win.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(SVG)});
      await image.decode();
      const out = {};
      for (const size of ${JSON.stringify(SIZES)}) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);
        out[size] = canvas.toDataURL('image/png').split(',')[1];
      }
      return out;
    })()`);
    const iconset = await fs.mkdtemp(path.join(os.tmpdir(), 'tenveo-icon-'));
    const folder = path.join(iconset, 'Tenveo.iconset');
    await fs.mkdir(folder);
    for (const [name, size] of Object.entries(ICONSET)) {
      await fs.writeFile(path.join(folder, name), Buffer.from(pngs[size], 'base64'));
    }
    await fs.mkdir(buildDir, { recursive: true });
    execFileSync('iconutil', ['-c', 'icns', folder, '-o', path.join(buildDir, 'icon.icns')]);
    await fs.writeFile(path.join(buildDir, 'icon.png'), Buffer.from(pngs[1024], 'base64'));
    await fs.writeFile(path.join(buildDir, 'icon.svg'), `${SVG}\n`);
    await fs.rm(iconset, { recursive: true, force: true });
    console.log(`Ícono listo: ${path.join(buildDir, 'icon.icns')}`);
    app.exit(0);
  } catch (error) {
    console.error('No se pudo dibujar el ícono:', error);
    app.exit(1);
  }
});

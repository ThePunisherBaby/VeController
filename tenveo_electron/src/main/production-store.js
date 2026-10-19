// Guarda el estudio de producción (escenas y fuentes) en production.json y sus
// imágenes y videos en media/, dentro de la carpeta de datos de la app.
//
// Cada archivo que el usuario agrega se copia con el nombre de su huella
// (SHA-256): así la escena sigue funcionando aunque se borre o mueva el
// original, y el mismo archivo agregado dos veces ocupa lugar una sola vez.
// La ventana los pide por app://tenveo/media/<nombre>.

import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeProduction } from '../core/production.js';

const KINDS = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.m4v': 'video',
  '.webm': 'video',
};
const MEDIA_NAME = /^[a-f0-9]{32}\.(png|jpe?g|webp|gif|mp4|mov|m4v|webm)$/;
const MAX_BYTES = 4 * 1024 ** 3;

export const MEDIA_FILTERS = {
  image: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  video: [{ name: 'Videos', extensions: ['mp4', 'mov', 'm4v', 'webm'] }],
};

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex').slice(0, 32);
}

export class ProductionStore {
  #file;
  #mediaDir;
  #queue = Promise.resolve();

  constructor(dataDir) {
    this.#file = path.join(dataDir, 'production.json');
    this.#mediaDir = path.join(dataDir, 'media');
  }

  async load() {
    try {
      return normalizeProduction(JSON.parse(await fs.readFile(this.#file, 'utf8')));
    } catch {
      return normalizeProduction(null);
    }
  }

  // Guarda solo una producción válida; devuelve la versión normalizada.
  save(doc) {
    const clean = normalizeProduction(doc);
    this.#queue = this.#queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.#file), { recursive: true });
      const temp = `${this.#file}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(clean)}\n`, { mode: 0o600 });
      await fs.rename(temp, this.#file);
    });
    return { clean, done: this.#queue };
  }

  /** Copia un archivo a media/ y devuelve cómo referirse a él desde una escena. */
  async importMedia(file, expectedKind) {
    const ext = path.extname(file).toLowerCase();
    const kind = KINDS[ext];
    if (!kind || (expectedKind && kind !== expectedKind)) throw new Error('Ese tipo de archivo no se puede usar aquí.');
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('No es un archivo.');
    if (stat.size > MAX_BYTES) throw new Error('El archivo es demasiado grande (más de 4 GB).');
    const name = `${await hashFile(file)}${ext === '.jpeg' ? '.jpg' : ext}`;
    const target = path.join(this.#mediaDir, name);
    await fs.mkdir(this.#mediaDir, { recursive: true });
    try {
      await fs.access(target);
    } catch {
      const temp = `${target}.tmp`;
      await fs.copyFile(file, temp);
      await fs.rename(temp, target);
    }
    return { media: name, kind, fileName: path.basename(file) };
  }

  /** Ruta de un archivo de media/, o null si el nombre no es uno de los nuestros. */
  resolveMedia(name) {
    return MEDIA_NAME.test(name) ? path.join(this.#mediaDir, name) : null;
  }
}

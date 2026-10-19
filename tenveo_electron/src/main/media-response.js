// Respuestas de app://tenveo/media/<nombre>: las imágenes y los videos de la
// producción. Atiende pedidos por rangos (Range), que el video usa para leer
// el índice de un MP4 y para saltar o repetir sin leer el archivo entero.

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export const MEDIA_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
});

/**
 * El tramo pedido de un archivo de size bytes: { start, end, partial }, o null
 * si el tramo cae fuera del archivo. Un pedido que no se entiende (varios
 * tramos, unidades raras) recibe el archivo entero, como permite HTTP.
 */
export function parseRange(header, size) {
  const whole = { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!match || (!match[1] && !match[2])) return whole;
  let start;
  let end;
  if (match[1]) {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  } else {
    // bytes=-N: los últimos N bytes.
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  }
  if (start > end || start >= size) return null;
  return { start, end, partial: true };
}

export async function mediaResponse(file, rangeHeader) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return new Response('No encontrado', { status: 404 });
  }
  const range = parseRange(rangeHeader, stat.size);
  if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
  const headers = {
    'Content-Type': MEDIA_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(range.end - range.start + 1),
    'Accept-Ranges': 'bytes',
    // El nombre es la huella del contenido: el archivo nunca cambia.
    'Cache-Control': 'max-age=31536000, immutable',
  };
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
  const body = stat.size ? Readable.toWeb(createReadStream(file, { start: range.start, end: range.end })) : null;
  return new Response(body, { status: range.partial ? 206 : 200, headers });
}

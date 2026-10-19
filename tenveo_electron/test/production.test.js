import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OUTPUTS,
  applyCrop,
  changeOutput,
  createProduction,
  createScene,
  createSource,
  cropUv,
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
  snapTransform,
} from '../src/core/production.js';

const canvas = { width: 1920, height: 1080 };

test('una producción nueva tiene una escena con el programa del PC500 a pantalla completa', () => {
  const doc = createProduction();
  assert.equal(doc.output, '1080p60');
  assert.equal(doc.scenes.length, 1);
  assert.equal(doc.liveScene, doc.scenes[0].id);
  assert.deepEqual(doc.transition, { kind: 'fade', ms: 300 });
  assert.equal(liveSceneOf(doc), doc.scenes[0]);
  const [source] = doc.scenes[0].sources;
  assert.equal(source.type, 'pc500');
  assert.deepEqual(source.transform, { x: 0, y: 0, width: 1920, height: 1080 });
});

test('las salidas llegan hasta 4K30, y 1440p60 y 4K30 van con aviso', () => {
  assert.deepEqual(OUTPUTS.map((o) => o.id), ['720p30', '720p60', '1080p30', '1080p60', '1440p60', '2160p30']);
  assert.equal(outputFor('2160p30').warning, true);
  assert.equal(outputFor('1080p60').warning, undefined);
  assert.equal(outputFor('2160p60').id, '1080p60');
});

test('ajustar, llenar y centrar respetan la proporción', () => {
  assert.deepEqual(fitTransform({ width: 1000, height: 1000 }, canvas, 'fit'), { x: 420, y: 0, width: 1080, height: 1080 });
  assert.deepEqual(fitTransform({ width: 1000, height: 1000 }, canvas, 'fill'), { x: 0, y: -420, width: 1920, height: 1920 });
  assert.deepEqual(fitTransform({ width: 400, height: 200 }, canvas, 'center'), { x: 760, y: 440, width: 400, height: 200 });
});

test('las imágenes y textos entran centrados; las cámaras y videos, a pantalla completa', () => {
  const image = createSource('image', canvas, { natural: { width: 300, height: 100 } });
  assert.deepEqual(image.transform, { x: 810, y: 490, width: 300, height: 100 });
  const camera = createSource('camera', canvas, { natural: { width: 1280, height: 720 } });
  assert.deepEqual(camera.transform, { x: 0, y: 0, width: 1920, height: 1080 });
  assert.throws(() => createSource('obs', canvas), /Tipo de fuente desconocido/);
});

test('busca la fuente de más arriba bajo el puntero, sin las ocultas ni las bloqueadas', () => {
  const scene = createScene();
  const back = createSource('color', canvas);
  const logo = createSource('image', canvas, { natural: { width: 200, height: 200 } });
  scene.sources.push(back, logo);
  assert.equal(hitTest(scene, 960, 540), logo);
  assert.equal(hitTest(scene, 10, 10), back);
  logo.visible = false;
  assert.equal(hitTest(scene, 960, 540), back);
  back.locked = true;
  assert.equal(hitTest(scene, 10, 10), null);
});

test('el imán lleva bordes y centro a los bordes y el centro de la salida', () => {
  const { transform, guides } = snapTransform({ x: 7, y: 535 - 50, width: 200, height: 110 }, canvas, 12);
  assert.equal(transform.x, 0);
  assert.equal(transform.y + transform.height / 2, 540);
  assert.deepEqual(guides.map((g) => g.axis), ['x', 'y']);
  assert.deepEqual(snapTransform({ x: 300, y: 300, width: 100, height: 100 }, canvas, 12).guides, []);
});

test('las esquinas cambian el tamaño manteniendo la proporción, salvo libre', () => {
  const t = { x: 100, y: 100, width: 400, height: 200 };
  assert.deepEqual(resizeTransform(t, 'se', 100, 10), { x: 100, y: 100, width: 500, height: 250 });
  assert.deepEqual(resizeTransform(t, 'nw', -100, -5), { x: 0, y: 50, width: 500, height: 250 });
  assert.deepEqual(resizeTransform(t, 'se', 100, 10, { free: true }), { x: 100, y: 100, width: 500, height: 210 });
  assert.deepEqual(resizeTransform(t, 'e', 50, 999), { x: 100, y: 100, width: 450, height: 200 });
  // Nunca queda más chica que 16 px.
  assert.deepEqual(resizeTransform(t, 'w', 1000, 0), { x: 484, y: 100, width: 16, height: 200 });
});

test('el recorte pasa a fracciones de la imagen para el shader', () => {
  const source = createSource('camera', canvas, { natural: { width: 1920, height: 1080 } });
  source.crop = { top: 108, right: 192, bottom: 0, left: 480 };
  const uv = cropUv(source);
  assert.deepEqual(uv, { u0: 0.25, v0: 0.1, u1: 0.9, v1: 1 });
});

test('normaliza una producción guardada y descarta lo inválido', () => {
  const doc = normalizeProduction({
    output: '8k',
    scenes: [
      {
        id: 'a',
        name: 'Con logo',
        sources: [
          { type: 'image', name: 'Logo', opacity: 3, settings: { media: '../../etc/passwd' }, transform: { x: 'mal', y: 10, width: 2, height: 50 } },
          { type: 'obs', name: 'Vieja' },
          { type: 'text', settings: { text: 'Hola', size: 9999, color: 'rojo', align: 'arriba', font: 'comic' } },
        ],
      },
      { id: 'a', name: '' },
    ],
    liveScene: 'no-existe',
    transition: { kind: 'cortina', ms: 99999 },
  });
  assert.equal(doc.output, '1080p60');
  assert.equal(doc.scenes.length, 2);
  assert.notEqual(doc.scenes[1].id, 'a');
  assert.equal(doc.liveScene, 'a');
  const [logo, title] = doc.scenes[0].sources;
  assert.equal(doc.scenes[0].sources.length, 2);
  assert.equal(logo.opacity, 1);
  assert.equal(logo.settings.media, '');
  assert.equal(logo.transform.width, 16);
  assert.equal(title.settings.size, 400);
  assert.equal(title.settings.color, '#ffffff');
  assert.equal(title.settings.align, 'center');
  assert.equal(title.settings.font, 'system');
  assert.deepEqual(doc.transition, { kind: 'fade', ms: 5000 });
  assert.deepEqual(normalizeProduction(null).scenes[0].sources[0].type, 'pc500');
});

test('duplicar una escena copia sus fuentes con identificadores nuevos', () => {
  const scene = createScene('Original');
  scene.sources.push(createSource('text', canvas));
  const copy = duplicateScene(scene);
  assert.equal(copy.name, 'Original (copia)');
  assert.notEqual(copy.id, scene.id);
  assert.notEqual(copy.sources[0].id, scene.sources[0].id);
  copy.sources[0].settings.text = 'Otra';
  assert.equal(scene.sources[0].settings.text, 'Texto');
});

test('cada fuente dice qué imagen necesita: compartida, propia o ninguna', () => {
  assert.equal(resourceKey(createSource('pc500', canvas)), 'pc500');
  assert.equal(resourceKey(createSource('camera', canvas, { settings: { deviceId: 'abc' } })), 'camera:abc');
  assert.equal(resourceKey(createSource('camera', canvas)), '');
  assert.equal(resourceKey(createSource('image', canvas, { settings: { media: 'abcdef0123456789.png' } })), 'image:abcdef0123456789.png');
  const text = createSource('text', canvas);
  assert.equal(resourceKey(text), `text:${text.id}`);
  assert.equal(resourceKey(createSource('color', canvas)), '');
});

test('recortar no estira ni mueve lo que queda, como en OBS', () => {
  // Una cámara 1920×1080 dibujada a la mitad de tamaño en (100, 100).
  const source = createSource('camera', canvas, { natural: { width: 1920, height: 1080 } });
  source.transform = { x: 100, y: 100, width: 960, height: 540 };
  const { crop, transform } = applyCrop(source, { left: 480, top: 108 });
  assert.deepEqual(crop, { top: 108, right: 0, bottom: 0, left: 480 });
  assert.deepEqual(transform, { x: 340, y: 154, width: 720, height: 486 });
  // Y deshacerlo devuelve el recuadro original.
  Object.assign(source, { crop, transform });
  assert.deepEqual(applyCrop(source, { left: 0, top: 0 }).transform, { x: 100, y: 100, width: 960, height: 540 });
  // Nunca deja menos de un píxel de la fuente.
  assert.equal(applyCrop(source, { left: 5000, right: 5000 }).crop.left + applyCrop(source, { left: 5000, right: 5000 }).crop.right, 1919);
  // Ajustar usa solo la parte visible.
  source.crop = { top: 0, right: 960, bottom: 0, left: 0 };
  assert.deepEqual(fitSource(source, canvas, 'fit'), { x: 480, y: 0, width: 960, height: 1080 });
});

test('cambiar la resolución escala toda la composición', () => {
  const doc = createProduction();
  doc.scenes[0].sources.push({ ...createSource('image', canvas), transform: { x: 100, y: 50, width: 300, height: 100 } });
  const k4 = changeOutput(doc, '2160p30');
  assert.equal(k4.output, '2160p30');
  assert.deepEqual(k4.scenes[0].sources[0].transform, { x: 0, y: 0, width: 3840, height: 2160 });
  assert.deepEqual(k4.scenes[0].sources[1].transform, { x: 200, y: 100, width: 600, height: 200 });
  assert.equal(doc.output, '1080p60', 'no cambia la producción original');
});

test('las fuentes se reordenan en la pila', () => {
  const scene = createScene();
  const [a, b, c] = ['color', 'image', 'text'].map((type) => createSource(type, canvas));
  scene.sources.push(a, b, c);
  assert.equal(moveSource(scene, a.id, 2), true);
  assert.deepEqual(scene.sources.map((s) => s.type), ['image', 'text', 'color']);
  assert.equal(moveSource(scene, a.id, 99), false);
  assert.equal(moveSource(scene, 'no-existe', 0), false);
});

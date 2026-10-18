import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cssLinear, fromDurationBounce, SpringValue, springState } from '../src/renderer/js/springs.js';

test('reproduce los ejemplos de la documentación de SwiftUI.Spring', () => {
  const bouncy = fromDurationBounce(0.5, 0.3);
  assert.equal(bouncy.mass, 1);
  assert.equal(bouncy.stiffness.toFixed(1), '157.9');
  assert.equal(bouncy.damping.toFixed(1), '17.6');

  // Spring(mass: 1, stiffness: 100, damping: 10) → duración 0.63 y rebote 0.5.
  const duration = (2 * Math.PI) / Math.sqrt(100);
  const bounce = 1 - 10 / (2 * Math.sqrt(100));
  const back = fromDurationBounce(duration, bounce);
  assert.equal(duration.toFixed(2), '0.63');
  assert.ok(Math.abs(back.stiffness - 100) < 1e-9 && Math.abs(back.damping - 10) < 1e-9);
});

test('la velocidad coincide con la derivada de la posición', () => {
  const params = fromDurationBounce(0.5, 0.15);
  for (const t of [0.02, 0.1, 0.3, 0.6]) {
    const h = 1e-6;
    const ahead = springState(t + h, 120, -900, params).y;
    const behind = springState(t - h, 120, -900, params).y;
    const numeric = (ahead - behind) / (2 * h);
    assert.ok(Math.abs(numeric - springState(t, 120, -900, params).v) < 1e-3);
  }
});

test('al cambiar de destino sigue desde la posición y la velocidad que tenía', () => {
  const spring = new SpringValue(0, fromDurationBounce(0.5));
  spring.retarget(300, 0);
  const before = spring.sample(0.15);
  spring.retarget(-50, 0.15);
  const after = spring.sample(0.15);
  assert.ok(Math.abs(before.value - after.value) < 1e-9);
  assert.ok(Math.abs(before.velocity - after.velocity) < 1e-9);
  assert.equal(spring.isSettled(5), true);
  assert.ok(Math.abs(spring.sample(5).value + 50) < 1e-6);
});

test('la curva CSS del spring termina en 1 y dura lo que tarda en asentarse', () => {
  const smooth = cssLinear(fromDurationBounce(0.5, 0));
  assert.equal(smooth.durationMs, 735);
  assert.match(smooth.easing, /^linear\(0, .*, 1\)$/);
  const snappy = cssLinear(fromDurationBounce(0.5, 0.15));
  assert.equal(snappy.durationMs, 697);
  // Con rebote, la curva pasa un poco del destino antes de volver.
  assert.ok(snappy.easing.split(', ').some((value) => Number.parseFloat(value) > 1));
});

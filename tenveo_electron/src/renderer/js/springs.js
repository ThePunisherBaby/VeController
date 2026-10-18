// Física de springs al estilo de Apple (SwiftUI Spring), sin dependencias.
// Masa 1, como SwiftUI y Compose. Las conversiones reproducen los ejemplos de
// la documentación de SwiftUI.Spring: (duración 0.5, rebote 0.3) → rigidez
// 157.9 y amortiguación 17.6.

const TAU = 2 * Math.PI;

/** Duración perceptual y rebote de Apple → parámetros físicos. */
export function fromDurationBounce(duration, bounce = 0) {
  const stiffness = (TAU / duration) ** 2;
  const damping = bounce >= 0 ? ((1 - bounce) * 4 * Math.PI) / duration : (4 * Math.PI) / (duration * (1 + bounce));
  return { mass: 1, stiffness, damping };
}

/**
 * Solución exacta del oscilador amortiguado con posición y velocidad
 * iniciales cualesquiera. y es la distancia al destino (valor - destino) y v la
 * velocidad, en unidades por segundo. Devuelve { y, v } en el instante t.
 */
export function springState(t, y0, v0, { stiffness, damping, mass = 1 }) {
  const w = Math.sqrt(stiffness / mass);
  const z = damping / (2 * Math.sqrt(stiffness * mass));
  if (Math.abs(z - 1) < 1e-6) {
    const e = Math.exp(-w * t);
    const c = v0 + w * y0;
    return { y: (y0 + c * t) * e, v: (c - w * (y0 + c * t)) * e };
  }
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    const a = y0;
    const b = (v0 + z * w * y0) / wd;
    const e = Math.exp(-z * w * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return { y: e * (a * cos + b * sin), v: e * ((b * wd - z * w * a) * cos - (a * wd + z * w * b) * sin) };
  }
  const q = Math.sqrt(z * z - 1);
  const r1 = -w * (z - q);
  const r2 = -w * (z + q);
  const c1 = (v0 - r2 * y0) / (r1 - r2);
  const c2 = y0 - c1;
  return { y: c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t), v: c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t) };
}

/**
 * Un valor animado por un spring que se puede redirigir en cualquier momento:
 * al cambiar de destino sigue desde la posición y la velocidad que tiene en
 * pantalla, sin saltos. Los tiempos van en segundos.
 */
export class SpringValue {
  constructor(value, params) {
    this.params = params;
    this.target = value;
    this.y0 = 0;
    this.v0 = 0;
    this.t0 = 0;
  }

  sample(now) {
    const { y, v } = springState(now - this.t0, this.y0, this.v0, this.params);
    return { value: this.target + y, velocity: v };
  }

  retarget(target, now, params = this.params, velocity = this.sample(now).velocity) {
    const { value } = this.sample(now);
    this.params = params;
    this.target = target;
    this.t0 = now;
    this.y0 = value - target;
    this.v0 = velocity;
  }

  /** Fija el valor sin animar, por ejemplo mientras lo arrastra el dedo. */
  set(value, now) {
    this.target = value;
    this.y0 = 0;
    this.v0 = 0;
    this.t0 = now;
  }

  isSettled(now, epsilon = 0.0005, velocityEpsilon = 0.005) {
    const { value, velocity } = this.sample(now);
    return Math.abs(value - this.target) < epsilon && Math.abs(velocity) < velocityEpsilon;
  }
}

/**
 * Banda elástica de UIScrollView (c = 0,55): cuánto se ve un desplazamiento x
 * más allá del límite, en un contenedor de tamaño dimension. Nunca pasa de él.
 */
export function rubberBand(x, dimension, c = 0.55) {
  return (1 - 1 / ((x * c) / dimension + 1)) * dimension;
}

/** Posición normalizada de 0 a 1 en el instante t, partiendo de reposo. */
export function springProgress(t, params) {
  return 1 + springState(t, -1, 0, params).y;
}

/** Tiempo hasta quedar para siempre a menos de epsilon del destino. */
export function settlingTime(params, epsilon = 0.001, limit = 10) {
  let last = 0;
  for (let t = 0; t <= limit; t += 0.001) {
    if (Math.abs(springProgress(t, params) - 1) >= epsilon) last = t;
  }
  return last + 0.001;
}

/** Curva CSS linear() que reproduce el spring, con su duración en ms. */
export function cssLinear(params, points = 40) {
  const total = settlingTime(params);
  const values = [];
  for (let i = 0; i <= points; i++) {
    const x = i === points ? 1 : springProgress((i / points) * total, params);
    values.push(Number(x.toFixed(4)));
  }
  return { easing: `linear(${values.join(', ')})`, durationMs: Math.round(total * 1000) };
}

// Video del monitor PGM: el video del PC500 que la app toma por la red.
//
// Lo decodifica y lo dibuja un worker (pgm-worker.js) sobre un canvas
// transferido, así ni el trabajo de la interfaz frena el video ni el video
// frena la interfaz. Aquí solo se decide cuándo arrancarlo y qué mostrar
// mientras no hay imagen.

export function createPgmVideo({ canvas, placeholder, hint, badge }) {
  let worker = null;
  let current = '';
  let showing = false;
  // Con video en pantalla la interfaz evita los desenfoques de fondo (CSS).
  const root = document.documentElement;

  const show = () => {
    showing = true;
    root.dataset.video = 'live';
    canvas.hidden = false;
    placeholder.hidden = true;
    badge.textContent = 'En vivo';
    badge.hidden = false;
  };

  const hide = (message) => {
    showing = false;
    if (root.dataset.video !== 'off') root.dataset.video = 'off';
    canvas.hidden = true;
    placeholder.hidden = false;
    badge.hidden = true;
    if (hint.textContent !== message) hint.textContent = message;
  };

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./pgm-worker.js', import.meta.url), { type: 'module' });
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: 'canvas', canvas: offscreen }, [offscreen]);
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'first-frame' && current) show();
      else if (message.type === 'stats') {
        globalThis.tenveoPgmStats = message.stats;
        if (message.stats.latency.length) {
          const all = (globalThis.tenveoPgmLatency ??= []);
          all.push(...message.stats.latency);
          all.splice(0, Math.max(0, all.length - 10000));
        }
      }
      else if (message.type === 'error') console.warn('[Monitor PGM]', message.message);
    };
    // Diagnóstico para las mediciones: tenveoPgmDebug(true) mide la latencia
    // con el emisor de prueba.
    globalThis.tenveoPgmDebug = (on) => worker.postMessage({ type: 'debug', on });
    return worker;
  }

  function waitingMessage(snapshot) {
    const dv = snapshot.extras?.deviceVideo;
    if (!dv?.connected) return 'Esperando el PC500…';
    if (!dv.streaming) return 'STREAM apagado · enciéndelo en Equipo';
    return 'Esperando el video del PC500…';
  }

  return {
    update(snapshot) {
      const status = snapshot.extras?.video;
      const url = status?.state === 'receiving' && status.playUrl ? status.playUrl : '';
      if (url !== current) {
        current = url;
        if (url) ensureWorker().postMessage({ type: 'start', url });
        else worker?.postMessage({ type: 'stop' });
      }
      if (!current) hide(waitingMessage(snapshot));
      else if (!showing) hint.textContent = 'Recibiendo video…';
    },
  };
}

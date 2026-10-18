// Video del monitor PGM.
//   Red: FLV que entrega el proceso principal, reproducido con mpegts.js con el
//        búfer mínimo y persecución de latencia para verlo casi en vivo.
//   USB: la salida de video del PC500 como cámara (getUserMedia).

const NETWORK_CONFIG = Object.freeze({
  enableWorker: false,
  enableStashBuffer: false,
  stashInitialSize: 128,
  lazyLoad: false,
  autoCleanupSourceBuffer: true,
  liveBufferLatencyChasing: true,
  liveBufferLatencyMaxLatency: 1.2,
  liveBufferLatencyMinRemain: 0.25,
});

export function createPgmVideo({ video, placeholder, hint, badge, backend, onCameras = () => {} }) {
  let player = null;
  let stream = null;
  let current = '';
  let generation = 0;
  let retryTimer = 0;

  const show = (label) => {
    video.hidden = false;
    placeholder.hidden = true;
    badge.textContent = label;
    badge.hidden = false;
  };

  const hide = (message) => {
    video.hidden = true;
    placeholder.hidden = false;
    badge.hidden = true;
    hint.textContent = message;
  };

  function destroyPlayer() {
    if (!player) return;
    try {
      player.pause();
      player.unload();
      player.detachMediaElement();
      player.destroy();
    } catch {
      // El reproductor ya estaba cerrado.
    }
    player = null;
  }

  function stopAll() {
    generation += 1;
    clearTimeout(retryTimer);
    destroyPlayer();
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      // Nada que descargar.
    }
  }

  function startNetwork(url, label) {
    const mpegts = window.mpegts;
    if (!mpegts?.getFeatureList?.().mseLivePlayback) {
      hide('Este equipo no puede reproducir video en vivo.');
      return;
    }
    const gen = generation;
    hide('Esperando imagen…');
    player = mpegts.createPlayer({ type: 'flv', isLive: true, url }, NETWORK_CONFIG);
    player.on(mpegts.Events.ERROR, () => {
      if (gen !== generation) return;
      destroyPlayer();
      hide('Reconectando el video…');
      retryTimer = setTimeout(() => {
        if (gen === generation) startNetwork(url, label);
      }, 1500);
    });
    player.attachMediaElement(video);
    player.load();
    video.muted = true;
    video.addEventListener(
      'playing',
      () => {
        if (gen === generation) show(label);
      },
      { once: true },
    );
    video.play().catch(() => {});
  }

  async function startUsb(deviceId) {
    const gen = generation;
    hide('Abriendo la salida USB del PC500…');
    if (backend.kind === 'electron') {
      const access = await backend.send('requestCameraAccess');
      if (gen !== generation) return;
      if (access?.ok === false) {
        hide(access.error);
        return;
      }
    }
    try {
      const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId }, ...size } : size,
      });
      if (gen !== generation) {
        for (const track of media.getTracks()) track.stop();
        return;
      }
      stream = media;
      video.srcObject = media;
      video.muted = true;
      await video.play().catch(() => {});
      show('USB');
      onCameras();
    } catch (error) {
      if (gen !== generation) return;
      hide(error?.name === 'NotFoundError' ? 'No se encontró la salida USB del PC500.' : `No se pudo abrir la cámara: ${error?.message ?? error}`);
    }
  }

  function wanted(snapshot) {
    const { settings, extras } = snapshot;
    const status = extras?.video;
    const network = settings.videoSource === 'push' || settings.videoSource === 'pull';
    if (network && status?.state === 'receiving' && status.playUrl) {
      return {
        key: `net|${status.playUrl}|${status.mode}|${status.source}`,
        start: () => startNetwork(status.playUrl, status.mode === 'push' ? 'RED · RTMP' : 'RED · PC500'),
      };
    }
    if (settings.videoSource === 'usb') {
      return { key: `usb|${settings.videoDeviceId}`, start: () => startUsb(settings.videoDeviceId) };
    }
    const message = network ? 'Esperando el video del PC500…' : 'Sin video. Elige una fuente en Equipo.';
    return { key: `off|${message}`, start: () => hide(message) };
  }

  return {
    update(snapshot) {
      const next = wanted(snapshot);
      if (next.key === current) return;
      current = next.key;
      stopAll();
      next.start();
    },
    async listCameras() {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput');
    },
    get playing() {
      return !video.hidden && video.readyState >= 2;
    },
  };
}

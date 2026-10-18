// WebSocket falso que conecta un servicio con un simulador en el mismo proceso.
// Se comporta como el WebSocket del navegador: abre, entrega mensajes y cierra
// de forma asíncrona. Lo usa el modo demo de la versión web.

export function createSimulatedWebSocket(simulator) {
  return class SimulatedWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    #session = null;

    constructor(url) {
      this.url = String(url);
      this.readyState = SimulatedWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;

      setTimeout(() => {
        if (this.readyState !== SimulatedWebSocket.CONNECTING) return;
        this.readyState = SimulatedWebSocket.OPEN;
        this.#session = simulator.connect(
          (text) =>
            setTimeout(() => {
              if (this.readyState === SimulatedWebSocket.OPEN) this.onmessage?.({ data: text });
            }, 0),
          (code, reason) => this.#finish(code, reason),
        );
        this.onopen?.({});
      }, 0);
    }

    send(text) {
      if (this.readyState !== SimulatedWebSocket.OPEN) throw new Error('El WebSocket simulado no está abierto');
      const session = this.#session;
      setTimeout(() => session?.receive(String(text)), 0);
    }

    close(code = 1000, reason = '') {
      if (this.readyState >= SimulatedWebSocket.CLOSING) return;
      this.#finish(code, reason);
    }

    #finish(code, reason) {
      if (this.readyState === SimulatedWebSocket.CLOSED) return;
      this.readyState = SimulatedWebSocket.CLOSED;
      this.#session?.close();
      this.#session = null;
      setTimeout(() => this.onclose?.({ code, reason, wasClean: code === 1000 }), 0);
    }
  };
}

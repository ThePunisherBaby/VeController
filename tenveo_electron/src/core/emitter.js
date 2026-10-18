// Lista mínima de suscriptores. Funciona igual en Node y en el navegador.
export class Emitter {
  #listeners = new Set();

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(value) {
    for (const listener of [...this.#listeners]) {
      try {
        listener(value);
      } catch (error) {
        console.error('[Emitter] Error en un suscriptor:', error);
      }
    }
  }
}

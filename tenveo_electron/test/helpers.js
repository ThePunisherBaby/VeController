// Espera a que el estado de un servicio cumpla una condición.
export function waitFor(service, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (predicate(service.state)) {
      resolve(service.state);
      return;
    }
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      const { raw, ...state } = service.state;
      reject(new Error(`Tiempo agotado esperando el estado. Último estado: ${JSON.stringify(state)}`));
    }, timeoutMs);
    unsubscribe = service.onChange((state) => {
      if (predicate(state)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(state);
      }
    });
  });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Revisa una condición cada pocos milisegundos, por ejemplo el estado de un simulador.
export async function until(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Tiempo agotado esperando la condición');
    await sleep(10);
  }
}

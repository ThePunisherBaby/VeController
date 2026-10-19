// Guarda la configuración en settings.json, dentro de la carpeta de datos de la app.
// Los secretos (por ejemplo, claves de transmisión) se cifran con safeStorage,
// que usa el llavero de macOS. Si el cifrado no está disponible, duran solo la
// sesión: nunca se escriben en claro.

import fs from 'node:fs/promises';
import path from 'node:path';

export class SettingsStore {
  #file;
  #safeStorage;
  #queue = Promise.resolve();

  constructor(file, safeStorage = null) {
    this.#file = file;
    this.#safeStorage = safeStorage;
  }

  async load() {
    const data = await this.#read();
    let secrets = {};
    const encrypted = typeof data.secretsEncrypted === 'string' ? data.secretsEncrypted : '';
    if (encrypted && this.#canEncrypt()) {
      try {
        const parsed = JSON.parse(this.#safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) secrets = parsed;
      } catch (error) {
        console.warn('[Settings] No se pudieron descifrar los secretos:', error.message);
      }
    }
    // obsPasswordEncrypted es de versiones anteriores (OBS ya no se usa).
    const { secretsEncrypted, obsPasswordEncrypted, ...settings } = data;
    return { settings, secrets };
  }

  // secrets undefined deja los secretos guardados como estaban.
  save(settings, secrets) {
    // Un guardado fallido no debe bloquear los siguientes.
    this.#queue = this.#queue.catch(() => {}).then(() => this.#write(settings, secrets));
    return this.#queue;
  }

  async #read() {
    try {
      const data = JSON.parse(await fs.readFile(this.#file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  async #write(settings, secrets) {
    const current = await this.#read();
    const next = { ...settings, secretsEncrypted: current.secretsEncrypted ?? '' };
    if (secrets !== undefined) {
      const empty = !secrets || Object.keys(secrets).length === 0;
      next.secretsEncrypted =
        !empty && this.#canEncrypt() ? this.#safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') : '';
    }
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, this.#file);
  }

  #canEncrypt() {
    try {
      return Boolean(this.#safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }
}

// Guarda la configuración en settings.json, dentro de la carpeta de datos de la app.
// La contraseña de OBS se cifra con safeStorage, que usa el llavero de macOS.
// Si el cifrado no está disponible, la contraseña solo dura la sesión.

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
    let obsPassword = '';
    const encrypted = typeof data.obsPasswordEncrypted === 'string' ? data.obsPasswordEncrypted : '';
    if (encrypted && this.#canEncrypt()) {
      try {
        obsPassword = this.#safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch (error) {
        console.warn('[Settings] No se pudo descifrar la contraseña de OBS:', error.message);
      }
    }
    const { obsPasswordEncrypted, ...settings } = data;
    return { settings, obsPassword };
  }

  // obsPassword undefined deja la contraseña guardada como estaba.
  save(settings, obsPassword) {
    // Un guardado fallido no debe bloquear los siguientes.
    this.#queue = this.#queue.catch(() => {}).then(() => this.#write(settings, obsPassword));
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

  async #write(settings, obsPassword) {
    const current = await this.#read();
    const next = { ...settings, obsPasswordEncrypted: current.obsPasswordEncrypted ?? '' };
    if (obsPassword !== undefined) {
      next.obsPasswordEncrypted =
        obsPassword && this.#canEncrypt() ? this.#safeStorage.encryptString(obsPassword).toString('base64') : '';
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

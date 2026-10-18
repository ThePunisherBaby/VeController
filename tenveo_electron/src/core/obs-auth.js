// Autenticación de OBS WebSocket v5.
//   secret = base64(sha256(password + salt))
//   auth   = base64(sha256(secret + challenge))
// Usa Web Crypto, que existe en Node, en Electron y en navegadores con
// contexto seguro (https o localhost).

function toBase64(buffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Base64(text, subtle) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toBase64(digest);
}

export async function obsAuthString(password, salt, challenge, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('Web Crypto no está disponible en este entorno');
  const secret = await sha256Base64(`${password}${salt}`, subtle);
  return sha256Base64(`${secret}${challenge}`, subtle);
}

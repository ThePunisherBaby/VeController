# Tenveo Studio (Electron)

Consola para controlar el switcher Tenveo PC500 y OBS Studio desde la Mac. Es la versión principal del proyecto; la documentación completa está en [DOCUMENTACION.md](../DOCUMENTACION.md).

## Comandos

```bash
npm install          # la primera vez
npm start            # abre la app desde el código fuente
npm test             # pruebas automáticas
npm run smoke        # abre la app contra simuladores, pulsa botones y guarda una captura
npm run smoke:web    # la misma prueba en modo navegador (SMOKE_WEB_DEMO=1 para el modo demo)
npm run smoke:video  # un emisor de prueba transmite H.264 por RTMP y la app lo muestra en el monitor PGM
npm run smoke:pull   # modo por defecto: la app enciende STREAM, lee el servidor interno simulado y lo apaga
npm run check-device -- <dirección>   # diagnóstico con un PC500 real (ver DOCUMENTACION.md, 4.10)
node scripts/bench-network.mjs        # mide la red de la versión anterior contra la actual
npm run mock         # simuladores del PC500 (18089) y de OBS (14455)
npm run web          # versión web en http://localhost:8765 (agrega ?demo para usar simuladores)
npm run dist         # app de Mac universal: .dmg y .zip en dist/
```

`npm run dist` no necesita Xcode. Copia el `adb` de la Mac dentro de la app y la firma de forma provisional.

## Carpetas

| Carpeta | Contenido |
|---|---|
| `src/core/` | Lógica compartida: protocolo del PC500, clientes de WebSocket, controlador y simuladores |
| `src/main/` | Proceso principal de Electron: ventana, IPC, puente ADB, búsqueda en la red, receptor de video y configuración |
| `src/main/vendor/` | Piezas del protocolo RTMP de Node-Media-Server (Apache 2.0) |
| `src/preload/` | Puente seguro entre la ventana y el proceso principal |
| `src/renderer/` | La consola: HTML, CSS y JavaScript sin frameworks, con mpegts.js para el video |
| `dev/` | Simuladores por WebSocket, emisor de video de prueba y capturas, solo para pruebas |
| `scripts/` | Arranque, servidor web, simuladores, pruebas de humo, diagnóstico y mediciones con el equipo, y copia de adb |
| `test/` | Pruebas con `node --test` |

## Variables de entorno para desarrollo

| Variable | Uso |
|---|---|
| `TENVEO_USB_URL` | WebSocket del PC500 por USB. Por defecto `ws://127.0.0.1:8089` |
| `TENVEO_OBS_HOST`, `TENVEO_OBS_PORT`, `TENVEO_OBS_PASSWORD` | Conexión con OBS |
| `TENVEO_DISABLE_ADB=1` | No usar adb |
| `TENVEO_ETHERNET_IP`, `TENVEO_CONNECTION_MODE` | IP del PC500 (también `fe80::…%en0`) y modo (`auto`, `usb`, `network`) al arrancar |
| `TENVEO_VIDEO` | Fuente de video al arrancar (`off`, `push`, `pull`, `usb`; por defecto `pull`) |
| `TENVEO_VIDEO_KEY` | Clave que espera el servidor RTMP de la app (modo `push`) |
| `TENVEO_RTMP_PORT`, `TENVEO_RTMP_HOST` | Puerto y dirección del servidor RTMP de la app |
| `TENVEO_DEVICE_RTMP_PORT` | Puerto del servidor RTMP del PC500 por IPv4 (solo pruebas; 1935) |
| `TENVEO_USER_DATA` | Carpeta de datos alternativa |
| `TENVEO_SMOKE_SHOT`, `TENVEO_SMOKE_CLICKS`, `TENVEO_SMOKE_WAIT_MS` | Captura automática que usan las pruebas de humo |
| `TENVEO_SMOKE_WAIT_VIDEO`, `TENVEO_SMOKE_VIDEO_TIMEOUT_MS`, `TENVEO_SMOKE_STOP_STREAM` | Esperar video en el monitor PGM y apagar STREAM al terminar |

Ejemplo, con los simuladores corriendo en otra terminal (`npm run mock`):

```bash
TENVEO_USB_URL=ws://127.0.0.1:18089 TENVEO_OBS_PORT=14455 TENVEO_DISABLE_ADB=1 npm start
```

Si `npm start` abre Node en vez de la ventana, alguna herramienta dejó puesta la variable `ELECTRON_RUN_AS_NODE`. El script de arranque ya la quita; si usas `electron .` a mano, ejecuta antes `unset ELECTRON_RUN_AS_NODE`.

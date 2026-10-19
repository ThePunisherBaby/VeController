# Tenveo Studio (Electron)

Consola del switcher Tenveo PC500 y estudio de producción con escenas (en lugar de OBS), desde la Mac y todo por la red. Es la versión principal del proyecto. La documentación completa está en [DOCUMENTACION.md](../DOCUMENTACION.md), el sistema de diseño en [DISENO.md](DISENO.md), el plan de la 1.5.0 en [PLAN_DISENO.md](PLAN_DISENO.md) y el del estudio en [PLAN_PRODUCCION.md](PLAN_PRODUCCION.md).

## Comandos

```bash
npm install          # la primera vez
npm start            # abre la app desde el código fuente
npm test             # pruebas automáticas
npm run smoke        # abre la app contra el simulador, pulsa botones y guarda una captura
npm run smoke:web    # la misma prueba en modo navegador (SMOKE_WEB_DEMO=1 para el modo demo)
npm run smoke:video  # la app enciende STREAM, toma el video de un servidor RTMP de prueba, lo dibuja y lo apaga
npm run smoke:ui     # interacciones: T-Bar, pestañas, Ajustes, atajos, la isla y Producción (sin ventana; SMOKE_UI_VISIBLE=1 la muestra)
npm run icon         # vuelve a dibujar el ícono de la app (build/icon.icns)
npm run check-device -- <dirección>   # diagnóstico con un PC500 real (ver DOCUMENTACION.md, 4.10)
node scripts/bench-video.mjs          # mide el video 1080p60: latencia, cuadros perdidos, fluidez y CPU (--ajustes, --produccion)
node scripts/screenshots.mjs          # capturas de la interfaz en 22 estados (claro, oscuro, contraste, tamaños, Producción)
node scripts/bench-network.mjs        # mide la red de la versión 1.0.0 contra la actual
npm run mock         # simulador del PC500 (18089)
npm run web          # versión web en http://localhost:8765 (agrega ?demo para usar simuladores)
npm run dist         # app de Mac universal: .dmg y .zip en dist/
```

`npm run dist` no necesita Xcode. Copia el `adb` de la Mac dentro de la app (lo usa el video por cable directo) y la firma de forma provisional. Electron queda en la versión 43 a propósito: en el iMac de desarrollo, la 44 no logra usar la GPU.

## Carpetas

| Carpeta | Contenido |
|---|---|
| `src/core/` | Lógica compartida: protocolo del PC500, cliente de WebSocket, controlador, modelo de la producción y simulador |
| `src/main/` | Proceso principal de Electron: ventana, IPC, búsqueda en la red, receptor de video, adb en red, configuración, producción y sus archivos |
| `src/main/vendor/` | Piezas del protocolo RTMP de Node-Media-Server (Apache 2.0) |
| `src/preload/` | Puente seguro entre la ventana y el proceso principal |
| `src/renderer/` | La consola y Producción: HTML, CSS y JavaScript sin frameworks; el monitor PGM es un worker con WebCodecs y el compositor, un worker con WebGL2 |
| `dev/` | Simuladores por WebSocket, emisor de video de prueba y capturas, solo para pruebas |
| `scripts/` | Arranque, servidor web, simuladores, pruebas de humo, diagnóstico y mediciones, y copia de adb |
| `test/` | Pruebas con `node --test` |

## Variables de entorno para desarrollo

| Variable | Uso |
|---|---|
| `TENVEO_ETHERNET_IP` | IP del PC500 al arrancar (también `fe80::…%en0`) |
| `TENVEO_PC500_PORT` | Puerto del WebSocket del PC500. Por defecto `8089` |
| `TENVEO_DISABLE_ADB=1` | No usar adb en red para el video |
| `TENVEO_DEVICE_RTMP_PORT` | Puerto del servidor RTMP del PC500 por IPv4 (solo pruebas; 1935) |
| `TENVEO_USER_DATA` | Carpeta de datos alternativa |
| `TENVEO_SMOKE_SHOT`, `TENVEO_SMOKE_CLICKS`, `TENVEO_SMOKE_WAIT_MS` | Captura automática que usan las pruebas de humo |
| `TENVEO_SMOKE_WAIT_VIDEO`, `TENVEO_SMOKE_VIDEO_TIMEOUT_MS`, `TENVEO_SMOKE_STOP_STREAM` | Esperar video en el monitor PGM y apagar STREAM al terminar |
| `TENVEO_SMOKE_SIZE`, `TENVEO_SMOKE_MEDIA`, `TENVEO_SMOKE_EVAL` | Tamaño de la ventana, preferencias del sistema simuladas (por ejemplo `prefers-contrast:more`) y código que corre antes de la captura |
| `TENVEO_HIDE_WINDOW=1` | La ventana no se muestra (pruebas que no deben molestar en la pantalla) |

Ejemplo, con el simulador corriendo en otra terminal (`npm run mock`):

```bash
TENVEO_ETHERNET_IP=127.0.0.1 TENVEO_PC500_PORT=18089 TENVEO_DISABLE_ADB=1 npm start
```

Si `npm start` abre Node en vez de la ventana, alguna herramienta dejó puesta la variable `ELECTRON_RUN_AS_NODE`. El script de arranque ya la quita; si usas `electron .` a mano, ejecuta antes `unset ELECTRON_RUN_AS_NODE`.

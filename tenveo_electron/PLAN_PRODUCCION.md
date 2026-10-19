# Plan: estudio de producción dentro de Tenveo Studio (reemplazar OBS)

Pedido del 18 de octubre de 2026: quitar la integración con OBS y construir, dentro de la app, un módulo como OBS. Debe tener:
- escenas que guardan todo;
- fuentes de todo tipo: cámaras, pantalla, imágenes, video y texto;
- recorte, chroma key e inserción de imágenes;
- transmisión a YouTube con la clave, y calidad configurable.

Lo más importante: **se trabajará con cámaras PTZ NDI de Tenveo**.

## Decisiones tomadas con el usuario
- **Orden:** primero las escenas y fuentes, después la transmisión.
- **Calidad:** hasta 4K30, con aviso.
- **Fuentes:** todas las de OBS, y además las cámaras PTZ NDI de Tenveo.

## Lo que se midió en esta Mac (Electron 43, WebCodecs)

| Codificar H.264 | Por hardware | ¿Tiempo real? |
|---|---|---|
| 1080p60 | 145 cuadros/s | Sí, con holgura |
| 1440p60 | 80 cuadros/s | Justo |
| 4K30 | 38 cuadros/s | Al límite: con aviso |
| 4K60 | 30 cuadros/s | No (sí en una Mac con Apple Silicon) |

El audio AAC (`mp4a.40.2`) se puede codificar, que es lo que exige RTMP/YouTube. El PC500 entrega 1080p60: el 4K solo tiene sentido con fuentes 4K (pantalla, cámaras NDI 4K).

**Datos que condicionan el diseño:**
- La Mac solo recibe el **programa** del PC500 (la mezcla), no cada cámara.
- Las cámaras sueltas llegan como fuentes propias: NDI de las PTZ, webcams o capturadoras y la pantalla.
- El PC500 no controla las PTZ. Su panel solo trae NDI como entrada de AUX, así que el control de las cámaras lo hace la app.

## Arquitectura

```
Fuentes                         Compositor (worker, WebGL2)            Salidas
──────────────────────────      ──────────────────────────────      ────────────────────
Programa del PC500 ─┐ VideoFrame  escena en vivo: capas con          Monitor de salida
Cámara de la Mac ───┤ (stream     posición, tamaño, recorte,          (vista Producción)
Pantalla o ventana ─┤  transferido) opacidad y chroma key            Transmisión RTMP (fase 4)
Video (archivo) ────┤             transición entre escenas            Grabación (fase 4)
Imagen · Texto ─────┤ ImageBitmap
Color ──────────────┘
Cámara NDI Tenveo (fase 3)
```

- **Modelo** (`src/core/production.js`, puro y con pruebas):
  - escenas con fuentes ordenadas (abajo → arriba);
  - cada fuente tiene tipo, posición y tamaño en píxeles de la salida, recorte, opacidad, chroma key y sus ajustes;
  - funciones para agregar, mover, ajustar a la salida, buscar bajo el puntero e imantar a bordes y centro.
- **Guardado** (`production.json` en la carpeta de datos):
  - Las imágenes y videos se copian a `media/` y se sirven por `app://tenveo/media/…`.
  - Así las escenas sobreviven aunque se borre el archivo original.
- **Compositor** (`production-worker.js`):
  - un canvas transferido y WebGL2;
  - un shader con recorte, opacidad y chroma key (similitud, suavidad y derrame, como OBS);
  - dibuja solo cuando llega un cuadro nuevo o cambia la escena: en reposo no gasta GPU.
- **Fuentes de video:**
  - Cámaras y pantalla: `getUserMedia` → `MediaStreamTrackProcessor` → stream transferido al worker.
  - Videos: un `<video>` oculto → `VideoFrame`.
  - Programa del PC500: el worker del monitor PGM, que ya decodifica, le pasa una copia de cada cuadro por un `MessageChannel`, sin decodificar dos veces.
- **Permisos:**
  - La app deja de rechazarlo todo: permite cámara y captura de pantalla solo a su propia ventana (`app://tenveo`).
  - Info.plist con `NSCameraUsageDescription` y `NSMicrophoneUsageDescription`.

## Interfaz (vista **Producción**)

- Selector **Consola · Producción** en la barra, con ⌘1 y ⌘2 en el menú Visualización.
- **Salida** grande, en 16:9:
  - se hace clic en una fuente para elegirla;
  - se arrastra para moverla, con imán a bordes y centro (Mayús lo apaga);
  - las esquinas cambian el tamaño manteniendo la proporción (Mayús libera);
  - las flechas la mueven de a 1 px, o 10 px con Mayús;
  - Borrar la quita.
- **Escenas:** lista. Un clic la pone en vivo con un fundido corto. También se agregan, renombran, duplican y quitan.
- **Fuentes** de la escena:
  - ojo para mostrar u ocultar, candado, subir y bajar, quitar;
  - **Agregar** abre un menú que nace del botón: Programa del PC500, Cámara, Pantalla o ventana, Imagen, Video, Texto, Color.
- **Propiedades** de la fuente elegida:
  - posición y tamaño, con ajustar, llenar y centrar;
  - recorte, opacidad y chroma key;
  - lo propio de cada tipo: imagen, texto, color, cámara, pantalla, video, repetir.

## Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Quitar OBS: servicio, simulador, Sync, pestaña, salidas, ajustes, pruebas y documentación | **hecho (1.6.0)** |
| 1 | Motor de escenas: modelo, guardado, compositor WebGL2, vista Producción, Programa del PC500, imagen, texto, color, posición y tamaño con manijas, recorte, opacidad, chroma key | **hecho (1.6.0)** |
| 2 | Fuentes de la Mac: cámaras y capturadoras, pantalla o ventana (con selector de miniaturas), archivos de video | **hecho (1.6.0)**; la pantalla falta probarla con el permiso de macOS |
| 3 | **Cámaras PTZ NDI de Tenveo:** búsqueda en la red (mDNS `_ndi._tcp`), video (RTSP H.264 que dan estas cámaras; NDI con su SDK como opción), control PTZ (VISCA por IP / HTTP-CGI), joystick, zoom, foco y presets | siguiente; falta probar con una cámara |
| 4 | Transmisión y grabación: H.264 + AAC con WebCodecs, RTMP a YouTube/Twitch/personalizado con la clave cifrada en el llavero, calidad hasta 4K30 con aviso, grabación MP4, estadísticas en la isla | después |
| 5 | Lo demás de OBS: transiciones configurables, modo estudio (vista previa / programa), filtros (color, máscara, nitidez), mezclador de audio de las fuentes, atajos | después |

## Lo que quedó hecho en la 1.6.0

- **Modelo** (`src/core/production.js`): escenas y fuentes; ajustar, llenar y centrar; imán a bordes y centro; tamaño desde las manijas (proporción en las esquinas); recorte como OBS (`applyCrop`: lo que queda no se estira ni se mueve); cambio de resolución que escala toda la composición (`changeOutput`); validación de todo lo que se guarda.
- **Guardado** (`src/main/production-store.js`): `production.json` atómico y con permisos 600; cada imagen o video se copia a `media/` con el nombre de su huella SHA-256. `app://tenveo/media/` atiende pedidos por rangos (`media-response.js`), que el video necesita para leer el índice de un MP4 y repetir.
- **Compositor** (`production-worker.js`): WebGL2, una textura por fuente, chroma key de OBS en el shader, fundido con dos texturas. Dibuja un cuadro de video apenas llega si está libre (dibujar en el cuadro de pantalla siguiente perdía 5 de cada 60).
- **Motor** (`production-engine.js`): cámaras y pantallas con `MediaStreamTrackProcessor`, videos con un `<video>` sin mostrar, imágenes con `ImageDecoder` (GIF animados), textos dibujados a la escala a la que se ven, el programa del PC500 por un `MessagePort` desde el monitor PGM. Lo que deja de usarse se apaga a los 8 s.
- **Vista** (`production-view.js`): manijas, imán con guías, flechas, ⌘Z/⇧⌘Z (no cambia la escena de la salida), ⌘D, ⌘C/⌘V, menús nativos, renombrar en la lista, arrastrar archivos del Finder, propiedades por tipo de fuente. La pestaña Escenas de la consola cambia la escena de la salida.
- **Permisos:** cámara y captura de pantalla solo para la propia ventana; Info.plist con `NSCameraUsageDescription`, `NSMicrophoneUsageDescription` y `NSCameraUseContinuityCameraDeviceType` (el iPhone como cámara).
- **Segundo plano:** medido, con la ventana oculta Chromium pausaba los videos sin audio y dejaba de dibujar. La app lleva `backgroundThrottling: false` y los interruptores `disable-renderer-backgrounding`, `disable-backgrounding-occluded-windows` y `disable-background-media-suspend`; el monitor PGM y el compositor tienen un temporizador de respaldo. Es la base de la transmisión (fase 4).
- **Decisiones tomadas al construir:** las fuentes nuevas entran al frente y el color al fondo (como OBS; antes quedaban tapadas); una escena nueva entra con su nombre listo para escribir; la selección va fuera del recorte redondeado para que las manijas de una fuente a pantalla completa se vean enteras.

**Mediciones** (simulador, 1080p60): la consola rinde igual que la 1.5.0; en Producción, el video pasa por el compositor con unos 3 ms más de latencia (118–119 ms), los 60 cuadros por segundo y 43–49 % de CPU.

## Verificación (cada fase)
- Pruebas del modelo y del guardado.
- `smoke:ui`: agregar fuentes, arrastrar, cambiar el tamaño, chroma key (leyendo píxeles de la salida), cambiar de escena, una cámara (la falsa de Chromium, `TENVEO_FAKE_MEDIA=1`) y un video (`dev/make-test-video.mjs`).
- Capturas de la vista Producción en claro y oscuro.
- `bench-video --produccion`: el video del PC500 no puede perder fluidez.

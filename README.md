# Tenveo PC500 Studio Link + OBS Companion

Software de escritorio hecho con **Electron**, diseñado como extensión táctil y centro de control para el conmutador de video **Tenveo PC500**, totalmente integrado con **OBS Studio** y preparado para flujos **NDI|HX**.

La documentación completa está en [DOCUMENTACION.md](DOCUMENTACION.md) y el roadmap en [PENDIENTES.md](PENDIENTES.md).

---

## 🚀 Inicio Rápido (Plug & Play)

Conecta el Tenveo PC500 a tu Mac por **USB** y/o **Ethernet**, y abre la app:

```bash
./start_app.sh
```

También puedes instalar `TenveoStudio-1.0.0-universal.dmg` (se genera con `npm run dist` en `tenveo_electron/`) y abrir **Tenveo Studio** con doble clic. La app funciona en Macs Intel y Apple Silicon.

La app se encarga sola de:
1. Detectar el Tenveo PC500 por USB con ADB, sin scripts aparte.
2. Reenviar los puertos necesarios (`8089` para el control y `8080` para el panel web original).
3. Conectarse a OBS Studio por su WebSocket.

¿Prefieres el navegador? `./start_app.sh --web` abre la misma consola en `http://localhost:8765`.

---

## ✨ Características Principales

### 1. Panel de Conmutación Broadcast (Buses PGM y PVW)
* **Bus Program (PGM - Rojo):** Muestra qué cámara está al aire. Al tocar un botón de cámara se realiza un corte en vivo inmediato.
* **Bus Preview (PVW - Verde):** Prepara la siguiente cámara para la transición.
* **Sincronización Bidireccional:** Si presionas los botones físicos del PC500, la pantalla se actualiza al instante, y si tocas la pantalla, el equipo cambia en el acto.

### 2. Controles de Transición y Fader T-Bar
* **Botón CUT:** Corte directo de PVW a PGM.
* **Botón AUTO:** Ejecuta la transición configurada en el equipo (Fade / Wipe / Mix).
* **Botón FTB (Fade To Black):** Cierre a negro con alerta visual.
* **T-Bar:** Fader de transición manual que envía su posición continua al equipo mientras lo arrastras.

### 3. Mezclador de Audio Digital (48 kHz)
* Faders verticales para **IN 1, IN 2, IN 3, IN 4, MIC 1 y PGM MASTER**, de -60 a 0 dB como en el panel del equipo.
* Botones de **MUTE** que apagan el canal en el PC500 sin perder su volumen, e indicador **AFV** cuando el canal sigue al video.

### 4. Integración Directa con OBS Studio
* Conexión por WebSocket v5 nativo (puerto 4455), **con o sin contraseña**.
* **SYNC OBS:** Al cambiar de cámara en el PC500, cambia la escena correspondiente en OBS.
* Botones de disparo rápido: **LIVE (stream)**, **REC (grabación)** y **VCAM (cámara virtual)**.
* Selector de escenas de OBS en el panel lateral.

### 5. Detección Dual (USB + Ethernet LAN)
* **USB (recomendado):** No requiere configurar IP; funciona directo con el cable USB.
* **Ethernet (NDI / red local):** Escribe la IP del equipo en el diálogo de conexión, desde el indicador de la barra superior.

### 6. Modo Demo
* Agrega `?demo` a la dirección de la versión web para usar la consola con simuladores del PC500 y de OBS, desde cualquier dispositivo o un Codespace.

---

## 🛠️ Desarrollo y Pruebas

```bash
cd tenveo_electron
npm install          # la primera vez
npm start            # abre la app desde el código fuente
npm test             # pruebas automáticas
npm run smoke        # prueba la app contra simuladores y guarda una captura
npm run dist         # genera la app de Mac universal (.dmg y .zip), sin Xcode
```

La versión anterior en Flutter sigue en `tenveo_app/` como referencia, pero ya no se desarrolla.

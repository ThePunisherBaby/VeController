# Tenveo PC500 Studio Link + OBS Companion

Software de escritorio hecho con **Electron**, diseñado como consola de control para el conmutador de video **Tenveo PC500**, totalmente integrado con **OBS Studio**. Controla el equipo por USB o por la red, y muestra su video en vivo.

La documentación completa está en [DOCUMENTACION.md](DOCUMENTACION.md) y el roadmap en [PENDIENTES.md](PENDIENTES.md).

---

## 🚀 Inicio Rápido (Plug & Play)

Conecta el Tenveo PC500 a tu Mac por **USB** y/o **Ethernet**, y abre la app:

```bash
./start_app.sh
```

También puedes instalar `TenveoStudio-1.1.0-universal.dmg` (se genera con `npm run dist` en `tenveo_electron/`) y abrir **Tenveo Studio** con doble clic. La app funciona en Macs Intel y Apple Silicon.

La app se encarga sola de:
1. Detectar el PC500 por USB con ADB, o encontrarlo en la red local.
2. Mantener la conexión con latido y reconexión automática, mostrando la latencia.
3. Conectarse a OBS Studio por su WebSocket, con o sin contraseña.

¿Prefieres el navegador? `./start_app.sh --web` abre la misma consola en `http://localhost:8765`.

---

## ✨ Características Principales

### 1. Conmutación Broadcast
* **Buses Program (rojo) y Preview (verde)**, sincronizados en tiempo real con los botones físicos del PC500.
* **CUT, AUTO y FTB**, y una **T-Bar** que envía su posición continua al equipo mientras la arrastras.
* **Capas:** PIP 1, PIP 2, DSK, LOGO 1, LOGO 2, CHROMA, LUMA y ON AIR, en dos filas como en el equipo.

### 2. Control del Equipo
* **Transmisión y grabación del PC500:** STREAM 1, STREAM 2 y REC con sus tiempos, más FREEZE, SHOT y el resto de botones del panel.
* Datos del equipo: conexión, latencia, IP en la red y firmware.

### 3. Video en Vivo en el Monitor PGM
* **Por red:** el PC500 transmite por RTMP a la Mac, o la app lee el servidor RTMP del equipo. Un botón configura el PC500 solo.
* **Por USB:** la salida de video del PC500 como cámara.

### 4. Comunicación por Red Optimizada
* **USB, red o automático**, con búsqueda del PC500 en la red local y la IP aprendida por USB.
* Latido, latencia visible y reconexión en segundos. La T-Bar y los faders nunca acumulan atraso aunque la red esté saturada.

### 5. Mezclador de Audio Digital (48 kHz)
* Faders para **IN 1, IN 2, IN 3, IN 4, MIC 1 y PGM MASTER**, de -60 a 0 dB como en el panel del equipo.
* **MUTE** real por canal e indicador **AFV** cuando el canal sigue al video.

### 6. Integración Directa con OBS Studio
* Conexión por WebSocket v5 (puerto 4455), con o sin contraseña.
* **SYNC OBS:** al cambiar de cámara en el PC500, cambia la escena correspondiente en OBS.
* **Live, Rec y Vcam**, y selector de escenas.

### 7. Modo Demo
* Agrega `?demo` a la dirección de la versión web para usar la consola con simuladores del PC500 y de OBS, desde cualquier dispositivo o un Codespace.

---

## 🛠️ Desarrollo y Pruebas

```bash
cd tenveo_electron
npm install          # la primera vez
npm start            # abre la app desde el código fuente
npm test             # pruebas automáticas
npm run smoke        # prueba la app contra simuladores y guarda una captura
npm run smoke:video  # prueba el video por red de punta a punta
npm run dist         # genera la app de Mac universal (.dmg y .zip), sin Xcode
```

La versión anterior en Flutter sigue en `tenveo_app/` como referencia, pero ya no se desarrolla.

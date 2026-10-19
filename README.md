# Tenveo PC500 Studio Link

Software de escritorio hecho con **Electron**: una consola de control para el conmutador de video **Tenveo PC500** y un **estudio de producción** propio, con escenas y fuentes, que reemplaza a OBS. Todo va por la red: controla el equipo por Ethernet o por un cable directo, y muestra su video en vivo con baja latencia. Probado con un PC500 real (ver la sección 7 de la documentación).

La documentación completa está en [DOCUMENTACION.md](DOCUMENTACION.md) y el roadmap en [PENDIENTES.md](PENDIENTES.md).

---

## 🚀 Inicio Rápido

Conecta el Tenveo PC500 a tu Mac por **Ethernet** (misma red) o con un **cable de red directo**, y abre la app:

```bash
./start_app.sh
```

También puedes instalar `TenveoStudio-1.6.0-universal.dmg` (se genera con `npm run dist` en `tenveo_electron/`) y abrir **Tenveo Studio** con doble clic. La app funciona en Macs Intel y Apple Silicon.

La app se encarga sola de:
1. Encontrar el PC500 en la red, también por cable directo (IPv6 de enlace local).
2. Mantener la conexión con latido y reconexión automática, mostrando la latencia.
3. Mostrar el video del PC500 en el monitor PGM en cuanto STREAM está encendido.
4. Guardar tus escenas de producción y sus imágenes y videos.

¿Prefieres el navegador? `./start_app.sh --web` abre la misma consola en `http://localhost:8765` (sin video).

---

## ✨ Características Principales

### 1. Conmutación Broadcast
* **Buses Program (rojo) y Preview (verde)**, sincronizados en tiempo real con los botones físicos del PC500. El Preview se marca en el mismo cuadro del clic.
* **CUT, AUTO y FTB**, y una **T-Bar** que envía su posición continua al equipo mientras la arrastras.
* **Capas:** PIP 1, PIP 2, DSK, LOGO 1, LOGO 2, CHROMA, LUMA y ON AIR, en dos filas como en el equipo.

### 2. Control del Equipo
* **Transmisión y grabación del PC500:** STREAM y REC con sus tiempos, más FREEZE, SHOT y el resto de botones del panel.
* Datos del equipo: conexión, latencia, IP en la red y firmware.

### 3. Video en Vivo en el Monitor PGM
* Del **servidor interno del PC500**: 1080p a 60 cuadros, decodificado por la GPU con WebCodecs y dibujado al instante (unos 120 ms de punta a punta en el simulador; con el PC500, lo que permite su servidor).
* **Encender STREAM** lo enciende sin salir al aire, y solo si ningún destino es una plataforma externa. La app nunca cambia los destinos del equipo.

### 4. Comunicación por Red Optimizada
* Una sola ruta, por red, con búsqueda automática del PC500 (IPv4 e IPv6).
* Latido cada segundo y latencia visible: un cable cortado se detecta en unos 3,5 s y reconecta sola. Tras un reinicio del equipo vuelve en 1 s de mediana.

### 5. Mezclador de Audio Digital (48 kHz)
* Faders para **IN 1, IN 2, IN 3, IN 4, MIC 1 y PGM MASTER**, de -60 a 0 dB como en el panel del equipo.
* **MUTE** real por canal e indicador **AFV** cuando el canal sigue al video.

### 6. Estudio de Producción (en lugar de OBS)
* **Escenas** con fuentes en capas: el **programa del PC500**, **cámaras** de la Mac (también capturadoras e iPhone), **pantalla o ventana**, **imágenes** (con GIF animados), **videos**, **textos** y **colores**.
* **Recorte, opacidad y chroma key** (verde, azul u otro color), con manijas, imán a bordes y centro, y ⌘Z.
* Fundido entre escenas, menús nativos de la Mac y arrastrar archivos desde el Finder. Todo se guarda solo.
* Compositor por la GPU (WebGL2) que suma unos 3 ms al video del PC500. Próximo: cámaras PTZ NDI de Tenveo y transmisión a YouTube.

### 7. Diseño al estilo de Apple
* Sigue las Human Interface Guidelines (sistema 26): colores de sistema, tipografía SF, geometría concéntrica, superficies planas y animaciones con springs.
* **La isla:** el estado del PC500 vive en una cápsula al centro de la barra, y los avisos salen de ella como de la Dynamic Island.
* App de Mac de verdad: menú en español con Ajustes… (⌘,), Consola (⌘1) y Producción (⌘2), Ajustes con la forma de Ajustes del Sistema e ícono propio.
* Apariencia clara u oscura (sigue a macOS o se fija en Ajustes), más contraste, transparencia reducida y Reducir movimiento. La especificación está en [tenveo_electron/DISENO.md](tenveo_electron/DISENO.md).

### 8. Modo Demo
* Agrega `?demo` a la dirección de la versión web para usar la consola con un simulador del PC500, desde cualquier dispositivo o un Codespace.

---

## 🛠️ Desarrollo y Pruebas

```bash
cd tenveo_electron
npm install          # la primera vez
npm start            # abre la app desde el código fuente
npm test             # pruebas automáticas
npm run smoke        # prueba la app contra simuladores y guarda una captura
npm run smoke:video  # prueba el video de punta a punta: Encender STREAM, video y Apagar STREAM
npm run dist         # genera la app de Mac universal (.dmg y .zip), sin Xcode
npm run smoke:ui     # prueba la interfaz, también Producción (sin ventana visible)
node scripts/bench-video.mjs   # mide latencia, cuadros perdidos, fluidez y CPU (--produccion: con el compositor)
```

La versión anterior en Flutter sigue en `tenveo_app/` como referencia, pero ya no se desarrolla.

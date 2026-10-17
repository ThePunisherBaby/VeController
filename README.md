# Tenveo PC500 Studio Link + OBS Companion

Software profesional en Flutter diseñado como una extensión táctil y centro de control para el conmutador de video **Tenveo PC500**, totalmente integrado con **OBS Studio** y preparado para flujos **NDI|HX**.

---

## 🚀 Inicio Rápido (Plug & Play)

Solo conecta el Tenveo PC500 a tu Mac por **USB** y/o **Ethernet** y ejecuta:

```bash
./start_app.sh
```

El script se encargará automáticamente de:
1. Detectar el hardware Tenveo PC500 a través del puerto USB.
2. Levantar el puente WebSocket y reenviar los puertos necesarios (`8089` y `8080`).
3. Abrir la consola de control interactiva en tu navegador.

---

## ✨ Características Principales

### 1. Panel de Conmutación Broadcast (Buses PGM y PVW)
* **Bus Program (PGM - Rojo):** Muestra qué cámara o fuente está actualmente al aire. Al tocar un botón de cámara se realiza un corte en vivo inmediato.
* **Bus Preview (PVW - Verde):** Prepara la siguiente cámara para transición.
* **Sincronización Bidireccional en Tiempo Real:** Si presionas los botones físicos en el mezclador Tenveo PC500, la interfaz en pantalla se actualiza instantáneamente; y si tocas la pantalla, los botones y LEDs físicos del PC500 cambian en el acto.

### 2. Controles de Transición y Fader T-Bar
* **Botón CUT:** Corte directo instantáneo de PVW a PGM.
* **Botón AUTO:** Ejecuta la transición suave configurada (Fade / Wipe / Mix).
* **Botón FTB (Fade To Black):** Corte de emergencia o cierre a negro con alerta visual.
* **T-Bar Ergonómico:** Fader deslizante para control manual de la transición.

### 3. Mezclador de Audio Digital (48 kHz)
* Faders verticales individuales para **IN 1, IN 2, IN 3, IN 4, MIC 1 y PGM MASTER**.
* Escala en decibelios (dB) y vúmetros dinámicos con alerta de saturación (verde, amarillo, rojo).
* Botones de MUTE dedicados por canal.

### 4. Integración Directa con OBS Studio
* Conexión por WebSocket v5 nativo (puerto 4455).
* **SYNC OBS:** Al cambiar de cámara en el Tenveo PC500, puede conmutar automáticamente la escena correspondiente en OBS Studio.
* Botones de disparo rápido: **STREAM (En vivo)**, **REC (Grabación)** y **VCAM (Cámara Virtual)**.
* Selector de escenas de OBS en el panel lateral.

### 5. Detección Dual (USB + Ethernet LAN)
* **USB (Recomendado Plug & Play):** No requiere configuración de IP, funciona directo con el cable USB provisto.
* **Ethernet (NDI / Red Local):** Si conectas el equipo por cable de red a un router o switch, puedes ingresar su IP directamente desde el botón de configuración superior.

---

## 🛠️ Desarrollo y Pruebas

Para ejecutar el código fuente en modo desarrollo:

```bash
cd tenveo_app
flutter run -d chrome
```

Para correr las pruebas unitarias:

```bash
cd tenveo_app
flutter test
```

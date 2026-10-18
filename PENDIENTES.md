# Roadmap y Funcionalidades Pendientes — Tenveo PC500 Studio Link

Este documento detalla el estado actual del proyecto, las funciones implementadas y todo lo que falta por desarrollar, categorizado por área y nivel de prioridad.

> **17 de octubre de 2026:** la consola pasó de Flutter a **Electron** (`tenveo_electron/`). La app de Flutter (`tenveo_app/`) queda como legado. Los puntos marcados como "probado con simulador" funcionan contra los simuladores del proyecto, pero falta confirmarlos con el PC500 conectado.

---

## 📊 Estado Actual: ¿Qué está listo y probado?

- [x] **Ingeniería inversa del protocolo:** Identificación del SoC Rockchip RV1126, Linux embebido, daemon `t4_daemon` y WebSocket JSON en puerto `8089`. Las claves del protocolo son los `id` de los controles del panel web original.
- [x] **Conmutación básica en vivo:** Selección de cámaras (1, 2, 3, 4, AUX) en Preview, transiciones CUT, AUTO y FTB (Fade to Black).
- [x] **Sincronización bidireccional:** Cambios reflejados en LEDs físicos y en la interfaz en tiempo real.
- [x] **Migración a Electron:** Consola completa reescrita en [`tenveo_electron/`](tenveo_electron/) con el mismo diseño broadcast: buses PGM/PVW, T-Bar, mezclador de audio y panel de OBS.
- [x] **Integración OBS Studio (v5):** Control de Stream, Grabación, Cámara Virtual, selector de escenas y sincronización automática de escenas al cambiar de cámara. Ahora también con contraseña.
- [x] **Compilación sin Xcode:**
  - App de Mac **universal** (Intel y Apple Silicon) en `.dmg` y `.zip` con `npm run dist`.
  - Versión web con `./start_app.sh --web` y modo demo con `?demo`.
- [x] **Plug & Play sin scripts:** La app incluye `adb`, detecta el PC500 por USB, reenvía los puertos y los quita al salir.
- [x] **Pruebas automáticas:** Pruebas del protocolo, servicios, OBS, puente ADB y configuración, más pruebas de humo que abren la app real contra simuladores del PC500 y de OBS.

---

## 🎯 Lo que falta por implementar

### 1. Video en Vivo en la Interfaz (Multiview Real)
Actualmente, los monitores de **PROGRAM (PGM)** y **PREVIEW (PVW)** en la app muestran paneles de estado y placeholders estilizados, pero **no el flujo de video en tiempo real**.

- [ ] **Captura de video USB (UVC):** Mostrar la salida PGM del Tenveo en el monitor de la app con `getUserMedia` de Chromium, que Electron ya incluye.
- [ ] **Multiview por red (RTSP / HTTP / WebRTC):** El PC500 genera streams de video por red. Se puede capturar el stream RTSP/HTTP local y renderizar el multiview de las 4 cámaras en miniatura.
- [ ] **Baja latencia:** Asegurar que el pipeline de video tenga menos de 100 ms de retraso para monitoreo en vivo confiable.

---

### 2. Protocolo Extendido del Hardware Tenveo PC500
El análisis del firmware original (`index.js` y `pc.html`) reveló comandos adicionales que el hardware soporta pero la app aún no controla:

- [ ] **Efectos de Transición (Wipe, Mix, Dip):**
  - Mapear la clave `trans-effect` (soporta más de 30 patrones de cortinilla/wipe).
  - Configurar duración de transición (`trans_interval`) y suavizado de bordes (`trans_softness`).
  - Configurar color del Dip (`dip_color`, `dip_mode`).
- [x] **Posición precisa del T-Bar:** La app envía `putter` de 0 a 255 durante el arrastre, igual que el slider del panel original. Probado con simulador; falta confirmar con el equipo.
- [ ] **Capas PiP (Picture in Picture):**
  - Activar/desactivar `pip1` y `pip2` (`pip1-on-air`, `pip2-on-air`).
  - Posicionamiento, tamaño y recorte de las ventanas PiP.
- [ ] **Logos y Overlays (DSK / GFX):**
  - Carga y activación de logos en pantalla (`logo1`, `logo2`, `gfx_logo`, `dsk`).
- [ ] **Mezclador de Audio Avanzado:**
  - [x] Mute por canal con los controles del panel: `audio_pgm_on` y `audio_mic1_on` para PGM y MIC 1, `audio_inX_mode` para las entradas. Probado con simulador; falta confirmar con el equipo.
  - [ ] Modo AFV (*Audio Follows Video*): la app ya muestra cuando un canal está en AFV; falta poder activarlo desde la consola.
  - [ ] Ajuste de retardo de audio por entrada (`audio_in1_delay` a `in4_delay`) para compensar desincronización labial (Lip-Sync).
- [ ] **Grabador y Emisor RTMP Interno del PC500:**
  - Control de grabación directa en tarjeta SD / USB del equipo (`record_time`, espacio libre `udisk-space`, `sdcard-space`).
  - Configuración y arranque de streaming RTMP autónomo (`stream-1`, `stream-2`, servidores y claves de transmisión) sin depender de OBS.
- [ ] **Ajustes de Sistema del Hardware:**
  - Brillo de LEDs físicos (`sys_keyledlight`).
  - Control de ventilador interno (`sys_fan`) y retroiluminación (`sys_backlight`).
  - Configuración de red IP/DHCP (`sys_ip`, `sys_dhcp`, `sys_gateway`, `sys_netmask`).

---

### 3. Integración con OBS Studio
- [x] **Autenticación con contraseña (OBS WebSocket v5):**
  - Handshake SHA-256 (`challenge` + `salt`) en [obs-service.js](tenveo_electron/src/core/obs-service.js). La contraseña se escribe en el diálogo de conexión y se guarda cifrada en el llavero de macOS.
- [ ] **Mapeo personalizado de escenas:**
  - Permitir al usuario vincular en una ventana de ajustes cada botón del PC500 (Cam 1..4, Aux) con cualquier escena de OBS, sin obligar a que se llamen exactamente `Cam 1`, `Cam 2`, etc.
- [ ] **Soporte para Modo Estudio de OBS (*Studio Mode*):**
  - Sincronizar el bus Preview de la app con la escena de Previsualización de OBS, y ejecutar transición en OBS al presionar CUT/AUTO en el Tenveo.
- [ ] **Vúmetros de audio de OBS:**
  - Reflejar los niveles de audio reales de OBS en los faders de la consola. Hoy los vúmetros siguen la posición del fader, porque el PC500 no manda niveles.

---

### 4. Flujos NDI | HX
- [ ] **Detección de fuentes NDI en la red:**
  - Explorar las claves `ndi_list` y `ndi_name` del PC500 para permitir que la entrada AUX tome feeds NDI de la red local.
- [ ] **Extracción/Recepción NDI en la Mac:**
  - Si el PC500 expone su salida PGM por NDI, añadir un receptor NDI ligero en la Mac para capturarlo sin cables USB.

---

### 5. Empaque, Distribución y Experiencia de Usuario en macOS
- [x] **ADB embebido (sin dependencia de terminal):**
  - `npm run dist` copia `adb` dentro de `Tenveo Studio.app/Contents/Resources/platform-tools/` y la app lo maneja sola.
- [x] **Compilación Universal / Apple Silicon (ARM64 nativo):**
  - La app sale como binario universal (`x86_64` + `arm64`), sin Rosetta 2 en chips M1/M2/M3/M4.
- [ ] **Icono oficial de la aplicación:**
  - Diseñar y asignar el archivo `.icns` de alta resolución (en `tenveo_electron/build/icon.icns`).
- [x] **Instalador `.dmg` drag-and-drop:**
  - `npm run dist` genera `TenveoStudio-1.0.0-universal.dmg`.
- [ ] **Firma con Developer ID y notarización:**
  - Hoy la app tiene firma provisional y otra Mac la bloquea hasta desbloquearla con `xattr`. Hace falta una cuenta de desarrollador de Apple.

---

## 🗓️ Plan de Implementación Sugerido por Fases

```mermaid
gantt
    title Plan de Desarrollo Tenveo PC500 Studio Link
    dateFormat  X
    axisFormat %s

    section Fase 1: Esenciales
    Migración a Electron                    :done, p0, 0, 2
    Autenticación OBS con contraseña        :done, p1, 0, 2
    Mapeo personalizado de escenas OBS     :active, p2, 1, 3
    Mute real por canal                     :done, p3, 2, 4
    Binario universal (Apple Silicon)       :done, p4, 3, 5
    Confirmar protocolo con el equipo       :active, p4b, 3, 5

    section Fase 2: Hardware Completo
    T-Bar analógico continuo                :done, p5, 4, 7
    Audio Follows Video (AFV)               :p5b, 4, 7
    Transiciones Wipe, Mix y Dip            :p6, 5, 8
    Capas PiP y control de Logos            :p7, 6, 9
    ADB embebido en el .app                 :done, p8, 7, 10

    section Fase 3: Video y Emisión
    Monitor con Video en Vivo (UVC/RTSP)    :p9, 9, 13
    Control de Grabación/Streaming interno  :p10, 11, 14
    Soporte NDI | HX                        :p11, 12, 15
    Empaque final en archivo .dmg           :done, p12, 14, 16
    Icono, firma y notarización             :p13, 14, 16
```

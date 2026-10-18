# Sistema de diseño de Tenveo Studio

La interfaz de la versión 1.5.0 sigue las Human Interface Guidelines de Apple (sistema 26: jerarquía, armonía y consistencia) con el método de `APPLE_FRONTEND_PROMPT.md`: especificación antes que código, tokens, springs y accesibilidad completa.

El plan de esta revisión está en [PLAN_DISENO.md](PLAN_DISENO.md). Ahí está la auditoría contra el prompt, la exploración 10 → 3 → 1 del momento firma y la lista de cambios.

Las etiquetas indican de dónde sale cada decisión:
- **[APPLE]**: HIG o documentación de Apple.
- **[DERIVADO]**: cálculo exacto a partir de datos de Apple.
- **[MEDIDO]**: probado en esta Mac.
- **[HEURÍSTICA]**: valor de partida que se puede ajustar.

Todo vive en:
- [`src/renderer/styles/app.css`](src/renderer/styles/app.css);
- [`src/renderer/js/springs.js`](src/renderer/js/springs.js) (física);
- [`src/renderer/js/island.js`](src/renderer/js/island.js) (la isla);
- [`dev/render-icon.mjs`](dev/render-icon.mjs) (el ícono).

## 1. Brief

- **Tarea principal:** operar el switcher en vivo, es decir, ver PGM y PVW y conmutar cámaras sin errores.
- **Quién y dónde:** un operador de video en una sala de control, a veces con poca luz, con mouse o trackpad. Mira la pantalla a distancia, durante sesiones largas y con prisa.
- **Plataformas:**
  - Electron 43 (Chromium 150) en macOS, Intel y Apple Silicon;
  - la versión web en navegadores modernos, también en un teléfono.
  - Ventana mínima de 1180×740, probada hasta 5K.
- **Restricciones:**
  - El video del PGM a 60 cuadros/s no puede perder fluidez. La GPU de desarrollo es una R9 M290X.
  - El tally cambia en el mismo cuadro.
  - Ningún clic accidental puede sacar algo al aire.
- **Supuestos:**
  - La apariencia sigue a macOS. El HIG permite una apariencia oscura fija en apps de medios, y por eso hay selector.
  - No hay háptica: el navegador no tiene acceso al Force Touch de la Mac.

## 2. Decisiones

| Decisión | Por qué |
|---|---|
| Superficies planas: sin halos, sin bordes especulares, sin biseles, sin brillos al presionar | "La jerarquía se expresa con capas, desenfoque y movimiento, no con bordes, biseles y degradados" (iOS 7) [APPLE]. En la 1.4.0 parecían "una luz desde afuera" |
| Lo fijo es material plano (relleno y línea fina), sin llamarlo vidrio | Sin lente ni adaptación no es Liquid Glass (anti-patrón 19) [APPLE]. Con video, el vidrio real no se puede pagar [MEDIDO] |
| **La isla**: el estado de la barra se transforma en los avisos | Momento firma, al estilo de la Dynamic Island (§4.9 y §12 fase 5): un phase morph con canales desfasados [APPLE] |
| Líneas finas de un píxel físico (0,5 px en Retina) | Hairlines [APPLE] |
| Barra de la app integrada con la barra de título | Barras unificadas del sistema 26; se ganan 28 px para el video [APPLE] |
| Menú nativo en español, Ajustes… con ⌘, y Acerca de | Convenciones de la Mac [APPLE] |
| Ícono en la grilla de macOS: lienzo de 1024, cuerpo squircle de 824 y sombra | Plantilla de íconos de macOS [APPLE]. La marca de la barra es el mismo dibujo |
| Ajustes como Ajustes del Sistema: grupos de filas, interruptor, Apariencia con miniaturas | Formularios del sistema 26 [APPLE] |
| Las salidas de OBS son segmentos solo de texto | No mezclar ícono y texto en un grupo con fondo compartido (anti-patrón 28) [APPLE] |
| Colores semánticos con `light-dark()` y cuatro variantes por color | Claro, oscuro y alto contraste [APPLE] |
| Radio exterior 22, padding 12, radio interior 10; squircle salvo en las pantallas de video | Concentricidad [APPLE]. Un recorte que no es un óvalo sobre el canvas obliga a una máscara por cuadro [MEDIDO] |
| Encabezados en tipo título, en negrita; mínimo 10 px | Sistema 26; mínimo de 10 pt en macOS [APPLE] |
| Texto secundario claro al 78 % y tally PGM `#E9152D` con blanco | 4,5:1 o más; el gris de Apple da 3,4:1 y el rojo normal 3,4:1 [DERIVADO] |
| Toques sin impulso con spring sin rebote (Ajustes) | §7.4: un toque sin momentum lleva rebote 0 [APPLE] |
| T-Bar con banda elástica pasado el extremo | §7.6: sin frenazos en los límites [APPLE + COMUNIDAD c = 0,55] |
| Rodillo de dígitos solo en los tiempos de Stream y Rec, no en la latencia | §8.6 numericText [APPLE]. La latencia cambia cada segundo y rodarla costaba GPU [MEDIDO] |
| Sin `backdrop-filter` mientras hay video | Impide que macOS presente el video como capa propia [MEDIDO] (sección 8) |
| Flecha en vez de mano sobre los botones; tally sin animación de color | Convención de la Mac; respuesta en el mismo cuadro [APPLE] |

## 3. Tokens

### Color

| Token | Uso | Claro | Oscuro | Alto contraste claro | Alto contraste oscuro |
|---|---|---|---|---|---|
| `--bg` | Fondo de la ventana | `#F2F2F7` | `#000000` | igual | igual |
| `--card` | Consola y barra lateral | `#FFFFFF` | `#1C1C1E` | `#FFFFFF` | `#000000` |
| `--key` | Teclas en reposo | `#ECECF0` | `#2C2C2E` | `#FFFFFF` y borde | `#1C1C1E` y borde |
| `--control` | Cápsulas de la barra | `#FFFFFF` | `rgb(255 255 255 / .08)` | `#FFFFFF` y borde | `#000000` y borde |
| `--island` | La isla | `#000000` | `#1C1C1E` y línea fina | igual, con borde | igual, con borde |
| `--label` | Texto | `#000000` | `#FFFFFF` | igual | igual |
| `--label-2` | Texto secundario | `rgb(60 60 67 / .78)` | `rgb(235 235 245 / .6)` | `/ .92` | `/ .85` |
| `--red` | PGM, en vivo, silencio | `#FF383C` | `#FF4245` | `#E9152D` | `#FF6165` |
| `--green` | PVW, conectado | `#34C759` | `#30D158` | `#008932` | `#4AD968` |
| `--orange` | Transición, AFV | `#FF8D28` | `#FF9230` | `#C55300` | `#FFA056` |
| `--blue` | Foco, faders, íconos de aviso | `#0088FF` | `#0091FF` | `#1E6EF4` | `#5CB8FF` |
| `--purple` | OBS | `#CB30E0` | `#DB34F2` | `#B02FC2` | `#EA8DFF` |

Rellenos encendidos y su texto (contraste WCAG 2):

| Relleno | Texto | Contraste |
|---|---|---|
| PGM `#E9152D` | blanco | 4,56:1 (con más contraste, `#C7001B`: 6,1:1) |
| PVW (verde de sistema) | `#052E12` | 7,4:1 o más; blanco en alto contraste claro |
| AUTO (naranja de sistema) | `#2B1700` | 7,7:1 |
| Botón primario e interruptor `#1E6EF4` | blanco | 4,57:1 |
| Luces del panel (tinte del 22 %) | `--lit-*-text` | 5,7:1 o más |
| Rótulo sobre el video `rgb(0 0 0 / .6)` | blanco | 4,7:1 aunque el video sea blanco |
| La isla | blanco / `rgb(235 235 245 / .62)` | 21:1 / 8:1 o más |

### Tipografía

Se usa la fuente del sistema (`system-ui`: SF Pro en la Mac), con tamaño óptico automático y el tracking de SF por tamaño [APPLE].

| Estilo (macOS) | Uso |
|---|---|
| Title 2, 17/22, bold | Título de Ajustes |
| Headline, 13/16, bold | Encabezados de sección y de grupos |
| Body, 13/16 | Filas de Ajustes, datos del equipo, listas, pestañas, botones, mensajes de la isla |
| 14/17 semibold | Teclas de la consola |
| Callout, 12/15 | Estado en la isla, rótulos, notas |
| Subheadline, 11/14 | dB, tiras del mezclador |
| Footnote, 10/13 | Entrada de cada tecla (HDMI 1), AFV, etiqueta de tally |

### Espacio, geometría y materiales

- **Espacio:** escala de 4 px (4, 8, 12, 16, 20, 24) [HEURÍSTICA].
- **Geometría:**
  - Radio exterior 22 para tarjetas y pantallas.
  - Interior de 10 para teclas, tiras y grupos.
  - Grupos de Ajustes de 12 dentro de una hoja de 26.
  - Cápsulas para botones, pestañas, chips y la isla.
- **Medidas:**
  - Controles de 34 px (segmentos de 28) y barra de 52 px.
  - "M" de 28 px.
  - Líneas finas de `--hair`: 1 px, o 0,5 px en pantallas 2x.
- **Material de controles:** relleno, línea fina y, en claro, una sombra de 1 px. Al presionar, un relleno más oscuro.
- **Hoja de Ajustes:**
  - Desenfoque real (`blur(30px) saturate(180%)`) solo sin video.
  - Con video, `--sheet-solid` opaco.
  - Sombra grande y suave: lo único que flota.

### Movimiento

Springs de Apple con masa 1; las fórmulas reproducen la documentación de `SwiftUI.Spring` [DERIVADO]. Las curvas CSS `linear()` salen de `cssLinear()` en `springs.js`.

| Token | Spring (duración, rebote) | Hasta asentarse | Uso |
|---|---|---|---|
| `--ease-smooth` + `--dur-smooth` | (0,5 s, 0) | 735 ms | Ajustes al abrir, video que se materializa |
| `--ease-snappy` + `--dur-snappy` | (0,5 s, 0,15) | 697 ms | Pulgar del segmentado (selección) |
| `--dur-micro` | (0,3 s, 0) | 441 ms | Presionar, salida de Ajustes, paneles que entran |
| `--dur-micro-snappy` | (0,3 s, 0,15) | 419 ms | Soltar, perillas, interruptor, rodillo de dígitos |
| Isla (JS) | ancho (0,42, 0,18) y alto (0,50, 0,12) al abrir; alto (0,40, 0) y ancho (0,50, 0) al cerrar | — | Phase morph |
| T-Bar (JS) | (0,3, 0) cuando cambia sin arrastre; (0,5, 0) al volver de la banda elástica | — | Posición |

## 4. Mapa de capas

| Capa | Elementos | Material |
|---|---|---|
| Contenido | Monitores, teclas, mezclador, listas, datos del equipo | Sólido, color semántico |
| Controles fijos | Cápsulas de la barra, pestañas | Material plano: relleno y línea fina |
| Estado y avisos | La isla | Cápsula negra (claro) o elevada (oscuro), sin desenfoque |
| Sobre el video | Rótulo PGM/PVW, "En vivo" | Atenuación del 60 % y línea fina |
| Temporal | Ajustes | Hoja gruesa: desenfoque real sin video, opaca con video |
| Transitoria | Manija de la T-Bar, perillas de los faders | Se elevan al arrastrarlas: escala y sombra |

El color marca solo estados: tally, Live y Rec en rojo, Vcam e interruptor en azul, la escena de OBS en morado.

## 5. Estados de los componentes

| Componente | Estados |
|---|---|
| Tecla de cámara | Reposo, hover, presionada (escala 0,97), PGM (rojo), PVW (verde), sin conexión (atenuada) |
| Tecla del panel | Reposo, luz roja, verde, amarilla, azul o blanca (tinte y texto de color), parpadeo (borde fijo con Reducir movimiento) |
| CUT / AUTO / FTB | Reposo, CUT encendido (rojo), AUTO en curso (naranja), FTB activo (tinte rojo que parpadea) |
| T-Bar | En reposo, arrastrando (manija elevada), a mitad (valor en naranja), estirada pasado un extremo, volviendo, cambio sin arrastre |
| Isla | Compacta (estado), abriéndose, aviso (información, listo, error), en pausa con el puntero encima, cerrándose; se ajusta sola si cambia el ancho del estado |
| Monitor PGM | Esperando el PC500, STREAM apagado, recibiendo, en vivo (video + "En vivo"), Fade to black, sin dato del equipo |
| Ajustes | Cerrado, abriéndose desde el botón, abierto, buscando, resultados, error; interruptor apagado o encendido; apariencia Clara, Oscura o Automática |

## 6. Especificación de movimiento

| Interacción | Disparador | Propiedades | Spring | Interrupción | Reducir movimiento |
|---|---|---|---|---|---|
| Presionar una tecla o botón | Al bajar el botón | Escala 0,97 y relleno | micro / micro-snappy al soltar | Se invierte desde donde está | Solo relleno |
| Tally | Estado del equipo | Color | Ninguno: mismo cuadro | — | Igual |
| Isla: aviso | Mensaje nuevo | Ancho y alto con desfase, radio = `min(22, alto/2)`; estado sale (120 ms) y mensaje entra (desde 140 ms) | Ver tokens | Un aviso nuevo redirige los dos springs | Cambio de tamaño inmediato, solo fundido |
| Isla: vuelta | 4,5 s (pausa con el puntero encima) o clic | Lo mismo, al revés: lidera el alto | Ver tokens | — | Igual que arriba |
| Pestañas | Clic o flechas | Pulgar: `translate`; el panel entra con fundido y 6 px | snappy / micro | Retoma desde la posición actual | Salta, solo fundido |
| Abrir Ajustes | Clic o ⌘, | Opacidad, escala 0,95 → 1, `translate` −8 px, desde el botón | smooth, sin rebote | Cerrar invierte el camino | Solo opacidad |
| Interruptor | Clic | Pulgar `translate` 16 px, color | micro-snappy | Se invierte | Salta |
| T-Bar arrastrada | Puntero | Posición 1:1 | Ninguno | — | Igual |
| T-Bar pasado un extremo | Puntero | Estiramiento `rubberBand(x, 36)`; el valor se queda en 0 o 255 | Al soltar, (0,5, 0) con la velocidad del gesto | Agarrarla de nuevo la detiene | Vuelve sin animar |
| Tiempos de Stream y Rec | Cambia un dígito | Ese dígito sube 0,55 em con fundido | micro-snappy | — | Sin rodillo |
| Video que aparece | Primer cuadro | Desenfoque 12 px → 0 y opacidad; no queda filtro | smooth | — | Solo opacidad |

## 7. Accesibilidad

- **Reducir movimiento:** `--motion: 0` anula escalas y desplazamientos. La isla cambia de tamaño al instante. Sin rodillo ni parpadeos (borde punteado fijo).
- **Reducir transparencia:** la hoja de Ajustes pasa a ser sólida.
- **Más contraste:**
  - variantes de alto contraste del HIG;
  - superficies blancas o negras;
  - teclas, cápsulas, grupos y la isla con borde;
  - rótulos sobre el video con borde blanco.
- **Colores forzados (Windows):** el tally y los rojos de estado conservan su color.
- **Teclado:**
  - anillo de foco de 3 px;
  - pestañas con el patrón ARIA;
  - Ajustes con ⌘,;
  - teclas 1 a 5 para el Preview;
  - CUT y AUTO sin atajo a propósito.
- **Lector de pantalla:**
  - el mensaje de la isla está en una región `status`, con el ícono como apoyo y no como reemplazo;
  - buses y capas agrupados con su nombre;
  - `aria-pressed` en teclas, salidas y Sync;
  - el interruptor tiene `role="switch"`;
  - la T-Bar es un `slider`.
- **Contraste:** todo texto con significado da 4,5:1 o más en las cuatro variantes.
- **Objetivos:** 28 px o más en todos los controles.
- **Zoom:** desde el menú Visualización. Por debajo de 1100 px de ancho, todo pasa a una columna (probado a 390×844).

## 8. Rendimiento

Medido con `node scripts/bench-video.mjs` en el iMac de desarrollo, con video 1080p60 del simulador.

| Prueba | 1.3.0 | Primer intento de 1.4.0 (vidrio real) | 1.4.0 | 1.5.0 |
|---|---|---|---|---|
| Latencia de punta a punta (mediana / p95) | 117 / 225 ms | 3440 / 7127 ms | 108–123 / 114–175 ms | **123–125 / 162–170 ms** |
| Cuadros perdidos | 0 % | 20,7 % | 0 % | **0 %** |
| Ventana | 60 cuadros/s | 46,5 cuadros/s | 60 cuadros/s | **60 cuadros/s, sin tirones** |
| Clic → Preview pintado | 32 ms | 41 ms | 32 ms | **32–33 ms** |
| CPU total (GPU) | 51 % (31 %) | 44 % (32 %) | 39–48 % (23–30 %) | **46–48 % (29–31 %)** |

En corridas alternadas en las mismas condiciones, la 1.4.0 empaquetada y la 1.5.0 dan lo mismo: 121–123 contra 123–124 ms y 46–48 % de CPU en ambas. La variación entre corridas es de unos 10 ms.

**Lo que se aprendió:**
- Cualquier `backdrop-filter` en pantalla impide que macOS presente el video como una capa propia, y la GPU compone toda la ventana 5K en cada cuadro. Pasó en la 1.4.0: 3,4 s de latencia.
- Ni siquiera dos chips chicos con desenfoque son gratis: 133 → 365 ms.
- Animar algo cada segundo también se nota. El rodillo en la latencia de la isla subía la GPU unos 5 puntos, y se quitó.

## 9. Verificación

- `npm test`: 98 pruebas, entre ellas los springs y la banda elástica contra el prompt y la documentación de Apple, y el ajuste de apariencia.
- `npm run smoke`, `npm run smoke:web` (también en modo demo y a 390×844 con `SMOKE_WEB_SIZE`) y `npm run smoke:video`.
- `npm run smoke:ui`: 19 verificaciones con eventos de verdad:
  - la T-Bar sigue al puntero 1:1 aunque esté elevada, el PC500 recibe su posición y se queda donde se suelta;
  - pasado el extremo se estira sin que el PC500 reciba más de 255, y vuelve;
  - las pestañas se recorren con las flechas;
  - Ajustes nace de su botón y Esc lo cierra;
  - la apariencia se aplica al instante;
  - la tecla 3 marca CAM 3 con `aria-pressed`;
  - la isla se transforma en el aviso, con el radio sacado de su alto, y vuelve con un clic.
- `node scripts/screenshots.mjs` captura 17 estados:
  - pestañas, Ajustes, sin conexión;
  - tamaño mínimo, 1920 y 5K;
  - claro;
  - más contraste en oscuro y en claro;
  - transparencia reducida;
  - la isla en oscuro y en claro;
  - Ajustes con el interruptor.

  Las preferencias se simulan con `TENVEO_SMOKE_MEDIA` y los avisos con `TENVEO_SMOKE_EVAL`.
- Isla en cámara lenta, al 10 %, con `tenveoTimeScale` y `Animation.setPlaybackRate`:
  - el radio crece de 16 a 20,8 px sin saltos;
  - al abrirse, el estado ya está en 0 cuando el mensaje empieza a aparecer;
  - al cerrarse, el mensaje se va antes de que vuelva el estado. Esto se corrigió tras verlo en cámara lenta.
- `node scripts/bench-video.mjs` y `--ajustes`.

## 10. Autoevaluación (rúbrica del prompt, de 0 a 5)

| Dimensión | Nota | Notas |
|---|---|---|
| Tarea principal y jerarquía | 5 | PGM y PVW dominan; jerarquía por disposición y superficies, sin adornos |
| Fidelidad a la plataforma | 5 | Barra unificada, menú nativo con ⌘,, Acerca de, ícono en la grilla de macOS, Ajustes como Ajustes del Sistema, flecha |
| Geometría y layout | 5 | Concéntrico, líneas de un píxel, escala de 4; de 390 px a 5K |
| Tipografía | 4 | Estilos de macOS y tracking de SF. macOS no tiene Dynamic Type; el zoom funciona |
| Color y materiales | 5 | Semántico, cuatro variantes, plano y honesto: vidrio real solo donde se puede pagar |
| Física del movimiento | 5 | Springs en tokens, redirigibles; banda elástica con velocidad; sin inercia en la T-Bar a propósito |
| Morphing y coreografía | 5 | La isla (phase morph revisado en cámara lenta), segmentado, Ajustes desde su botón, paneles y dígitos |
| Simbiosis | 4 | Ventana integrada con los semáforos, la isla, el ícono igual que la marca. Sin háptica (web) |
| Accesibilidad | 4 | Movimiento, transparencia, contraste, colores forzados, teclado, ARIA. Falta una pasada con VoiceOver |
| Rendimiento | 5 | Igual que la 1.4.0 en corridas alternadas y mejor que la 1.3.0 |
| Estados y contenido extremo | 4 | Sin conexión, sin dato, sin video, demo, navegador, errores, contraseña guardada, ventana mínima y teléfono |
| Calidad del código | 4 | Tokens, componentes y pruebas de interacción; quedan algunos px fijos de componentes |

## 11. Pendiente de validar

- Valores [HEURÍSTICA] en uso real:
  - tiempo de la isla (4,5 s);
  - estiramiento de la T-Bar (36);
  - alto de las teclas (`clamp(52px, 8,4vh, 84px)`).
- Una pasada con VoiceOver y con el teclado completo.
- En una Mac con Apple Silicon quizás el desenfoque sobre el video sea gratis. Medir con `bench-video` antes de cambiar la regla.

# Sistema de diseño de Tenveo Studio

La interfaz de la versión 1.4.0 sigue las Human Interface Guidelines de Apple (sistema 26: jerarquía, armonía y consistencia) con el método de `APPLE_FRONTEND_PROMPT.md`: especificación antes que código, tokens, springs, Liquid Glass solo en la capa de controles y accesibilidad completa.

Las etiquetas indican de dónde sale cada decisión:
- **[APPLE]**: HIG o documentación de Apple.
- **[DERIVADO]**: cálculo exacto a partir de datos de Apple.
- **[MEDIDO]**: probado en esta Mac.
- **[HEURÍSTICA]**: valor de partida que se puede ajustar.

Todo vive en [`src/renderer/styles/app.css`](src/renderer/styles/app.css) y [`src/renderer/js/springs.js`](src/renderer/js/springs.js).

## 1. Brief

- **Tarea principal:** operar el switcher en vivo, es decir, ver PGM y PVW y conmutar cámaras sin errores.
- **Quién y dónde:** un operador de video en una sala de control, a veces con poca luz, con mouse o trackpad. Mira la pantalla a distancia, durante sesiones largas y con prisa.
- **Plataformas:**
  - Electron 43 (Chromium 150) en macOS, Intel y Apple Silicon;
  - la versión web en navegadores modernos.
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
| Colores semánticos con `light-dark()` y cuatro variantes por color | Cada color propio necesita claro, oscuro y alto contraste [APPLE] |
| Apariencia Automática, Oscura o Clara, que se aplica al instante | Seguir al sistema es la convención [APPLE]. Las apps de medios pueden quedarse en oscuro [APPLE] |
| Barra de la app integrada con la barra de título (semáforos dentro) | Barras unificadas del sistema 26; se ganan 28 px para el video [APPLE] |
| Monitores sin tarjeta, con anillo de tally de 2 px y rótulos dentro de la imagen | El contenido primero. Los rótulos no ocupan una fila aparte [APPLE] |
| Teclas sólidas (contenido), con vidrio solo en barra, pestañas, ajustes y avisos | El vidrio va en la capa funcional, nunca en el contenido [APPLE] |
| Radio exterior 22, padding 12, radio interior 10 | Concentricidad: r interno = r externo − padding [APPLE] |
| `corner-shape: squircle` en tarjetas y teclas, pero no en las pantallas de video | Esquina continua [APPLE]. Un recorte que no es un óvalo sobre el canvas obliga a una máscara en GPU por cuadro [MEDIDO] |
| Encabezados en tipo título ("Program", "Mezclador") y mínimo 10 px | Sin mayúsculas en el sistema 26; mínimo de 10 pt en macOS [APPLE] |
| Texto secundario claro al 78 % en vez del 60 % de Apple | El 60 % da 3,4:1 sobre blanco; el 78 % da 5,2:1 [DERIVADO] |
| Tally PGM `#E9152D` con texto blanco | La variante de alto contraste de Apple da 4,56:1; el rojo normal, solo 3,4:1 [DERIVADO] |
| Sin `backdrop-filter` mientras hay video | Cualquier desenfoque de fondo en pantalla le impide a macOS presentar el video como capa propia [MEDIDO] (sección 8) |
| Flecha en vez de mano sobre los botones | En la Mac la mano es solo para los enlaces [APPLE] |
| Tally sin animación de color | En vivo, el cambio debe verse en el mismo cuadro [APPLE: respuesta inmediata] |

## 3. Tokens

### Color

| Token | Uso | Claro | Oscuro | Alto contraste claro | Alto contraste oscuro |
|---|---|---|---|---|---|
| `--bg` | Fondo de la ventana | `#F2F2F7` | `#000000` | igual | igual |
| `--card` | Consola y barra lateral | `#FFFFFF` | `#1C1C1E` | `#FFFFFF` | `#000000` |
| `--key` | Teclas en reposo | `#ECECF0` | `#2C2C2E` | `#FFFFFF` y borde | `#1C1C1E` y borde |
| `--label` | Texto | `#000000` | `#FFFFFF` | igual | igual |
| `--label-2` | Texto secundario | `rgb(60 60 67 / .78)` | `rgb(235 235 245 / .6)` | `/ .92` | `/ .85` |
| `--red` | PGM, en vivo, silencio | `#FF383C` | `#FF4245` | `#E9152D` | `#FF6165` |
| `--green` | PVW, conectado | `#34C759` | `#30D158` | `#008932` | `#4AD968` |
| `--orange` | Transición, AFV | `#FF8D28` | `#FF9230` | `#C55300` | `#FFA056` |
| `--blue` | Foco, faders | `#0088FF` | `#0091FF` | `#1E6EF4` | `#5CB8FF` |
| `--purple` | OBS | `#CB30E0` | `#DB34F2` | `#B02FC2` | `#EA8DFF` |

Los colores de sistema son los del sistema 26 (HIG, Color). Para texto sobre una tarjeta se usan las variantes `--*-text`, que dan 4,5:1 o más.

Rellenos encendidos y su texto (contraste WCAG 2):

| Relleno | Texto | Contraste |
|---|---|---|
| PGM `#E9152D` | blanco | 4,56:1 (con más contraste, `#C7001B`: 6,1:1) |
| PVW (verde de sistema) | `#052E12` | 7,4:1 o más; blanco en alto contraste claro |
| AUTO (naranja de sistema) | `#2B1700` | 7,7:1 |
| Botón primario `#1E6EF4` | blanco | 4,57:1 |
| Rótulo sobre el video `rgb(0 0 0 / .6)` | blanco | 4,7:1 aunque el video sea blanco |

### Tipografía

Se usa la fuente del sistema (`system-ui`: SF Pro en la Mac), con tamaño óptico automático y el tracking de SF por tamaño [APPLE].

| Estilo (macOS) | Uso |
|---|---|
| Title 2, 17/22, bold | Título de Ajustes |
| Headline, 13/16, semibold | Encabezados de sección, nombre de la app |
| Body, 13/16 | Datos del equipo, listas, campos |
| 14/17 semibold | Teclas de la consola |
| Callout, 12/15 | Estado, rótulos, pestañas, botones de la barra |
| Subheadline, 11/14 | dB, tiras del mezclador |
| Footnote, 10/13 | Entrada de cada tecla (HDMI 1), AFV |

El nombre de cámara del monitor PVW escala de 22 a 40 px.

### Espacio, geometría y materiales

- **Espacio:** escala de 4 px (4, 8, 12, 16, 20, 24) [HEURÍSTICA].
- **Geometría:**
  - Radio exterior 22 para tarjetas y pantallas.
  - Interior de 10 para teclas, tiras y grupos.
  - Cápsulas para botones, pestañas y chips.
  - Alto de los controles 32 px; barra de 52 px.
- **Vidrio** [APPLE + HEURÍSTICA]:
  - relleno `light-dark(rgb(255 255 255 / .72), rgb(255 255 255 / .075))`;
  - borde especular en degradado, más claro arriba;
  - sombra adaptativa;
  - borde exterior oscuro de 0,5 px;
  - brillo radial desde el punto del clic.
- **Vidrio grueso** (diálogo, avisos): con `blur(30px) saturate(180%)` cuando no hay video, y opaco cuando lo hay.

### Movimiento

Springs de Apple con masa 1; las fórmulas reproducen la documentación de `SwiftUI.Spring` [DERIVADO]. Las curvas CSS `linear()` salen de `cssLinear()` en `springs.js`.

| Token | Spring (duración, rebote) | Hasta asentarse | Uso |
|---|---|---|---|
| `--ease-smooth` + `--dur-smooth` | (0,5 s, 0) | 735 ms | Materializar el video, desvanecer el brillo |
| `--ease-snappy` + `--dur-snappy` | (0,5 s, 0,15) | 697 ms | Pulgar del segmentado, entrada de Ajustes y avisos |
| `--dur-micro` | (0,3 s, 0) | 441 ms | Presionar teclas y botones, salida de Ajustes |
| `--dur-micro-snappy` | (0,3 s, 0,15) | 419 ms | Soltar teclas, perillas |
| `SpringValue` (JS) | (0,3 s, 0) | — | T-Bar cuando su posición cambia sin arrastrarla |

## 4. Mapa de capas

| Capa | Elementos | Material |
|---|---|---|
| Contenido | Monitores, teclas, mezclador, listas, datos del equipo | Sólido, color semántico |
| Funcional fija | Barra (estado, salidas de OBS, Sync, Ajustes), pestañas | Vidrio sin muestrear el fondo |
| Funcional sobre el video | Rótulo PGM/PVW, "En vivo" | Vidrio Clear: atenuación del 60 %, sin desenfoque |
| Funcional temporal | Ajustes, avisos | Vidrio grueso; opaco mientras hay video |
| Transitoria | Manija de la T-Bar, perillas de los faders | Se elevan al arrastrarlas: escala y sombra |

Nunca hay vidrio sobre vidrio ni vidrio en el contenido. El tinte solo marca estados: Live/Rec encendidos en rojo, Vcam en azul.

## 5. Estados de los componentes

| Componente | Estados |
|---|---|
| Tecla de cámara | Reposo, hover, presionada (escala 0,97), PGM (rojo con halo), PVW (verde con halo), sin conexión (atenuada) |
| Tecla del panel | Reposo, luz roja, verde, amarilla, azul o blanca (tinte + borde), parpadeo (borde fijo con Reducir movimiento) |
| CUT / AUTO / FTB | Reposo, CUT encendido (rojo), AUTO en curso (naranja), FTB activo (tinte rojo que parpadea) |
| T-Bar | En reposo, arrastrando (manija elevada), a mitad (anillo naranja), cambio sin arrastre, por ejemplo al reconectar (spring) |
| Monitor PGM | Esperando el PC500, STREAM apagado, recibiendo, en vivo (video + "En vivo"), Fade to black, sin dato del equipo |
| Estado en la barra | Buscando (punto naranja que late), conectado (verde), revisar (rojo) |
| Ajustes | Cerrado, abriéndose desde el botón, abierto, buscando en la red, resultados, error |
| Aviso | Oculto, entrando, visible 4,5 s, saliendo por el mismo camino |

## 6. Especificación de movimiento

| Interacción | Disparador | Propiedades | Spring | Interrupción | Reducir movimiento |
|---|---|---|---|---|---|
| Presionar una tecla | Al bajar el botón | Escala 1 → 0,97 y color | micro / micro-snappy al soltar | Se invierte desde donde está | Solo color |
| Tally | Estado del equipo | Color y halo | Ninguno: mismo cuadro | — | Igual |
| Pestañas | Clic o flechas | Pulgar: `translate` | snappy | Retoma desde la posición actual | Salta |
| Abrir Ajustes | Clic | Opacidad, escala 0,94 → 1, `translate` −8 px, desde el botón | snappy (opacidad 200 ms) | Cerrar invierte el camino | Solo opacidad |
| Cerrar Ajustes | Clic, Esc | Lo mismo, al revés | micro, sin rebote | — | Solo opacidad |
| Aviso | Mensaje nuevo | Opacidad, escala, `translate` −10 px | snappy; sale con micro | Un aviso nuevo lo reabre | Solo opacidad |
| T-Bar arrastrada | Puntero | Posición 1:1 | Ninguno | — | Igual |
| T-Bar que cambia sin arrastre | Estado (al reconectar) | Posición | `SpringValue` (0,3 s, 0), conserva la velocidad | Se redirige sin saltos | Salta |
| Manija y perillas | Al arrastrar | Escala 1,08 o 1,12 y sombra | micro / micro-snappy | — | Solo sombra |
| Video que aparece | Primer cuadro | Desenfoque 12 px → 0 y opacidad | smooth; al terminar no queda filtro | — | Solo opacidad (200 ms) |
| Brillo del vidrio | Al presionar | Degradado radial en el punto del clic | 80 ms al entrar, smooth al salir | — | Igual (no es desplazamiento) |

## 7. Accesibilidad

- **Reducir movimiento:** `--motion: 0` anula escalas y desplazamientos y quedan los fundidos. Lo que parpadea muestra un borde punteado fijo.
- **Reducir transparencia:** el vidrio pasa a ser sólido.
- **Más contraste:**
  - variantes de alto contraste del HIG;
  - superficies blancas o negras, teclas con borde y rótulos sobre el video con borde blanco.
- **Colores forzados (Windows):** el tally y los rojos de estado conservan su color.
- **Teclado:**
  - anillo de foco de 3 px en todo;
  - pestañas con el patrón ARIA (flechas, Inicio y Fin, solo la elegida en el orden del tabulador);
  - teclas 1 a 5 para el Preview;
  - CUT y AUTO sin atajo a propósito.
- **Lector de pantalla:**
  - buses y capas agrupados con su nombre;
  - `aria-pressed` en teclas, salidas y Sync;
  - la T-Bar es un `slider` con su valor;
  - los avisos están en una región `status`.
- **Contraste:** todo texto con significado da 4,5:1 o más en las cuatro variantes (calculado con WCAG 2).
- **Zoom:** Cmd + agranda todo. Por debajo de 1100 px de ancho, la consola pasa a una columna con desplazamiento.

## 8. Rendimiento

Medido con `node scripts/bench-video.mjs` en el iMac de desarrollo, con video 1080p60:

| Prueba | 1.3.0 | Primer intento con vidrio | 1.4.0 (código fuente) | 1.4.0 (app empaquetada) |
|---|---|---|---|---|
| Latencia de punta a punta (mediana / p95) | 117 / 225 ms | 3440 / 7127 ms | **108 / 114 ms** | **117 / 167 ms** |
| Cuadros perdidos | 0 % | 20,7 % | **0 %** | **0 %** |
| Ventana | 60 cuadros/s | 46,5 cuadros/s, 13,6 % de tirones | **60 cuadros/s, 0 %** | **60 cuadros/s, 0 %** |
| Clic → Preview pintado | 32 ms | 41 ms | **32 ms** | **32 ms** |
| CPU total (GPU) | 51 % (31 %) | 44 % (32 %) | **39 % (23 %)** | **46 % (29 %)** |
| Con Ajustes abierto sobre el video | — | — | **108 ms, 0 %, 60 cuadros/s** | — |

Entre una corrida y otra varía unos 10 ms y unos puntos de CPU. Lo que importa: el rediseño no agrega latencia ni pierde cuadros, y gasta menos CPU que la 1.3.0.

**Qué pasó con el vidrio:**
- Con `backdrop-filter` en la barra y en los rótulos, macOS ya no puede presentar el video como una capa propia, y la GPU compone toda la ventana 5K en cada cuadro.
- Ni siquiera los dos chips chicos sobre el video, solo con desenfoque, son gratis: la latencia sube de 133 a 365 ms y la GPU de 33 a 43 %.

**Por eso:**
- El vidrio fijo no muestrea el fondo. Sobre un fondo liso se ve igual.
- El desenfoque real queda para Ajustes y los avisos, y solo mientras no hay video.
- La refracción con mapa SVG (Apéndice A.3) se probó y se dejó afuera: necesita `backdrop-filter`.

## 9. Verificación

- `npm test`: 96 pruebas, entre ellas las fórmulas de los springs contra la documentación de Apple y el ajuste de apariencia.
- `npm run smoke`, `npm run smoke:web` (también en modo demo) y `npm run smoke:video`.
- `npm run smoke:ui`, con eventos de verdad por el protocolo de depuración:
  - la T-Bar sigue al puntero 1:1 aunque esté elevada, el PC500 recibe su posición y se queda donde se suelta;
  - las pestañas se recorren con las flechas;
  - Ajustes nace de su botón y Esc lo cierra;
  - la apariencia se aplica al instante;
  - la tecla 3 marca CAM 3 con `aria-pressed`.
- `node scripts/screenshots.mjs` captura 14 estados:
  - cada pestaña, Ajustes, sin conexión;
  - tamaño mínimo, 1920×1080 y 5K;
  - claro, claro con Ajustes;
  - más contraste en oscuro y en claro;
  - transparencia reducida.

  Las preferencias del sistema se simulan con `TENVEO_SMOKE_MEDIA`.
- `node scripts/bench-video.mjs` y `--ajustes`.

## 10. Autoevaluación (rúbrica del prompt, de 0 a 5)

| Dimensión | Nota | Notas |
|---|---|---|
| Tarea principal y jerarquía | 5 | PGM y PVW dominan; el tally se lee a distancia |
| Fidelidad a la plataforma | 4 | Barra unificada, SF, colores de sistema, segmentados, flecha. El vidrio fijo no desenfoca (medido) |
| Geometría y layout | 5 | Concéntrico, escala de 4, squircle; probado de 1180×740 a 5K |
| Tipografía | 4 | Estilos de macOS y tracking de SF. macOS no tiene Dynamic Type; el zoom funciona |
| Color y materiales | 4 | Semántico, cuatro variantes, vidrio solo en la capa funcional |
| Física del movimiento | 4 | Springs en tokens; la T-Bar se redirige conservando la velocidad. Sin inercia en la T-Bar a propósito: nada sale al aire por un impulso |
| Morphing y coreografía | 4 | Pulgar que se desliza, Ajustes desde su botón, avisos por el mismo camino, video que se materializa |
| Simbiosis | 4 | Ventana integrada con los semáforos, teclas iluminadas como el panel, brillo desde el clic. Sin háptica (web) |
| Accesibilidad | 4 | Movimiento, transparencia, contraste, colores forzados, teclado y ARIA. Falta una pasada con VoiceOver |
| Rendimiento | 5 | Mejor que antes del rediseño en latencia y CPU |
| Estados y contenido extremo | 4 | Sin conexión, sin dato, sin video, demo, navegador, errores, ventana mínima |
| Calidad del código | 4 | Tokens y componentes; quedan algunos px fijos de componentes |

## 11. Pendiente de validar

- Valores [HEURÍSTICA] en uso real:
  - opacidad del vidrio;
  - alto de las teclas (`clamp(52px, 8,4vh, 84px)`);
  - anillo de tally de 2 px;
  - spring de la T-Bar (0,3 s).
- Una pasada con VoiceOver y con el teclado completo.
- Apariencia clara en una sala con luz de día.
- En una Mac con Apple Silicon (Metal moderno), quizás el desenfoque sobre el video sea gratis: medir con `bench-video` antes de cambiar la regla.

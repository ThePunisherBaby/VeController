# Plan de diseño 2: "hecho en Cupertino"

**Objetivo:** que Tenveo Studio parezca diseñado en Apple Park, aplicando `APPLE_FRONTEND_PROMPT.md` completo, no solo sus colores. Versión 1.5.0, 18 de octubre de 2026.

Este plan sale de releer el prompt sección por sección contra la 1.4.0, más tu crítica: "metiste unos efectos feísimos, como si algunos botones tuvieran una luz que les da desde el exterior". El sistema de diseño vigente está en [DISENO.md](DISENO.md).

## 0. Diagnóstico de la 1.4.0 contra el prompt

| Sección del prompt | Qué hace la 1.4.0 | Qué está mal | Arreglo |
|---|---|---|---|
| §4.5 y §5.2 (iOS 7: jerarquía con capas, "no con bordes, biseles y degradados") | Halo de color bajo las teclas PGM, PVW y AUTO; borde especular en degradado en las cápsulas; bisel claro arriba de cada tecla; perilla de la T-Bar con degradado y anillo naranja; brillo radial al presionar | Es la "luz desde afuera" que notaste: ornamento, no jerarquía | Superficies planas. La profundidad sale solo de la claridad de la superficie y de una sombra suave en lo que flota |
| §9.1 y anti-patrón 19 | Le llama "vidrio" a cápsulas translúcidas sin lente | Es glassmorphism disfrazado | Ser honesto: material plano en los controles fijos y vidrio de verdad solo donde puede serlo (Ajustes y avisos sin video) |
| §6.1, líneas finas | Separadores y bordes de 1 px (2 píxeles físicos en Retina) | Líneas pesadas; Apple usa un píxel físico | Líneas de 0,5 px en pantallas 2x |
| §6.7 y anti-patrón 28 | El grupo Live / Rec / Vcam mezcla ícono y texto con fondo compartido | El HIG pide no mezclarlos | Segmentos solo de texto; íconos solo donde no son ambiguos |
| §6.2, objetivos | "M" de 24 px de alto; segmentos de 26 px | El mínimo recomendado en macOS es 28 | Llevarlos a 28 px |
| §7.4, elegir el spring | Ajustes y avisos con rebote 0,15 | Un toque sin impulso lleva rebote 0 | smooth o large, sin rebote |
| §7.6, rubber band | La T-Bar frena en seco en los extremos | Anti-patrón 9 | Resistencia elástica pasado el extremo (solo visual; el valor enviado no pasa de 0 a 255) y vuelta con spring y velocidad |
| §8 y §12 fase 5, momento firma | Un aviso genérico arriba | No hay ninguna interacción memorable | **La isla**: el estado de la barra se transforma en el aviso, como la Dynamic Island |
| §8.6, morph de contenido | La latencia y los tiempos cambian de golpe | Los contadores de Apple ruedan | Rodillo de dígitos (numericText) |
| §11 y convenciones de la Mac | Menú por defecto de Electron (con Recargar y DevTools); Ajustes sin ⌘,; ícono de Electron | No parece una app de Mac | Menú nativo en español, Ajustes… ⌘,, ventana Acerca de e ícono en la grilla de macOS |
| §6.2, formularios del sistema 26 | Ajustes con campos apilados y una casilla | No se parece a Ajustes del Sistema | Grupos de filas (etiqueta a la izquierda, control a la derecha), un interruptor en lugar de la casilla y Apariencia con miniaturas, como en macOS |
| §7.7, coreografía | El panel lateral cambia de golpe | El contenido debería seguir al contenedor | Fundido con 6 px de desplazamiento |
| §2 paso 5, web a 390×844 | Nunca se revisó en angosto | Sin verificar | Capturar y corregir |
| §13.4 | `will-change` permanente en la manija | Debe ser solo durante la interacción | Moverlo al arrastre |
| §12 fase 8, cámara lenta | No se revisó cuadro a cuadro | — | Capturas de la isla a velocidad reducida |

## 1. Exploración 10 → 3 → 1 del momento firma

Cada concepto se puntuó de 1 a 5 en claridad para la tarea, encaje con la plataforma, viabilidad, valor del movimiento, riesgo de accesibilidad (invertido) y costo de GPU con video (invertido).

| # | Concepto | Puntaje |
|---|---|---|
| 1 | **Isla de estado:** la cápsula PC500/OBS del centro de la barra se expande y se convierte en el aviso, y vuelve | **27** |
| 2 | El botón de Ajustes se transforma en la hoja (control → hoja) | 24 |
| 3 | La luz roja "viaja" de la tecla PVW a la PGM al hacer CUT (metaball) | 17 |
| 4 | T-Bar con física completa: rubber band, elevarse, estirarse con la velocidad | 23 |
| 5 | Doble clic en el PGM: transición zoom a pantalla completa | 19 |
| 6 | Rodillo de dígitos en latencia y tiempos | 22 |
| 7 | El pulgar del segmentado se transforma en el contenido del panel | 16 |
| 8 | Vúmetros con caída física y pico retenido | 15 (el PC500 no manda niveles) |
| 9 | Barrido de "AL AIRE" sobre la ventana | 12 (distrae en vivo) |
| 10 | La barra se minimiza en pantalla completa | 14 |

- **Los 3 finalistas:** 1, 2 y 4.
- **El elegido: 1, la isla.**
  - Es la lección de la Dynamic Island (§4.9): la interfaz nace de un elemento que ya existe, que la barra integrada con los semáforos ya invita.
  - Su movimiento es un phase morph con canales desfasados (§8.4).
  - Reemplaza un componente genérico, en vez de sumar uno.
  - No cuesta nada en reposo ni usa `backdrop-filter`.
- **El resto, sobrio:** de 4 entra la parte barata y segura (rubber band y velocidad), de 6 el rodillo de los contadores, y Ajustes se queda con su aparición desde el botón, sin rebote.

## 2. Especificación de la isla

**Estados:**
```
compacta ──aviso──▶ expandiéndose ──▶ mensaje ──4,5 s──▶ contrayéndose ──▶ compacta
   ▲                    │  ▲             │  ▲                               │
   │                    └──┘ aviso nuevo │  └ puntero encima: pausa         │
   └──────────── clic en el mensaje ─────┘ (contrae ya)  ◀── aviso nuevo ───┘
```

**Movimiento** (plantilla §8.9; las dos medidas son SpringValue redirigibles, a 60 Hz):

| Canal | Desde | Hasta | Spring (d, b) | Desfase | Derivado de | Reducir movimiento |
|---|---|---|---|---|---|---|
| Ancho (al expandir) | ancho compacto | ancho del mensaje (≤ 520 px) | 0,42, 0,18 | lidera | — | cambio inmediato |
| Alto (al expandir) | 32 px | alto del mensaje | 0,50, 0,12 | sigue | — | cambio inmediato |
| Alto (al contraer) | alto del mensaje | 32 px | 0,40, 0 | lidera | — | cambio inmediato |
| Ancho (al contraer) | ancho del mensaje | ancho compacto | 0,50, 0 | sigue | — | cambio inmediato |
| Radio | 16 px | ≤ 22 px | — | — | `min(22, alto/2)` en cada cuadro | igual |
| Estado (sale) | opacidad 1, escala 1 | 0, 0,96 | smooth 0,3 | primer 30 % | — | fundido |
| Mensaje (entra) | opacidad 0, escala 0,96 | 1, 1 | smooth 0,3 | último 60 % | — | fundido |

**Geometría:** anclada arriba al centro de la barra, crece hacia abajo sobre los monitores, nunca tapa los semáforos y se interrumpe en cualquier cuadro.

**Material:**
- En claro, negra con texto blanco, como la isla del iPhone.
- En oscuro, `#1C1C1E` con línea fina, para que se vea sobre el negro.
- Sin `backdrop-filter`.

**Accesibilidad:** el mensaje vive en una región `status` (`aria-live="polite"`) y el ícono acompaña al texto (información, listo, error), nunca lo reemplaza. Con más contraste lleva borde.

## 3. Cambios

**A. Quitar los efectos de "luz desde afuera"**
- [x] Halos de color bajo las teclas PGM, PVW y AUTO.
- [x] Bordes especulares en degradado de cápsulas, segmentado, Ajustes y rótulos.
- [x] Bisel claro de las teclas.
- [x] Brillo radial al presionar: se cambia por un relleno más oscuro.
- [x] Degradado y anillo naranja de la perilla de la T-Bar.
- [x] Brillo de la marca y del punto "En vivo".
- [x] Anillo interno oscuro de las pantallas.

**B. Barra:**
- [x] Marca a la izquierda, isla al centro y, a la derecha, salidas de OBS (solo texto), Sync y Ajustes.
- [x] Controles de 34 px con segmentos de 28 px.
- [x] Material plano: relleno y línea fina.

**C. Monitores:** rótulos más finos (24 px, línea fina en vez de borde especular) y anillo de tally simple de 2 px.

**D. Consola y T-Bar:**
- [x] Luces del panel como relleno teñido y texto de color, sin contorno.
- [x] Tally sólido sin halo.
- [x] Separadores finos.
- [x] T-Bar con perilla plana, elevación (escala y sombra) solo al arrastrar, rubber band en los extremos y `will-change` solo durante el arrastre.

**E. Barra lateral:**
- [x] Pulgar plano.
- [x] "M" de 28 px.
- [x] Perillas planas.
- [x] Panel que entra con fundido.
- [x] Rodillo de dígitos en los tiempos.

**F. Ajustes** como Ajustes del Sistema:
- [x] Grupos de filas.
- [x] Interruptor para "Quitar la contraseña guardada".
- [x] Apariencia con miniaturas (Automática, Oscura, Clara).
- [x] Spring sin rebote.

**G. Plataforma:**
- [x] Menú nativo en español: Tenveo Studio, Edición, Visualización, Ventana y Ayuda.
- [x] Ajustes… con ⌘,.
- [x] Acerca de Tenveo Studio.
- [x] Ícono de la app en la grilla de macOS (`build/icon.icns`), también como marca de la barra.

**H. Web en angosto:** capturas a 390×844 en claro y oscuro, y corregir lo que se rompa.

**I. Documentación:** DISENO.md al día (decisiones, tokens, isla, rúbrica), DOCUMENTACION, README, PENDIENTES (el ícono deja de estar pendiente) y LEEME.

## 4. Resultado (1.5.0)

Todo lo de la sección 3 quedó hecho. Lo que salió de verificar:
- **La isla en cámara lenta:** al cerrarse, el mensaje y el estado se cruzaban al mismo tiempo (0,75 y 0,25 de opacidad). Ahora el que sale se va primero.
- **Rendimiento:** el rodillo de dígitos en la latencia de la isla rodaba cada segundo y subía la GPU unos 5 puntos. Quedó solo en los tiempos de Equipo. En corridas alternadas, la 1.5.0 rinde igual que la 1.4.0: 123 contra 122 ms de latencia y 46–48 % de CPU.
- **Banda elástica:** con 60 la manija se estiraba demasiado para un control chico. Quedó en 36.
- **El prompt tiene una cifra redondeada:** dice 172,6 para la banda elástica con x = 400, y la fórmula da 172,549.

Detalle y rúbrica en [DISENO.md](DISENO.md).

## 5. Verificación

- `npm test` y las pruebas de humo: app, web, demo, video y `smoke:ui`. Esta última suma la isla (se expande, se contrae, se interrumpe) y el interruptor.
- Capturas:
  - los 14 estados de antes;
  - la isla abierta en oscuro y en claro;
  - la web a 390×844.
- Isla en cámara lenta: cuadros al 10 % de velocidad (escala de tiempo de depuración) para ver que el radio no salte y que nunca haya dos contenidos opacos a la vez.
- `bench-video` y `bench-video --ajustes`: sin pérdida contra la 1.4.0.
- Rúbrica §17: todo 4 o más, y escrita en DISENO.md.

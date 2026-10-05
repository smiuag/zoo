# Cadena de impresión y arte de las cartas

Todo lo que genera las cartas impresas vive en esta carpeta. El intérprete es `/c/Python310/python`
(tiene Pillow, numpy, scipy y PyMuPDF). Los datos de las cartas salen del motor:
`packages/engine/src/cards/data/*.json`.

## Regenerar todo (orden)

```bash
/c/Python310/python img/_work/compose_all.py        # cartas ES  -> img/cards
/c/Python310/python img/_work/compose_all_en.py     # cartas EN  -> img/cards_en
/c/Python310/python img/_work/build_pdf.py          # hoja de referencia ES -> pdf/es/cartas_zoo.pdf
/c/Python310/python img/_work/build_pdf_en.py       # hoja de referencia EN -> pdf/en/cartas_zoo_en.pdf
/c/Python310/python img/_work/build_deck_pdf.py     # mazo de impresion ES -> pdf/es/mazo_impresion.pdf
/c/Python310/python img/_work/build_deck_pdf_en.py  # mazo de impresion EN -> pdf/en/mazo_impresion_en.pdf
```

- "Regenerar los PDFs" son siempre los cuatro.
- La **hoja de referencia** (`cartas_zoo*.pdf`) enseña cada carta como queda terminada: sin sangrado ni
  marcas de corte, con la esquina redondeada y separadas por un hueco blanco (`make_reference_page` en
  `print_layout.py`). No sirve para recortar: para eso están los mazos de impresión, que no cambian.
- **Todos los PDF van a `pdf/<idioma>/`** en la raíz del repo (`pdf/es`, `pdf/en`), nunca sueltos en `img/`.
  Los scripts sacan la ruta de `pdf_paths.py` (`pdf_path(idioma, nombre)`); las pruebas y comparativas van a
  `pdf/<idioma>/pruebas/`. Los nombres no cambian (los ingleses siguen acabando en `_en`). La capa sin fondo
  del reglamento es un intermedio y se queda en `img/_work/_instrucciones[_en]_capa.pdf`.
  `pdf/es/hoja_puntuacion.pdf` no tiene script generador.
- Si cambia el DISEÑO de las cartas, además de los cuatro PDFs hay que rehacer lo que las enseña: el
  reglamento (`build_instrucciones.py`, `build_instrucciones_librillo.py`, `build_instrucciones_a7.py`,
  con `en` y sus variantes `--fondo`, `--capa`, `--pergamino`; la página "Las cartas de animal" lleva una
  carta anotada cuyas marcas se colocan a mano en `instrucciones[_en].html`) y la caja (`build_caja.py`).
  El escáner de la web (`build_scan_assets.py`) también sale de `img/cards`.
- El mazo de impresión debe sumar un **múltiplo de 18** cartas. Se cuadra solo con Plata, Oro y
  Platino (`COUNTS` en los DOS `build_deck_pdf*.py`); Bronce (49) y Perezoso (21) no se tocan.
  Estado actual: 378 cartas con Plata 16, Oro 11, Platino 8.
- Tamaño de carta 63,5 x 88,9 mm (750 x 1050 px a 300 ppp), páginas A4, 3x3 por página.
- Marcas de corte (`print_layout.py`): una cruz negra con alma blanca en cada esquina del corte real. Sale 34 px
  hacia el sangrado y ENTRA 26 px en la carta, sin hueco. Así las cartas de enmedio conservan su referencia
  después del primer corte, y la parte que entra desaparece al redondear la esquina (radio ~46 px a este
  tamaño). Antes eran trazos magenta solo por fuera, que contrastaban poco sobre el sangrado marrón.
- El reverso (`compose_back.py`, `BORDER_BOX = (168, 46, 858, 961)`) va centrado: 3,05 mm arriba y abajo.
- Si un archivo de `img/` está abierto en un visor, Windows bloquea la escritura ("Invalid argument"):
  escribir a una carpeta temporal y copiar encima con `cp -f`.

## Ediciones: clásica, aprendizaje y completa

| | Clásica | Aprendizaje | Completa |
|---|---|---|---|
| Especies | 33 | mismas 33 (mercado limitado a coste ≤4) | 33 + especies extra (perro, gato, diplodocus, tiranosaurio, terodáctilo, mosasaurio, iguana, hámster, cerdo, gallina, nutria, pez dorado, plesiosaurio, pteranodon, colibrí, avestruz, oca) |
| Tipos | terrestre, volador, acuático | igual que clásica | + mascota (`pet`) y dinosaurio (`dinosaur`) |
| Dónde se ve | impresión y web publicada | solo web publicada | solo web publicada (desde 2026-09-21; antes solo `localhost`) |
| Carpetas | `img/cards`, `img/cards_en`, los 4 PDFs | igual que clásica (mismo mazo) | `img/cards_completa`, `img/cards_completa_en` (sin PDF) |

- La clásica es **la única que se imprime**. De la completa no debe verse nada al imprimir (sigue sin PDF), pero sí está disponible como edición jugable en la web publicada.
- Para componer la completa: `ZOO_EDITION=full /c/Python310/python img/_work/compose_all.py` (y `_en`).
- Las cartas solo-completa llevan `"edition": "full"` en su JSON. En la clásica, `load_cards()` las omite y
  quita `pet`/`dinosaur` de las demás (pez de colores, periquito y cocodrilo vuelven a ser lo de siempre).
- Motor: `createGame(..., { edition })`, por defecto `'classic'`. `ANIMAL_SPECIES` sigue siendo la lista
  clásica (los bots RL dependen de ella) y `FULL_EDITION_EXTRA_SPECIES` las 6 extra. `mintInstance` quita
  los tipos extra en partidas clásicas.
- Web: el selector "Aprendizaje / Clásica / Completa" (`apps/web/src/lib/edition.ts`) está disponible en
  cualquier sitio, incluida la web publicada — no hay restricción por host.
- Reglas de las cartas de la completa:
  - **Perro** (3, 3 PV, terrestre-mascota): al jugarlo se puede dejar sobre la mesa (`player.table`) en vez de
    ir al descarte. Sigue puntuando, deja de circular y ningún efecto lo alcanza. Efecto `mayStayOnTable`,
    acción `playCard` con `keepOnTable`.
  - **Gato** (2, 2 PV, terrestre-mascota): si hay que ELIMINAR un terrestre, se entrega el gato y va al
    descarte. No protege del Cocodrilo (ese texto dice "no volador" y ocurre al final de la partida).
  - **Tiranosaurio / Terodáctilo / Mosasaurio** (7, 10 PV): +4 bellotas y cada OPONENTE (nunca quien lo
    juega) elimina de su mano un terrestre / volador / acuático. Efecto `eachOpponentDestroysAnimalFromHand`.
  - **Diplodocus** (10, 15 PV, terrestre-acuático-dinosaurio), sin habilidad.
  - Pez de colores y periquito ganan mascota; cocodrilo gana dinosaurio.
- Ilustraciones del modo "imagen" de la app para las 6 cartas nuevas: `web_card_art.py` convierte los JPG
  planos de `img/web/` (Perro, gato, diplodocus, tiranosaurio, terodactilo, mosasaurus) en PNG transparentes
  de 700 px recortados al sujeto, en `apps/web/public/cards/<id>.png`. Quita el fondo liso y la sombra del
  suelo por inundación desde los bordes. `img/web/triceratops.jpg` existe pero no tiene carta.
- Los bots RL de la completa ya están entrenados (pesos `weights-full*.json` en
  `packages/engine/src/bots/rl/`); si se añade una especie o habilidad nueva hay que reentrenarlos
  (ver el `CLAUDE.md` de la raíz, sección "Bots RL").
- OJO con dos fotos: `img/tiranosaurios.jpg` muestra un triceratops y `img/triceratops.jpg` muestra el
  tiranosaurio (562x463, poca resolución). `SPECIES_PHOTO` usa la segunda.

## Diseño oficial de las cartas de animal (pergamino de color y tipo escrito)

Desde 2026-10-05. Lo compone `compose_card_pergamino.py` (`compose_official`), llamado desde
`compose_all.py` y `compose_all_en.py`. Para probar una carta suelta:
`/c/Python310/python img/_work/compose_card_pergamino.py toucan [en]` -> `img/templates/pruebas/pergamino/`.

- **Marco `img/template5.png`**: el marco de siempre (template3, ventana de esquinas redondeadas) con el
  nombre en un pergamino enrollado en vez del tablón de madera. El pergamino va centrado entre el borde
  inferior de la ventana y el panel de texto (misma distancia arriba que abajo) sobre un tablero de madera
  del tono del marco.
- **Color = hábitats de la carta**, en el pergamino del nombre Y en el panel de texto: tierra arena clara,
  agua azul claro, aire blanco apenas cálido (a medio camino entre blanco puro y blanco roto). Con dos hábitats, mitad y mitad (tierra|agua, tierra|aire, agua|aire) con
  una mezcla de ancho intermedio en el centro (`BLEND = 90`); con los tres, agua|tierra|aire. Tonos, panel
  teñido y ancho de mezcla los eligió el usuario el 2026-10-05 (hojas de prueba en
  `img/templates/pruebas/template5/`); se cambian en `build_scroll_templates.py` (`TIERRA`, `AGUA`, `AIRE`, `BLEND`,
  `SCROLL_PANEL`).
- **Tipo escrito** bajo el nombre ("Terrestre - Acuático"), sin iconos. Los hábitats se listan **en el
  mismo orden que los colores del pergamino**, de izquierda a derecha: por eso es "Acuático - Volador" y
  "Acuático - Terrestre - Volador" (`SCROLL_COLOR_ORDER`). Una carta con los tres hábitats pondría
  "Todoterreno" (en inglés siempre se listan); hoy ninguna carta clásica los tiene (el Albatros es acuático y volador desde 2026-10-05).
- **Nombre recto y en marrón oscuro** (`HEADING_INK`): el pergamino es plano y claro.
- **Texto centrado en vertical** entre el pie de la etiqueta de tipo y la última línea útil del panel
  (`PANEL_BODY_BOX`, y=657 a y=816 del diseño; el panel acaba en 828). Se centra la TINTA real del bloque,
  no la caja de la fuente. Si no cabe con 10 px de aire arriba y abajo, baja la letra.
- El pez de colores y el periquito cuentan como 2, pero ya no llevan icono doble: solo lo dice su texto.
- Medidas del marco (615x878) en `compose_card.py`: `ILLUSTRATION_BOX`, `COST_BADGE = (83, 109)`,
  `PV_BADGE = (526, 90)`, `TITLE_BOX`, `TYPE_LINE_POINT = (307, 639)`.
- `build_card_base` recorta el marco de papel de algunas ilustraciones (`PHOTO_INSET`).
- **Las monedas** (ver más abajo) llevan el mismo marco, sin pergamino: son cartas ya terminadas que se
  montan sobre su propia plantilla (`TEMPLATE_FILES["coin"]`, ruta absoluta a `sangrado/medias/monedas.png`).

### Diseño anterior (2026-09-20 a 2026-10-05): iconos de tipo

`compose_card_iconos.py`: redondos de madera en vez del texto de tipo (hoja = terrestre, nube = volador,
gota = acuático; icono doble en pez de colores y periquito), tablón de madera para todas y nombre en
blanco. Va sobre el marco anterior (template3): `use_previous_template()` devuelve `compose_card.py` a
esas medidas, y hay que llamarla antes de componer nada con ese módulo. Los iconos los dibuja
`type_icons.py` (`img/iconos_tipo/`, y `img/iconos_tipo_completa/` para mascota y dinosaurio); ya no
salen en las cartas ni en el reglamento.

## Cartas de moneda (bellotas)

Las cuatro monedas (1 panda rojo, 2 perezoso, 3 ardilla, 5 koala) no llevan título ni texto: la ilustración
ocupa toda la carta dentro del mismo marco que los animales.

```bash
S=<carpeta temporal>; D=img/templates/pruebas/candidata_monedas
COINS_OUT=$S /c/Python310/python img/_work/build_coins_from_4en1.py $S      # -> monedaN_fondo.jpg
# por moneda (N coste pv):  1 - 0   |   2 3 1   |   3 5 2   |   5 7 3
/c/Python310/python img/_work/compose_coin_from_frame.py $D/intento_arreglado.png img/templates/medias/monedas.png img/monedaN_fondo.jpg $S/ciN.png <coste> <pv> 1.3
/c/Python310/python img/_work/round_corners.py $S/ciN.png $S/crN.png       # -> copiar a $D y a img/coins/monedaN_marco_intento.png
/c/Python310/python img/_work/add_bleed.py $S/crN.png $S/cbN.png           # -> img/coins/sangrado/monedaN_marco_intento.png
```

Después, la cadena normal de cartas y PDFs.

- `build_coins_from_4en1.py` recorta cada animal de `img/coins/4en1.jpeg` (rejilla 2x2) y lo monta sobre
  `img/coins/fondoCoin.jpg`, todos a la misma escala (`SCALE = 1.86`), con los pies en `FEET_Y = 692`.
  Sin `COINS_OUT` escribe directamente en `img/`.
- El recorte combina, por cuadrante: un polígono manual (`POLYS`, ensanchado 6 px solo en la parte alta),
  exclusión del verde y del "cielo" pálido del original, y `strip_fringe`, que quita el fleco claro del
  borde SOLO si se alcanza desde fuera sin cruzar una línea oscura del dibujo.
- Tablas de ajuste manual, en coordenadas del cuadrante: `KEEP` (pelo claro sin contorno que no se debe
  comer: orejas y cola del panda, oreja y bellota del koala, mechón y cola de la ardilla, pañuelos),
  `FORCE` (zonas del color del fondo que hay que incluir sí o sí: picos de los pañuelos, plantas de los
  pies), `EXCLUDE` y `EXCLUDE_PALE` (trozos de fondo que el polígono abarca), `ADJUST` (desplazamiento).
- La ardilla va 24 px a la derecha (`ADJUST[3]`) para que la cola tape una planta roja del fondo. Tapar esa
  planta retocando el fondo se probó de tres formas y todas se notaban.
- `compose_coin_from_frame.py` conserva del marco solo las hojas a 36 px del hueco (`RIM`); sin eso se
  colaba follaje de la ilustración original del marco y parecían costuras.
- `round_corners.py`: margen 12,5 px y radio 38 px a 615 de ancho, relleno del color de la banda.
  `add_bleed.py`: 10 mm de sangrado (98 px) del color de la banda.

### Lecciones al recortar siluetas

1. Antes de dar un recorte por bueno, dibujar el contorno de la máscara sobre el ORIGINAL ampliado, con
   cuadrícula de coordenadas. Casi todos los fallos (orejas, patas, colas, picos de pañuelo comidos) se
   veían así a la primera y no en el montaje final.
2. Un filtro solo por color no distingue el brillo del fondo del pelo claro o de los brillos dorados del
   rabito de la bellota. Hace falta conectividad: los contornos del dibujo hacen de barrera.
3. Ante un "halo", comprobar primero si es el propio fondo: componer una carta solo con el fondo y restarla.
4. Si el usuario dice que una zona es parte del animal, mirar el original sin máscaras antes de excluir
   nada: dos exclusiones puestas "para quitar fondo" estaban quitando cola de la ardilla.

## Plantillas

- `build_template5.py` compone `img/template5.png`: quita el tablón de `img/template3.png`, repinta su hueco
  con la madera del listón de la ventana (tono `BOARD_TONE`) y coloca encima el pergamino recortado de
  `img/template4.jpg`, limpio de hojas y lianas. **El usuario retoca `template5.png` a mano después**: el
  script se niega a sobrescribirlo sin `--force`; para probar cambios, `T5_OUT=otra_ruta`.
- `build_scroll_templates.py` genera a partir de `template5.png` las 8 plantillas por carpeta (`tierra`,
  `agua`, `aire`, `monedas`, las tres mixtas y la triple), en `img/templates/template5` y, con 98 px de
  sangrado, en `img/templates/sangrado/template5`. Tiñe el pergamino del nombre y el panel de texto; como son
  casi blancos, no se cambia el tono sino que se remapea su luminosidad entre un color oscuro y uno claro
  (`duotone`). Deja `scroll_zona_control.png` con la zona repintada en magenta.
- `compose_card.py` usa `img/templates/sangrado/template5` y recorta su sangrado de 98 a 30 px para que
  quepan 9 cartas por A4. La ventana de la ilustración se detecta como la pieza conexa clara que contiene
  su centro. Si cambian las plantillas, borrar `template_alpha_cache/`.
- Marcos anteriores, ya sin uso salvo lo indicado: `img/templates/template4` (primera prueba de pergamino,
  sobre `template4.jpg`, oficial unas horas el 2026-10-05) y las carpetas `normal`, `claras`, `medias` de
  `build_plank_templates.py` (tablón recoloreado de template3; de ahí sigue en uso
  `sangrado/medias/monedas.png`, para las monedas).

## Caja (`img/Caja/`)

`build_caja.py` (`/c/Python310/python img/_work/build_caja.py`) compone las caras de la caja de la
clásica: 2 filas de cartas, exterior **140 x 97 x 73 mm**, con el librillo A7 tumbado encima de los dos
montones (378 cartas de ~0,31 mm = 189 por montón, ~59 mm; medir el grosor real con una muestra de la
imprenta antes de fijar la altura). Una imagen por cara a 300 ppp con 3 mm de sangrado por lado:
`01_tapa`, `02_reverso`, `03_lateral_largo` (x2), `04_lateral_corto` (x2) y `vista_previa.png`
(isométrica, no se imprime). Solo castellano.

- Tapa y reverso: pergamino + el marco de enredadera de `back.jpg` (matte por diferencia con el fondo,
  girado 90 grados y estirado; descarta la pieza conexa del emblema) + emblema de `portada_viva.png`
  + abanicos de cartas reales (`card_rgba` las recorta por su línea de corte, 750x1050 centrada, con
  las esquinas redondeadas).
- Laterales: madera marrón procedural (`BROWN` = el marrón del borde de las cartas) con emblema e iconos.
- Iconos de jugadores (2-7), duración (30–60 min, fija) y edad (10+) dibujados en el propio script; los textos están en las
  constantes `PLAYERS_TXT`, `AGE_TXT`, `TIME_TXT` (`TIME_SUB` opcional, vacío), `BLURB`, `CONTENTS`.
- Si la imprenta pide otra construcción (tapa + fondo, plantilla propia), las caras se reutilizan
  tal cual; solo cambia dónde cae el corte.

### Caja de una pieza en A3, sin pegamento (`build_caja_a3.py`)

`/c/Python310/python img/_work/build_caja_a3.py` genera `pdf/es/caja_una_pieza_a3.pdf`: la caja de envío
automontable clásica, de una pieza y paredes laterales dobles, para imprimir en un A3 de cartulina,
recortar, doblar y montar SIN PEGAMENTO.

- Las cartas van tumbadas en TRES montones de 126, uno al lado del otro; exterior 198 x 92 x 42 mm. Es la
  única colocación con la que este tipo de caja cabe en un A3: con las cartas en una fila el desarrollo
  mide unos 394 x 348 mm, y el lado que no cabe (2 x fondo + 2 x alto + solapa) no depende del número de
  cartas sino del tamaño de la carta. El alto sale de 126 cartas de ~0,31 mm (cartulina de 300 g) +
  holgura; si el taco real mide otra cosa, cambiar `H`. El librillo A7 no cabe.
- Desarrollo (A3 apaisado, 375 x 286 mm): solapa, tapa (con alas), trasera y frente (con orejas) y, a cada
  lado de la base, pared exterior, lomo, pared interior y dos pestañas que entran en dos cortes de la base.
  Queda a 5-6 mm del borde del papel por arriba y por abajo: imprimir al 100 % y con márgenes mínimos.
- Arte: la portada es `img/Caja/Alternativa/front.jpg` y continúa por el frente (misma imagen, misma
  escala; va ampliada 2,4x, unos 126 ppp). Laterales: tucanes y loros (`SIDE_SCENES`); trasera: la franja de
  selva con la serpiente que preparó el usuario, `img/Caja/Alternativa/Sin título.jpg` (`REAR`; la primera
  versión, con monos, elefantes y perezoso fundidos, no le gustó). Base: pergamino con cinta, texto, iconos y abanico; su marco de
  enredadera no se estira, se alarga repitiendo en espejo el tramo central (`paste_frame_wide`).
- Página 1: arte con 3 mm de sangrado, línea de corte, los 4 cortes de la base y marcas de pliegue en los
  márgenes. Página 2: guía de corte, pliegue y montaje. También deja `img/Caja/una_pieza_a3.png` y
  `una_pieza_vista_previa.png`.
- Versiones anteriores del mismo día, descartadas: estuche con pestaña pegada, y bandeja de pared sencilla
  con orejas de flecha (cartas en una fila, 126 x 92 x 67 mm).

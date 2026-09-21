# Cadena de impresión y arte de las cartas

Todo lo que genera las cartas impresas vive en esta carpeta. El intérprete es `/c/Python310/python`
(tiene Pillow, numpy, scipy y PyMuPDF). Los datos de las cartas salen del motor:
`packages/engine/src/cards/data/*.json`.

## Regenerar todo (orden)

```bash
/c/Python310/python img/_work/compose_all.py        # cartas ES  -> img/cards
/c/Python310/python img/_work/compose_all_en.py     # cartas EN  -> img/cards_en
/c/Python310/python img/_work/build_pdf.py          # hoja de referencia ES -> img/cartas_zoo.pdf
/c/Python310/python img/_work/build_pdf_en.py       # hoja de referencia EN -> img/cartas_zoo_en.pdf
/c/Python310/python img/_work/build_deck_pdf.py     # mazo de impresion ES -> img/mazo_impresion.pdf
/c/Python310/python img/_work/build_deck_pdf_en.py  # mazo de impresion EN -> img/mazo_impresion_en.pdf
```

- "Regenerar los PDFs" son siempre los cuatro.
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

## Ediciones: clásica (oficial) y completa (pruebas)

| | Clásica | Completa |
|---|---|---|
| Especies | 33 | 39 (añade perro, gato, diplodocus, tiranosaurio, terodáctilo, mosasaurio) |
| Tipos | terrestre, volador, acuático | + mascota (`pet`) y dinosaurio (`dinosaur`) |
| Dónde se ve | impresión y web publicada | solo `localhost` |
| Carpetas | `img/cards`, `img/cards_en`, los 4 PDFs | `img/cards_completa`, `img/cards_completa_en` (sin PDF) |

- La clásica es **la única oficial**. De la completa no debe verse nada ni al imprimir ni en la web publicada.
- Para componer la completa: `ZOO_EDITION=full /c/Python310/python img/_work/compose_all.py` (y `_en`).
- Las cartas solo-completa llevan `"edition": "full"` en su JSON. En la clásica, `load_cards()` las omite y
  quita `pet`/`dinosaur` de las demás (pez de colores, periquito y cocodrilo vuelven a ser lo de siempre).
- Motor: `createGame(..., { edition })`, por defecto `'classic'`. `ANIMAL_SPECIES` sigue siendo la lista
  clásica (los bots RL dependen de ella) y `FULL_EDITION_EXTRA_SPECIES` las 6 extra. `mintInstance` quita
  los tipos extra en partidas clásicas.
- Web: el selector "Clásica / Completa (pruebas)" solo se pinta en localhost (`apps/web/src/lib/edition.ts`);
  `effectiveEdition` fuerza clásica en cualquier otro host.
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
- Pendiente en la completa: descargar los emojis nuevos (`apps/web/scripts/fetch-twemoji.mjs`) y reentrenar
  los bots RL, que no conocen las cartas nuevas.
- OJO con dos fotos: `img/tiranosaurios.jpg` muestra un triceratops y `img/triceratops.jpg` muestra el
  tiranosaurio (562x463, poca resolución). `SPECIES_PHOTO` usa la segunda.

## Diseño oficial de las cartas de animal (iconos de tipo)

Lo compone `compose_card_iconos.py` (`compose_official`, variante `A_pergamino`), llamado desde
`compose_all.py` y `compose_all_en.py`. `compose_generic` es el diseño anterior (texto de tipo y tablón de
color) y ya no se usa.

- **Iconos en vez del texto de tipo**: redondos de madera (`img/redondo.jpg`) con hoja = terrestre,
  nube = volador, gota = acuático. Orden tierra, aire, agua. 52 px de diámetro en el diseño de 615x878,
  12 px de separación, centrados en (307, 648).
- El pez de colores y el periquito **cuentan como 2**, así que llevan el icono doble (`DOUBLE_ICON`).
- **Plantilla estándar de madera** (`land`) para todas las cartas: el tipo ya lo dicen los iconos.
- **Nombre en blanco** con contorno marrón de 2 px.
- **Texto centrado en vertical** entre el borde inferior de los iconos y y=816 del diseño (el pergamino
  acaba en 828). Se centra la TINTA real del bloque, no la caja de la fuente, que lleva aire arriba y hacía
  que el texto se viera caído. Si no cabe con 10 px de aire arriba y abajo, baja la letra (solo afecta a
  textos de 4 líneas).
- Los iconos los dibuja `type_icons.py` (formas vectoriales con degradado, contorno y sombra). Ejecutarlo
  regenera los PNG listos para usar: oficiales en `img/iconos_tipo/` (land, bird, aquatic) y los de la
  edición completa en `img/iconos_tipo_completa/` (pet = caseta, dinosaur = hueso). La pluma (tres
  variantes) sigue en el script por si se quiere volver; el usuario la cambió por la nube.
- Las variantes B a H del módulo son las colocaciones que se probaron y descartaron (listón superior,
  esquina de la ilustración, a caballo de cada borde, columna bajo la bolsa). Para probar una carta:
  `/c/Python310/python img/_work/compose_card_iconos.py toucan A` -> `img/templates/pruebas/iconos_tipo/`.
- Los números de bolsa y escudo están en `COST_BADGE = (83, 109)` y `PV_BADGE = (526, 90)` (`compose_card.py`).
- `build_card_base` recorta el marco de papel de algunas ilustraciones (`PHOTO_INSET`) y ya no deja una
  franja negra bajo las fotos apaisadas.

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

- `build_plank_templates.py` recolorea el tablón del nombre de `img/template3.png` por hábitat y sus
  mezclas (7 plantillas por carpeta: `normal`, `claras`, `medias`), con zonas manuales en `plank_zones.py`.
- `compose_card.py` usa `img/templates/sangrado/medias` y recorta su sangrado de 98 a 30 px para que quepan
  9 cartas por A4. Si cambian las plantillas, borrar `template_alpha_cache/`.
- Desde el diseño de iconos solo se usan dos plantillas: `tierra` para los animales y `monedas`.

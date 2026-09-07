# Preparación de imágenes para imprimir (futuro)

Esta carpeta está reservada para la fase 3 del proyecto: generar las
imágenes de las cartas listas para imprimir, a partir de los datos en
`packages/engine/src/cards/data/*.json`.

Todavía no hay código aquí — se implementará cuando el diseño visual de las
cartas esté decidido. Notas a tener en cuenta cuando llegue el momento:

- Tamaño de carta estándar (p. ej. póker 63×88 mm o mini 44×67 mm) y área de
  sangrado (bleed) para la imprenta.
- Plantilla (SVG u otro) que combine el arte, el nombre, el coste y el texto
  de cada carta a partir de sus datos JSON.
- Export por lotes a PNG/PDF (una carta por página o en hojas para recortar).
- Resolución mínima recomendada por la imprenta que se vaya a usar.

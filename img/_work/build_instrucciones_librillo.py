"""Monta el reglamento (16 páginas A6) como librillo para doblar y grapar.

Uso:  /c/Python310/python img/_work/build_instrucciones_librillo.py [en] [--pergamino]

Con --pergamino genera SOLO img/instrucciones[_en]_librillo_a4_pergamino.pdf: el mismo
librillo en A4 pero con pergamino en todo el folio, pensado para recortar. Ver
build_pergamino() más abajo. Necesita antes:
  build_fondo_pergamino.py a4      y      build_instrucciones.py [en] --capa

Parte de img/instrucciones[_en].pdf (generarlo antes con build_instrucciones.py)
y escribe dos versiones con el mismo contenido:

- img/instrucciones[_en]_librillo_a5.pdf: 4 hojas A5 apaisadas a doble cara
  (8 páginas de PDF). Cada hoja lleva 2 páginas A6 por cara. Doble cara
  volteando por el BORDE CORTO.
- img/instrucciones[_en]_librillo_a4.pdf: 2 folios A4 verticales a doble cara
  (4 páginas de PDF). Cada folio lleva 2 hojas A5 del librillo, una arriba y
  otra abajo. Doble cara volteando por el BORDE LARGO. Se corta cada folio por
  la mitad y salen las 4 hojas A5.

En los dos casos: se apilan las 4 hojas A5 en orden (la de la portada debajo,
con la portada hacia fuera), se doblan por la mitad y se grapan en el lomo.

Imposición de un cuadernillo de N páginas (N múltiplo de 4), hoja i desde la
exterior (i = 0):  anverso = [N - 2i, 1 + 2i]   reverso = [2 + 2i, N - 1 - 2i]
(izquierda, derecha, tal como se ve cada cara).
"""
import os
import sys

import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
SUFFIX = "_en" if "en" in sys.argv[1:] else ""
SRC = os.path.join(HERE, "..", f"instrucciones{SUFFIX}.pdf")
OUT_A5 = os.path.join(HERE, "..", f"instrucciones{SUFFIX}_librillo_a5.pdf")
OUT_A4 = os.path.join(HERE, "..", f"instrucciones{SUFFIX}_librillo_a4.pdf")

MM = 72 / 25.4
A6_W, A6_H = 105 * MM, 148 * MM
A5_W, A5_H = 210 * MM, 148 * MM          # A5 apaisado = 2 páginas A6
A4_W, A4_H = 210 * MM, 297 * MM
MARK = (0.55, 0.55, 0.55)


def spreads(n):
    """Lista de caras [(izquierda, derecha), ...] en orden de impresión, páginas desde 1."""
    out = []
    for i in range(n // 4):
        out.append((n - 2 * i, 1 + 2 * i))        # anverso de la hoja i
        out.append((2 + 2 * i, n - 1 - 2 * i))    # reverso de la hoja i
    return out


def place_spread(page, src, left, right, x0, y0):
    for k, num in enumerate((left, right)):
        rect = fitz.Rect(x0 + k * A6_W, y0, x0 + (k + 1) * A6_W, y0 + A6_H)
        page.show_pdf_page(rect, src, num - 1)


def fold_marks(page, x0, y0):
    """Rayitas de 3 mm arriba y abajo, en el eje del pliegue."""
    x = x0 + A6_W
    for ya, yb in ((y0, y0 + 3 * MM), (y0 + A6_H - 3 * MM, y0 + A6_H)):
        page.draw_line((x, ya), (x, yb), color=MARK, width=0.4)


# --- Librillo con pergamino hasta el borde -------------------------------------------
# Una impresora normal deja ~4 mm sin imprimir alrededor del folio. Para que el pergamino
# llegue al canto, se imprime el folio entero de pergamino y se RECORTAN 5 mm por cada
# lado; después se corta por la mitad y se dobla. El librillo queda en 100 x 143,5 mm
# (en vez de 105 x 148), así que cada página se reduce al 95,2 % para caber.
TRIM = 5 * MM
PG_W = (A4_W - 2 * TRIM) / 2               # 100 mm
PG_H = (A4_H - 2 * TRIM) / 2               # 143,5 mm
SCALE = PG_W / A6_W                        # 0,952
DARK = (0.25, 0.18, 0.1)


def crop_marks(page):
    """Marcas en la franja de 5 mm que se tira: líneas de recorte, corte central y pliegue."""
    a, b = 1 * MM, 4.4 * MM                # tramo de la marca dentro del margen
    xs = (TRIM, A4_W / 2, A4_W - TRIM)     # recorte izq, pliegue, recorte dcho
    ys = (TRIM, A4_H / 2, A4_H - TRIM)     # recorte sup, corte central, recorte inf
    for x in xs:
        for y0, y1 in ((a, b), (A4_H - b, A4_H - a)):
            page.draw_line((x, y0), (x, y1), color=DARK, width=0.5)
    for y in ys:
        for x0, x1 in ((a, b), (A4_W - b, A4_W - a)):
            page.draw_line((x0, y), (x1, y), color=DARK, width=0.5)


def build_pergamino():
    capa = os.path.join(HERE, "..", f"instrucciones{SUFFIX}_capa.pdf")
    fondo = os.path.join(HERE, "..", "fondo_pergamino_a4.jpg")
    out = os.path.join(HERE, "..", f"instrucciones{SUFFIX}_librillo_a4_pergamino.pdf")
    for need in (capa, fondo):
        if not os.path.exists(need):
            sys.exit(f"falta {need}: ver el uso al principio de este archivo")
    src = fitz.open(capa)
    n = len(src)
    if n % 4:
        sys.exit(f"{capa} tiene {n} páginas: hace falta un múltiplo de 4")
    sides = spreads(n)
    sheets = [sides[i:i + 2] for i in range(0, len(sides), 2)]
    doc = fitz.open()
    xref = 0
    w, h = A6_W * SCALE, A6_H * SCALE
    for pair in (sheets[i:i + 2] for i in range(0, len(sheets), 2)):
        for face in (0, 1):
            page = doc.new_page(width=A4_W, height=A4_H)
            xref = page.insert_image(page.rect, filename=None if xref else fondo, xref=xref, keep_proportion=False)
            for row, sheet in enumerate(pair):
                y_slot = TRIM + row * PG_H
                for k, num in enumerate(sheet[face]):
                    x = TRIM + k * PG_W
                    y = y_slot + (PG_H - h) / 2
                    page.show_pdf_page(fitz.Rect(x, y, x + w, y + h), src, num - 1)
            crop_marks(page)
    doc.save(out, garbage=4, deflate=True)
    print(os.path.abspath(out), f"({len(doc)} páginas, {os.path.getsize(out) / 1e6:.1f} MB)")
    print("página final: %.1f x %.1f mm, contenido al %.1f %%" % (PG_W / MM, PG_H / MM, SCALE * 100))


def main():
    if "--pergamino" in sys.argv[1:]:
        build_pergamino()
        return
    src = fitz.open(SRC)
    n = len(src)
    if n % 4:
        sys.exit(f"{SRC} tiene {n} páginas: hace falta un múltiplo de 4")
    sides = spreads(n)

    # --- A5: una cara de hoja por página de PDF
    a5 = fitz.open()
    for left, right in sides:
        page = a5.new_page(width=A5_W, height=A5_H)
        place_spread(page, src, left, right, 0, 0)
        fold_marks(page, 0, 0)
    a5.save(OUT_A5, garbage=4, deflate=True)

    # --- A4: dos hojas A5 por folio (arriba y abajo), centradas en vertical
    a4 = fitz.open()
    top = (A4_H - 2 * A5_H) / 2          # 0,5 mm de margen arriba y abajo
    sheets = [sides[i:i + 2] for i in range(0, len(sides), 2)]      # [(anverso, reverso), ...]
    for pair in (sheets[i:i + 2] for i in range(0, len(sheets), 2)):
        for face in (0, 1):                                        # anverso y reverso del folio
            page = a4.new_page(width=A4_W, height=A4_H)
            for row, sheet in enumerate(pair):
                left, right = sheet[face]
                y0 = top + row * A5_H
                place_spread(page, src, left, right, 0, y0)
                fold_marks(page, 0, y0)
            # marcas de corte: rayitas a izquierda y derecha, a media altura
            y = top + A5_H
            for xa, xb in ((0, 4 * MM), (A4_W - 4 * MM, A4_W)):
                page.draw_line((xa, y), (xb, y), color=MARK, width=0.4)
    a4.save(OUT_A4, garbage=4, deflate=True)

    for path, doc in ((OUT_A5, a5), (OUT_A4, a4)):
        print(os.path.abspath(path), f"({len(doc)} páginas, {os.path.getsize(path) / 1e6:.1f} MB)")
    print("caras:", sides)


if __name__ == "__main__":
    main()

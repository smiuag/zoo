"""Versión A7 (74 x 105 mm) del reglamento, para cajas pequeñas.

Uso:  /c/Python310/python img/_work/build_instrucciones_a7.py [en] [--previews]

Sale del MISMO texto que el reglamento A6 (instrucciones[_en].html): no hay que mantener
otra copia. La diferencia es la maqueta. En A6 cada <section class="page"> es una página
fija; en A7 no cabe, así que aquí se anulan esos tamaños fijos y se deja que el navegador
reparta el texto en las páginas que hagan falta (cada sección empieza en página nueva y
los recuadros, tablas y puntos de lista no se parten).

Escribe:
- img/instrucciones[_en]_a7.pdf           página a página
- img/instrucciones[_en]_a7_librillo_a4.pdf   montado para doblar y grapar (ver impose())

El número de páginas tiene que ser múltiplo de 4 para poder graparlo: si no lo es, se
añaden páginas de «Notas» justo antes de los créditos.
"""
import os
import re
import subprocess
import sys
import tempfile

import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
SUFFIX = "_en" if "en" in sys.argv[1:] else ""
HTML = os.path.join(HERE, f"instrucciones{SUFFIX}.html")
OUT = os.path.join(HERE, "..", f"instrucciones{SUFFIX}_a7.pdf")
OUT_BOOK = os.path.join(HERE, "..", f"instrucciones{SUFFIX}_a7_librillo_a4.pdf")
PREVIEW_DIR = os.path.join(HERE, f"preview_instrucciones{SUFFIX}_a7")
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
MM = 72 / 25.4
A7_W, A7_H = 74 * MM, 105 * MM
A4_W, A4_H = 210 * MM, 297 * MM
MARK = (0.55, 0.55, 0.55)

A7_CSS = """<style>
@page { size: 74mm 105mm; margin: 7mm 6mm 9mm 6mm;
  @bottom-center { content: counter(page); font-family: "Baloo", sans-serif; font-size: 6.5pt; color: #6b4423; } }
@page portada { margin: 0; @bottom-center { content: none; } }
body { font-size: 8pt; line-height: 1.22; }
.page { width: auto; height: auto; padding: 0; overflow: visible; background: transparent;
  page-break-after: auto; break-before: page; }
.page:first-child { break-before: auto; }
.num { display: none; }
h1 { font-size: 11pt; padding: 1.3mm 2.4mm 1mm; margin-bottom: 2mm; break-after: avoid; }
h2 { font-size: 9pt; break-after: avoid; }
p { orphans: 2; widows: 2; }
.nota, .ejemplo, table, tr, li, .leyenda p { break-inside: avoid; }
.fila { flex-direction: column; align-items: center; gap: 2mm; margin-bottom: 1.5mm; }
.portada { page: portada; width: 74mm; height: 105mm; position: relative; overflow: hidden; background: #fff; }
.portada img { width: 60mm; left: 7mm; top: 11mm; }
.portada .faja { top: 80mm; font-size: 10pt; }
.portada .sub { top: 87mm; font-size: 6.6pt; }
.creditos .rol { margin-top: 8mm; }
.notas-linea { border-bottom: 0.2mm solid #cbb98f; height: 7mm; }
</style>"""

# Frases del A6 que citan una página concreta o "la página siguiente": en A7 la
# paginación cambia, así que se sustituyen por una referencia a la sección.
REPLACEMENTS = [
    ("Está en la página 8.", "Está en «Tipos de partida»."),
    ("See page 8.", "See “Types of game”."),
    ("Suma los puntos de las cartas de la página siguiente.", "Suma los puntos de «Cartas que puntúan»."),
    ("Add the points from the cards on the next page.", "Add the points from “Scoring cards”."),
]
NOTES_TITLE = "Notes" if SUFFIX else "Notas"


def find_browser():
    for path in BROWSERS:
        if os.path.exists(path):
            return path
    sys.exit("No se encuentra Chrome ni Edge para generar el PDF")


def render(extra_pages):
    with open(HTML, encoding="utf-8") as f:
        src = f.read()
    for a, b in REPLACEMENTS:
        # el HTML parte las frases en varias líneas: se compara sin mirar los espacios
        pattern = r"\s+".join(re.escape(w) for w in a.split())
        src = re.sub(pattern, lambda m, b=b: b, src)
    src = src.replace("</head>", A7_CSS + "</head>")
    notes = (
        '<section class="page"><h1>%s</h1>%s</section>\n' % (NOTES_TITLE, '<div class="notas-linea"></div>' * 11)
    ) * extra_pages
    marker = '<section class="page creditos">'
    if src.count(marker) != 1:
        sys.exit("no encuentro la sección de créditos en " + HTML)
    src = src.replace(marker, notes + marker)
    tmp = os.path.join(HERE, f"_instrucciones{SUFFIX}_a7_tmp.html")      # junto al original: mismas rutas relativas
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(src)
    try:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
            subprocess.run(
                [find_browser(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                 "--user-data-dir=" + profile, "--print-to-pdf=" + os.path.abspath(OUT),
                 "file:///" + tmp.replace("\\", "/")],
                check=True, timeout=120,
            )
    finally:
        os.remove(tmp)
    return len(fitz.open(OUT))


def impose():
    """Librillo A7 en folios A4 APAISADOS a doble cara (voltear por el BORDE CORTO).

    Cada hoja del librillo es un A6 apaisado (148,5 x 105) doblado por la mitad, con dos
    páginas A7 una al lado de otra. En un A4 apaisado caben 4, en 2 columnas x 2 filas.
    Se corta el folio en 4 (un corte vertical y otro horizontal), se apilan las hojas por
    orden, se doblan y se grapan.

    Al dar la vuelta al folio por el borde corto, lo que estaba en la columna izquierda
    queda en la derecha: por eso el reverso de cada hoja va en la columna contraria.
    Se probó a girar las hojas 90 grados en un folio vertical, pero show_pdf_page encoge
    la página al girarla; sin giros no hay ese problema.
    """
    src = fitz.open(OUT)
    n = len(src)
    sheets = [((n - 2 * i, 1 + 2 * i), (2 + 2 * i, n - 1 - 2 * i)) for i in range(n // 4)]
    sheet_w, sheet_h = A4_H, A4_W                     # apaisado: 297 x 210
    cell_w, cell_h = sheet_w / 2, sheet_h / 2         # 148,5 x 105
    doc = fitz.open()
    for start in range(0, len(sheets), 4):
        group = sheets[start:start + 4]
        for face in (0, 1):
            page = doc.new_page(width=sheet_w, height=sheet_h)
            for k, sheet in enumerate(group):
                row, col = k // 2, k % 2
                if face == 1:
                    col = 1 - col
                x0, y0 = col * cell_w, row * cell_h
                for side, num in enumerate(sheet[face]):
                    x = x0 + side * cell_w / 2
                    page.show_pdf_page(fitz.Rect(x, y0, x + cell_w / 2, y0 + cell_h), src, num - 1)
            m = 4 * MM
            # cortes: ejes central vertical y horizontal
            for xa, xb in ((0, m), (sheet_w - m, sheet_w)):
                page.draw_line((xa, sheet_h / 2), (xb, sheet_h / 2), color=MARK, width=0.4)
            for ya, yb in ((0, m), (sheet_h - m, sheet_h)):
                page.draw_line((sheet_w / 2, ya), (sheet_w / 2, yb), color=MARK, width=0.4)
                # pliegues: centro de cada columna
                for c in (0, 1):
                    x = c * cell_w + cell_w / 2
                    page.draw_line((x, ya), (x, ya + (yb - ya) * 0.6), color=MARK, width=0.2)
    doc.save(OUT_BOOK, garbage=4, deflate=True)
    return len(doc), sheets


def main():
    n = render(0)
    pad = (-n) % 4
    if pad:
        print(f"{n} páginas: se añaden {pad} de «{NOTES_TITLE}» para llegar a múltiplo de 4")
        n = render(pad)
        if n % 4:
            sys.exit(f"tras rellenar salen {n} páginas: revisar a mano")
    doc = fitz.open(OUT)
    bad = [i + 1 for i, p in enumerate(doc) if abs(p.rect.width - A7_W) > 1.5 or abs(p.rect.height - A7_H) > 1.5]
    if bad:
        print("AVISO: páginas que no miden A7:", bad)
    if "--previews" in sys.argv:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        for f in os.listdir(PREVIEW_DIR):
            os.remove(os.path.join(PREVIEW_DIR, f))
        for i, page in enumerate(doc, start=1):
            page.get_pixmap(dpi=150).save(os.path.join(PREVIEW_DIR, f"pagina_{i:02d}.png"))
    faces, sheets = impose()
    print(os.path.abspath(OUT), f"({n} páginas, {os.path.getsize(OUT) / 1e6:.1f} MB)")
    print(os.path.abspath(OUT_BOOK), f"({faces} caras = {faces // 2} folios A4, {len(sheets)} hojas de librillo)")


if __name__ == "__main__":
    main()

"""Genera img/instrucciones.pdf (reglamento A6 de la edición clásica) a partir
de img/_work/instrucciones.html, usando Chrome o Edge sin ventana.

Uso:  /c/Python310/python img/_work/build_instrucciones.py [en] [--previews]

Sin argumento genera el castellano (instrucciones.html -> img/instrucciones.pdf); con
"en", el inglés (instrucciones_en.html -> img/instrucciones_en.pdf). Las dos versiones
comparten instrucciones.css.

Con --previews deja además una imagen PNG por página en
img/_work/preview_instrucciones/ para revisar la maqueta a ojo.

El HTML tiene una <section class="page"> por página física. Si algún texto se
desborda, Chrome NO crea página nueva (cada sección recorta su contenido), así
que aquí se comprueba el desbordamiento midiendo el texto de cada página del
PDF contra el margen inferior.
"""
import os
import subprocess
import sys
import tempfile

import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
SUFFIX = "_en" if "en" in sys.argv[1:] else ""
# --fondo: PRUEBA con todas las páginas sobre la textura de pergamino del dorso de las
# cartas (img/fondo_pergamino.jpg, la genera build_fondo_pergamino.py). No sustituye al reglamento normal: escribe
# instrucciones[_en]_fondo.pdf aparte. Ojo al imprimir: un fondo de color llega hasta el
# borde, así que una impresora normal deja filo blanco y hace falta sangrado y recorte.
# --capa: mismas páginas y mismos colores de recuadro que --fondo pero con el fondo de
# página TRANSPARENTE. No es para imprimir tal cual: es la capa de texto que
# build_instrucciones_librillo.py --pergamino coloca sobre un folio entero de pergamino.
CAPA = "--capa" in sys.argv[1:]
FONDO = "--fondo" in sys.argv[1:] or CAPA
VARIANT = "_capa" if CAPA else "_fondo" if FONDO else ""
HTML = os.path.join(HERE, f"instrucciones{SUFFIX}.html")
OUT = os.path.join(HERE, "..", f"instrucciones{SUFFIX}{VARIANT}.pdf")
PREVIEW_DIR = os.path.join(HERE, f"preview_instrucciones{SUFFIX}{VARIANT}")
FONDO_CSS = """<style>
.page, .portada { background: #ede2c7 url(../fondo_pergamino.jpg) center / cover no-repeat; }
.nota { background: #e0cfa8; }
.ejemplo { background: #d6e2bf; }
td { border-bottom-color: #cbb98f; }
</style>"""
EXPECTED_PAGES = 16  # múltiplo de 4: librillo grapado de hojas A5 plegadas
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
MM = 72 / 25.4
# El número de página vive a 3,5 mm del borde; el texto normal no debe bajar
# de 9 mm del borde inferior.
BOTTOM_LIMIT_MM = 148 - 8.5


CAPA_CSS = """<style>
html, body, .page, .portada { background: transparent !important; }
</style>"""


def find_browser():
    for path in BROWSERS:
        if os.path.exists(path):
            return path
    sys.exit("No se encuentra Chrome ni Edge para generar el PDF")


def main():
    out = os.path.abspath(OUT)
    html_path = HTML
    if FONDO:
        # copia temporal junto al original (mismas rutas relativas) con los estilos de fondo
        html_path = os.path.join(HERE, f"_instrucciones{SUFFIX}_fondo_tmp.html")
        with open(HTML, encoding="utf-8") as f:
            src = f.read()
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(src.replace("</head>", (FONDO_CSS + CAPA_CSS if CAPA else FONDO_CSS) + "</head>"))
    url = "file:///" + html_path.replace("\\", "/")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
        subprocess.run(
            [
                find_browser(),
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                "--user-data-dir=" + profile,
                "--print-to-pdf=" + out,
                url,
            ],
            check=True,
            timeout=120,
        )

    if FONDO:
        os.remove(html_path)

    doc = fitz.open(out)
    problems = []
    if len(doc) != EXPECTED_PAGES:
        problems.append(f"el PDF tiene {len(doc)} páginas, se esperaban {EXPECTED_PAGES}")
    for i, page in enumerate(doc, start=1):
        w_mm, h_mm = page.rect.width / MM, page.rect.height / MM
        if abs(w_mm - 105) > 0.5 or abs(h_mm - 148) > 0.5:
            problems.append(f"página {i}: tamaño {w_mm:.1f} x {h_mm:.1f} mm, no es A6")
        if i == 1:
            continue  # portada: imagen a sangre, sin texto corrido
        lowest = 0.0
        for block in page.get_text("blocks"):
            text = block[4].strip()
            if not text or text == str(i):
                continue  # el número de página no cuenta
            lowest = max(lowest, block[3] / MM)
        if lowest > BOTTOM_LIMIT_MM:
            problems.append(f"página {i}: el texto llega a {lowest:.1f} mm (límite {BOTTOM_LIMIT_MM:.1f})")
        print(f"página {i:2d}: texto hasta {lowest:5.1f} mm")

    if "--previews" in sys.argv:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        for i, page in enumerate(doc, start=1):
            page.get_pixmap(dpi=150).save(os.path.join(PREVIEW_DIR, f"pagina_{i:02d}.png"))
        print("previews en", PREVIEW_DIR)

    print(out, f"({len(doc)} páginas, {os.path.getsize(out) / 1e6:.1f} MB)")
    if problems:
        print("\nPROBLEMAS:")
        for p in problems:
            print(" -", p)
        sys.exit(1)


if __name__ == "__main__":
    main()

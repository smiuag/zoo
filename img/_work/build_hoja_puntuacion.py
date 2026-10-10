"""Genera pdf/es/hoja_puntuacion.pdf (hoja de puntuación de la edición clásica) a partir de
img/_work/hoja_puntuacion.html, usando Chrome o Edge sin ventana, igual que el reglamento.

Uso:  /c/Python310/python img/_work/build_hoja_puntuacion.py [--previews]

Un folio A4 vertical con DOS cuartillas (A5 apaisadas, 210 x 148,5 mm) idénticas, una encima de
otra, separadas por una línea de corte: se imprime, se corta por la mitad y salen dos hojas. En el
HTML solo está escrita la primera cuartilla; aquí se duplica en el marcador <!--CUARTILLA2--> para
no mantener dos copias a mano.

Las imágenes (cartas, fondo, emblema) se incrustan reducidas (REDUCIDAS, copias temporales en
img/_work/_hoja_puntuacion_tmp/): Chrome mete cada imagen a su resolución original y con las cartas a
823x1122 el PDF pasaba de 13 MB para una hoja que las enseña a 12 mm de ancho.

Con --previews deja además img/_work/preview_hoja_puntuacion/pagina_01.png para revisarla a ojo.
"""
import os
import re
import subprocess
import sys
import tempfile

import fitz
from PIL import Image

from pdf_paths import pdf_path

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, "hoja_puntuacion.html")
OUT = pdf_path("es", "hoja_puntuacion.pdf")
PREVIEW_DIR = os.path.join(HERE, "preview_hoja_puntuacion")
TMP_IMG = os.path.join(HERE, "_hoja_puntuacion_tmp")
# Ancho máximo (px) al que se reduce cada imagen antes de incrustarla. Las cartas se ven a ~21 mm de
# ancho (recorte de 12 mm) y el fondo a 196 mm: con esto quedan por encima de 250 ppp.
REDUCIDAS = {"../cards/": 500, "../fondo_pergamino_a4_claro.jpg": 1900, "../portada_viva.png": 300}
BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
MM = 72 / 25.4


def find_browser():
    for path in BROWSERS:
        if os.path.exists(path):
            return path
    sys.exit("No se encuentra Chrome ni Edge para generar el PDF")


def reduce_images(src):
    """Copia reducida de cada imagen referenciada en el HTML y devuelve el HTML apuntando a ellas."""
    os.makedirs(TMP_IMG, exist_ok=True)
    # Tanto los <img src="../..."> como el fondo del CSS, url("../...")
    for ref in sorted(set(re.findall(r'(?:src=|url\()"(\.\./[^"]+)"', src))):
        max_w = next((w for prefix, w in REDUCIDAS.items() if ref.startswith(prefix)), None)
        if max_w is None:
            continue
        im = Image.open(os.path.normpath(os.path.join(HERE, ref)))
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        # Sin transparencia va en JPEG (las cartas son PNG opacos de ~600 KB cada uno a 500 px)
        name = os.path.basename(ref)
        if im.mode == "RGB":
            name = os.path.splitext(name)[0] + ".jpg"
        im.save(os.path.join(TMP_IMG, name), quality=88)
        src = src.replace(f'"{ref}"', f'"_hoja_puntuacion_tmp/{name}"')
    return src


def main():
    out = os.path.abspath(OUT)
    with open(HTML, encoding="utf-8") as f:
        src = reduce_images(f.read())
    m = re.search(r'<section class="cuartilla">.*?</section>', src, re.S)
    if not m or "<!--CUARTILLA2-->" not in src:
        sys.exit("hoja_puntuacion.html: falta la cuartilla o el marcador <!--CUARTILLA2-->")
    # Copia temporal junto al original (mismas rutas relativas a fuentes e imágenes)
    tmp_html = os.path.join(HERE, "_hoja_puntuacion_tmp.html")
    with open(tmp_html, "w", encoding="utf-8") as f:
        f.write(src.replace("<!--CUARTILLA2-->", m.group(0)))
    url = "file:///" + tmp_html.replace("\\", "/")
    try:
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
    finally:
        os.remove(tmp_html)

    doc = fitz.open(out)
    problems = []
    if len(doc) != 1:
        problems.append(f"el PDF tiene {len(doc)} páginas, se esperaba 1 (algo se desborda)")
    page = doc[0]
    w_mm, h_mm = page.rect.width / MM, page.rect.height / MM
    if abs(w_mm - 210) > 0.5 or abs(h_mm - 297) > 0.5:
        problems.append(f"tamaño {w_mm:.1f} x {h_mm:.1f} mm, no es A4")

    if "--previews" in sys.argv:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        for i, p in enumerate(doc, start=1):
            p.get_pixmap(dpi=150).save(os.path.join(PREVIEW_DIR, f"pagina_{i:02d}.png"))
        print("previews en", PREVIEW_DIR)

    print(out, f"({len(doc)} página(s), {os.path.getsize(out) / 1e6:.1f} MB)")
    if problems:
        print("\nPROBLEMAS:")
        for p in problems:
            print(" -", p)
        sys.exit(1)


if __name__ == "__main__":
    main()

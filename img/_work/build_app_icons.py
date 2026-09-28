"""Iconos de la app instalable (PWA).

Por defecto salen de img/IconoApp.jpg (bellota dorada sobre cuadrado redondeado verde -> naranja, aportado por el
usuario): se recorta el interior del cuadrado redondeado (sin las esquinas crema) y se reescala.
`python build_app_icons.py silver` genera en su lugar una alternativa: bellota plateada (dibujo vectorial propio,
ACORN_SVG, rasterizado con Chrome sin interfaz) sobre el verde de la app.

Salida en apps/web/public/icons/:
    icon-192.png, icon-512.png     "any": el cuadrado completo
    icon-maskable-512.png          "maskable": contenido reducido dentro de la zona segura para que Android
                                   pueda recortar en círculo/squircle sin cortar nada
    apple-touch-icon.png           180x180, iOS redondea las esquinas él solo
    favicon-48.png                 pestaña del navegador
Uso:  /c/Python310/python img/_work/build_app_icons.py [silver]
"""
import os
import sys

from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "apps", "web", "public", "icons")


def acorn_svg(scale):
    """SVG 512x512; `scale` = fracción del alto que ocupa la bellota (centrada)."""
    # La bellota se dibuja en un sistema 200 x 280 (con el rabito) y se centra en el lienzo.
    s = 512 * scale / 280
    tx, ty = (512 - 200 * s) / 2, (512 - 280 * s) / 2 + 6 * s
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#3f8a64"/><stop offset="1" stop-color="#2a6046"/>
    </radialGradient>
    <linearGradient id="nut" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8f98a3"/><stop offset=".28" stop-color="#f6f8fa"/>
      <stop offset=".62" stop-color="#c3cad2"/><stop offset="1" stop-color="#7d8792"/>
    </linearGradient>
    <linearGradient id="cap" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eef1f4"/><stop offset=".55" stop-color="#b6bec7"/>
      <stop offset="1" stop-color="#8a939e"/>
    </linearGradient>
    <clipPath id="capclip"><path d="M8 122 C2 52 50 24 100 24 C150 24 198 52 192 122 C150 138 50 138 8 122 Z"/></clipPath>
    <pattern id="scales" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0 H26 M0 0 V26" stroke="#5d6772" stroke-width="3.2" fill="none"/>
    </pattern>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <ellipse cx="256" cy="470" rx="{95 * scale}" ry="{9 * scale}" fill="#000" opacity=".22"/>
  <g transform="translate({tx} {ty}) scale({s})" stroke="#46505b" stroke-width="5" stroke-linejoin="round">
    <path d="M14 114 C14 194 58 246 100 272 C142 246 186 194 186 114 Z" fill="url(#nut)"/>
    <path d="M40 130 C40 190 62 224 78 240" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="9" stroke-linecap="round"/>
    <path d="M8 122 C2 52 50 24 100 24 C150 24 198 52 192 122 C150 138 50 138 8 122 Z" fill="url(#cap)"/>
    <g clip-path="url(#capclip)" stroke="none"><rect width="200" height="150" fill="url(#scales)" opacity=".55"/></g>
    <path d="M8 122 C2 52 50 24 100 24 C150 24 198 52 192 122 C150 138 50 138 8 122 Z" fill="none"/>
    <path d="M88 26 C88 8 96 -6 110 -12 L120 -2 C112 4 112 14 112 26 Z" fill="url(#cap)"/>
  </g>
</svg>"""


CHROME = next(
    (p for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                 r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe") if os.path.exists(p)),
    None,
)


def render(svg, px):
    """Rasteriza el SVG con Chrome sin interfaz (PyMuPDF no soporta degradados ni patrones) a 512 y reduce."""
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as tmp:
        svg_path, png_path = os.path.join(tmp, "a.svg"), os.path.join(tmp, "a.png")
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
             "--window-size=512,512", f"--screenshot={png_path}", "file:///" + svg_path.replace("\\", "/")],
            check=True, capture_output=True, timeout=60,
        )
        im = Image.open(png_path).convert("RGB")
    if im.size != (512, 512):
        im = im.crop((0, 0, 512, 512))
    return im if px == 512 else im.resize((px, px), Image.LANCZOS)


ICON_JPG = os.path.join(os.path.dirname(HERE), "IconoApp.jpg")


def jpg_master():
    """Interior del cuadrado redondeado de IconoApp.jpg como cuadrado 1024 a sangre (sin esquinas crema)."""
    im = Image.open(ICON_JPG).convert("RGB")
    # Cuadrado redondeado medido sobre la imagen 1024x1024: x 123..900, y 125..895; se recorta 46 px hacia
    # dentro (>= 0,29 x radio de esquina ~150 px) para que ninguna esquina crema quede dentro del cuadrado.
    x0, y0, x1, y1 = 123 + 46, 125 + 46, 900 - 46, 895 - 46
    side = min(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    return im.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)).resize((1024, 1024), Image.LANCZOS)


def maskable_from(master, fill):
    """Master reducido a `fill` del lado, con el margen rellenado prolongando sus propios bordes (y suavizado):
    misma gama de color y sin costura visible entre el cuadrado y el margen."""
    import numpy as np
    n = round(512 * fill)
    m = (512 - n) // 2
    small = master.resize((n, n), Image.LANCZOS)
    arr = np.pad(np.asarray(small), ((m, 512 - n - m), (m, 512 - n - m), (0, 0)), mode="edge")
    bg = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(14))
    bg.paste(small, (m, m))
    return bg


os.makedirs(OUT, exist_ok=True)
if len(sys.argv) > 1 and sys.argv[1] == "silver":
    big = acorn_svg(0.78)
    render(big, 192).save(os.path.join(OUT, "icon-192.png"))
    render(big, 512).save(os.path.join(OUT, "icon-512.png"))
    render(acorn_svg(0.6), 512).save(os.path.join(OUT, "icon-maskable-512.png"))
    render(big, 180).save(os.path.join(OUT, "apple-touch-icon.png"))
    render(acorn_svg(0.86), 48).save(os.path.join(OUT, "favicon-48.png"))
else:
    m = jpg_master()
    for name, px in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180), ("favicon-48.png", 48)):
        m.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name))
    maskable_from(m, 0.8).save(os.path.join(OUT, "icon-maskable-512.png"))
# Sin favicon.svg: el icono es el mismo raster en todos los tamaños.
if os.path.exists(os.path.join(OUT, "favicon.svg")):
    os.remove(os.path.join(OUT, "favicon.svg"))
print("ok ->", OUT)

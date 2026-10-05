"""Caja de UNA PIEZA y SIN PEGAMENTO para las 378 cartas, para imprimir en un A3 de cartulina: la caja de
envío automontable clásica, de paredes laterales DOBLES (como la de la foto que pasó el usuario).

Las cartas van tumbadas en TRES montones de 126, uno al lado del otro. Es la única colocación con la que
este tipo de caja cabe en un A3: el lado que no cabía con las cartas en fila (2 x fondo + 2 x alto + solapa)
depende aquí del alto del montón. Exterior 198 x 92 x 42 mm (largo x fondo x alto). El alto sale de 126
cartas de ~0,31 mm (cartulina de 300 g) + holgura; si el taco real mide otra cosa, cambiar H.

Desarrollo (A3 apaisado, cara impresa hacia fuera): en vertical, solapa, tapa (con un ala a cada lado),
trasera y frente (cada uno con dos orejas) a los lados de la base; en horizontal, a cada lado de la base,
pared exterior, lomo, pared interior y dos pestañas que entran en dos cortes de la base. Queda a 5-6 mm del
borde del papel por arriba y por abajo: muy justo de márgenes.

Arte: la portada es img/Caja/Alternativa/front.jpg y CONTINÚA por el frente (el pliegue cae a la altura
de las patas de los tigres); trasera, la franja de selva con la serpiente que preparó el usuario
(img/Caja/Alternativa/Sin título.jpg); laterales, ilustraciones de las cartas del mismo estilo; base, el
pergamino con cinta, texto, iconos y abanico de build_caja.py. Solo castellano.

Escribe:
    pdf/es/caja_una_pieza_a3.pdf      pág. 1 = arte para imprimir, pág. 2 = guía de corte, pliegue y montaje
    img/Caja/una_pieza_a3.png         la página 1
    img/Caja/una_pieza_vista_previa.png   maqueta isométrica (no se imprime)

Versiones anteriores de este script (2026-10-05), descartadas por el usuario: un estuche con pestaña pegada
y una bandeja de pared sencilla con orejas de flecha (cartas en una fila, 126 x 92 x 67 mm).

Uso:  /c/Python310/python img/_work/build_caja_a3.py
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_caja as bc
from pdf_paths import pdf_path

mm = bc.mm
B = bc.BLEED
K = bc.PPI / 25.4                      # px por mm

L, D, H = 198.0, 92.0, 42.0            # exterior: largo (3 montones), fondo y alto
SPINE = 1.5                            # lomo de la pared doble (abraza las orejas)
INNER = H - 1.0                        # pared interior: 1 mm menos que la exterior, para que baje hasta el fondo
TAB = 4.0                              # pestañas de la pared interior
FLAP = 18.0                            # solapa delantera de la tapa (entra por dentro del frente)
WING = 34.0                            # alas de la tapa (entran por dentro de los laterales)
EAR = 36.0                             # orejas de frente y trasera (quedan dentro de la pared doble)
TABS_Y = ((15.0, 35.0), (57.0, 77.0))  # tramos de fondo que ocupan las dos pestañas
PAGE_W, PAGE_H = 420.0, 297.0          # A3 apaisado
XL = (PAGE_W - L) / 2
XR = XL + L
X0 = XL - H - SPINE - INNER - TAB      # borde izquierdo del desarrollo
Y0 = 5.0                               # el canto de la solapa (no lleva dibujo) va más pegado al borde que el del frente
YL0 = Y0 + FLAP                        # pliegue solapa / tapa
YL1 = YL0 + D                          # pliegue tapa / trasera
YB = YL1 + H                           # pliegue trasera / base
YF = YB + D                            # pliegue base / frente
YE = YF + H                            # canto superior del frente (abajo en el pliego)
PW, PH = mm(PAGE_W), mm(PAGE_H)
LINE = (38, 22, 10)
GREY = (110, 110, 110)

COVER = os.path.join(bc.IMG, "Caja", "Alternativa", "front.jpg")
COVER_ROWS = (36, 700)                 # filas de la portada que se reparten entre tapa y frente
SIDE_SCENES = (("tucan.jpg", 0.45), ("loros.jpg", 0.47))                                  # lateral izq. y dcho.
REAR = os.path.join(bc.IMG, "Caja", "Alternativa", "Sin título.jpg")                       # trasera (1024x239)

STEPS = [
    "Imprime en A3 al 100 % y recorta por la línea exterior. Abre con cúter los 4 cortes de la base.",
    "Marca los pliegues con regla y un boli sin tinta (coinciden con los cambios de dibujo) y dóblalos todos "
    "hacia atrás: lo impreso queda por fuera. Cada lateral lleva dos pliegues juntos: el lomo.",
    "Levanta la trasera y el frente, y dobla sus cuatro orejas hacia dentro, pegadas a los lados de la base.",
    "Levanta cada pared exterior, vuélcala por encima de las orejas y baja la pared interior hasta el fondo: "
    "sus dos pestañas entran en los cortes de la base. Las orejas quedan atrapadas dentro. Sin pegamento.",
    "Mete las cartas en tres montones. Para cerrar, las alas de la tapa van por dentro de los laterales y la "
    "solapa por dentro del frente.",
]


def polygons():
    """Piezas del desarrollo, en mm de página. Su unión es lo que se recorta."""
    p = {
        "tapa": [(XL, YL0), (XR, YL0), (XR, YL1), (XL, YL1)],
        "trasera": [(XL, YL1), (XR, YL1), (XR, YB), (XL, YB)],
        "base": [(XL, YB), (XR, YB), (XR, YF), (XL, YF)],
        "frente": [(XL, YF), (XR, YF), (XR, YE), (XL, YE)],
        "solapa": [(XL + 8, YL0), (XL + 8, YL0 - FLAP + 5), (XL + 13, YL0 - FLAP), (XR - 13, YL0 - FLAP),
                   (XR - 8, YL0 - FLAP + 5), (XR - 8, YL0)],
    }
    for k, (x, s) in enumerate(((XL, -1), (XR, 1))):
        xo, xs, xi = x + s * H, x + s * (H + SPINE), x + s * (H + SPINE + INNER)
        p[f"exterior_{k}"] = [(x, YB + 0.5), (xo, YB + 0.5), (xo, YF - 0.5), (x, YF - 0.5)]
        p[f"lomo_{k}"] = [(xo, YB + 0.5), (xs, YB + 0.5), (xs, YF - 0.5), (xo, YF - 0.5)]
        p[f"interior_{k}"] = [(xs, YB + 1.5), (xi, YB + 1.5), (xi, YF - 1.5), (xs, YF - 1.5)]
        for j, (a, b) in enumerate(TABS_Y):
            p[f"pestana_{k}{j}"] = [(xi, YB + a), (xi + s * TAB, YB + a + 1.5), (xi + s * TAB, YB + b - 1.5), (xi, YB + b)]
        p[f"ala_{k}"] = [(x, YL0 + 3), (x + s * (WING - 10), YL0 + 3), (x + s * WING, YL0 + 13),
                         (x + s * WING, YL1 - 15), (x + s * (WING - 10), YL1 - 3), (x, YL1 - 3)]
        for j, (ya, yb) in enumerate(((YL1 + 1, YB - 1), (YF + 1, YE - 1))):
            p[f"oreja_{k}{j}"] = [(x, ya), (x + s * (EAR - 4), ya), (x + s * EAR, ya + 4), (x + s * EAR, yb - 4),
                                  (x + s * (EAR - 4), yb), (x, yb)]
    return p


def slits():
    """Cortes de la base por donde entran las pestañas de las paredes interiores, como segmentos en mm."""
    return [((x, YB + a - 0.5), (x, YB + b + 0.5)) for x in (XL + SPINE, XR - SPINE) for a, b in TABS_Y]


def folds():
    """Pliegues como segmentos ((x0, y0), (x1, y1)) en mm."""
    out = [((XL + 8, YL0), (XR - 8, YL0)), ((XL, YL1), (XR, YL1)), ((XL, YB), (XR, YB)), ((XL, YF), (XR, YF))]
    for x, s in ((XL, -1), (XR, 1)):
        out += [((x, YB + 0.5), (x, YF - 0.5)), ((x, YL0 + 3), (x, YL1 - 3)),
                ((x, YL1 + 1), (x, YB - 1)), ((x, YF + 1), (x, YE - 1)),
                ((x + s * H, YB + 0.5), (x + s * H, YF - 0.5)), ((x + s * (H + SPINE), YB + 1.5), (x + s * (H + SPINE), YF - 1.5))]
    return out


def px(pts):
    return [(x * K, y * K) for x, y in pts]


def shape_mask():
    mask = Image.new("L", (PW, PH), 0)
    d = ImageDraw.Draw(mask)
    for pts in polygons().values():
        d.polygon(px(pts), fill=255)
    return np.asarray(mask) > 127


# ---------------------------------------------------------------- caras

_COVER = None
_PAD = 24


def cover_part(y_mm, h_mm):
    """Trozo de la portada, con sangrado: h_mm de alto a partir de y_mm (0 = canto trasero de la tapa).
    Tapa y frente salen de la misma imagen a la misma escala, así el dibujo continúa al doblar."""
    global _COVER
    if _COVER is None:
        src = np.asarray(Image.open(COVER).convert("RGB"))
        _COVER = Image.fromarray(np.pad(src, ((_PAD, _PAD), (_PAD, _PAD), (0, 0)), mode="reflect"))
    s = (COVER_ROWS[1] - COVER_ROWS[0]) / (D + H)                  # px de la imagen por mm
    x0 = _PAD + (_COVER.width - 2 * _PAD - L * s) / 2
    y0 = _PAD + COVER_ROWS[0] + y_mm * s
    box = (x0 - B * s, y0 - B * s, x0 + (L + B) * s, y0 + (h_mm + B) * s)
    im = _COVER.resize((mm(L + 2 * B), mm(h_mm + 2 * B)), Image.LANCZOS, box=box)
    return im.filter(ImageFilter.UnsharpMask(radius=2.5, percent=70, threshold=2))   # la portada va ampliada 2,4x


def scene(name, w_px, h_px, y_center):
    """Franja de una ilustración de carta (ancho completo), centrada en la fracción de altura y_center."""
    im = Image.open(os.path.join(bc.IMG, name)).convert("RGB")
    ch = im.width * h_px / w_px
    top = min(max(y_center * im.height - ch / 2, 0), im.height - ch)
    return im.resize((w_px, h_px), Image.LANCZOS, box=(0, top, im.width, top + ch))


def face_side(k):
    name, yc = SIDE_SCENES[k]
    return scene(name, mm(D + 2 * B), mm(H + 2 * B), yc)


def face_rear():
    """Trasera: la franja de selva que preparó el usuario, recortada al centro para cubrir la cara."""
    W, Hh = mm(L + 2 * B), mm(H + 2 * B)
    im = Image.open(REAR).convert("RGB")
    cw = min(im.width, im.height * W / Hh)
    ch = cw * Hh / W
    x, y = (im.width - cw) / 2, (im.height - ch) / 2
    im = im.resize((W, Hh), Image.LANCZOS, box=(x, y, x + cw, y + ch))
    return im.filter(ImageFilter.UnsharpMask(radius=2.5, percent=70, threshold=2))    # va ampliada 2,4x, como la portada


def paste_frame_wide(canvas, box_mm):
    """Marco de enredadera para una cara mucho más ancha que el marco: en vez de estirarlo (las flores
    saldrían ovaladas) va a su proporción, y el hueco del centro se rellena repitiendo su tramo central
    en espejo, que empalma solo."""
    x, y, w, h = box_mm
    f = bc.vine_frame()
    hn = mm(h)
    wn = round(f.width * hn / f.height)
    f = f.resize((wn, hn), Image.LANCZOS)
    wt = mm(w)
    m = (wt - wn) // 2                      # lo que mide el tramo central: 2a + m = wn, 2a + 3m = wt
    a = (wn - m) // 2
    left, mid, right = f.crop((0, 0, a, hn)), f.crop((a, 0, a + m, hn)), f.crop((a + m, 0, wn, hn))
    out = Image.new("RGBA", (a + 3 * m + right.width, hn), (0, 0, 0, 0))
    xx = 0
    for part in (left, mid, mid.transpose(Image.FLIP_LEFT_RIGHT), mid, right):
        out.paste(part, (xx, 0))
        xx += part.width
    canvas.alpha_composite(out.resize((wt, hn), Image.LANCZOS), (mm(x), mm(y)))


def face_base():
    """Base: pergamino con la cinta, el texto de presentación, el contenido, los iconos y un abanico."""
    W, Hh = bc.new_face(L, D)
    c = bc.parchment(W, Hh, 22).convert("RGBA")
    paste_frame_wide(c, (B + 3, B + 3, L - 6, D - 6))
    lx = B + 15
    rb = bc.ribbon(48)
    c.alpha_composite(rb, (mm(lx), mm(B + 11)))
    d = ImageDraw.Draw(c)
    f = bc.font(False, mm(3.5))
    y = mm(B + 11) + rb.height + mm(2.5)
    for ln in bc.wrap(bc.BLURB, f, mm(76), d):
        d.text((mm(lx), y), ln, font=f, fill=bc.INK + (255,))
        y += mm(4.4)
    d.text((mm(lx), y + mm(1.2)), bc.CONTENTS, font=bc.font(True, mm(3.6)), fill=bc.INK + (255,))
    yi = mm(B + D - 22)
    bc.paste_center(c, bc.players_icon(mm(13), bc.INK), mm(lx + 8), yi)
    bc.paste_time(c, mm(13), bc.INK, mm(lx + 28), yi)
    bc.paste_center(c, bc.age_icon(mm(11), bc.INK), mm(lx + 49), yi)
    bc.fan(c, bc.BACK_FAN, (mm(B + 147), mm(B + 80)), 26, [-30, -15, 0, 15, 30], 29)
    return c.convert("RGB")


# ---------------------------------------------------------------- páginas

def fold_ticks(d, color=LINE):
    """Marcas de pliegue en los márgenes, donde hay sitio fuera del dibujo."""
    w = max(2, mm(0.3))
    for y in (YL0, YL1, YB, YF):
        for x0, x1 in ((6, 14), (PAGE_W - 14, PAGE_W - 6)):
            d.line(px([(x0, y), (x1, y)]), fill=color, width=w)
    for x, s in ((XL, -1), (XR, 1)):
        d.line(px([(x, 7), (x, 16)]), fill=color, width=w)
        for xx in (x + s * H, x + s * (H + SPINE)):
            for y0, y1 in ((8, 18), (PAGE_H - 18, PAGE_H - 8)):
                d.line(px([(xx, y0), (xx, y1)]), fill=color, width=w)


def scale_bar(d, x, y, color):
    d.line(px([(x, y), (x + 50, y)]), fill=color, width=max(2, mm(0.3)))
    for t in (0, 50):
        d.line(px([(x + t, y - 1.5), (x + t, y + 1.5)]), fill=color, width=max(2, mm(0.3)))
    d.text(((x + 25) * K, (y + 3.4) * K), "50 mm (comprobar tras imprimir)", font=bc.font(False, mm(2.6)), fill=color, anchor="mm")


def page_art(faces):
    polys = polygons()
    inside = shape_mask()
    d_out = ndi.distance_transform_edt(~inside)
    d_in = ndi.distance_transform_edt(inside)
    bleed = d_out <= mm(B)

    wood = bc.wood(PW, PH, 4)
    art = wood.copy()
    placed = [("lid", XL, YL0, 180), ("rear", XL, YL1, 0), ("base", XL, YB, 0), ("front", XL, YF, 180),
              ("side0", XL - H, YB, 90), ("side1", XR, YB, -90)]
    # 1) cada cara CON su sangrado (el de los cantos libres es el que sobrevive); 2) solapa, alas, orejas,
    #    lomos, paredes interiores y pestañas en madera; 3) cada cara exacta encima
    for name, x, y, rot in placed:
        art.paste(faces[name].rotate(rot, expand=True), (mm(x - B), mm(y - B)))
    flaps = Image.new("L", (PW, PH), 0)
    df = ImageDraw.Draw(flaps)
    for key, pts in polys.items():
        if key.startswith(("solapa", "ala", "oreja", "lomo", "interior", "pestana")):
            df.polygon(px(pts), fill=255)
    art.paste(wood, (0, 0), flaps)
    b = mm(B)
    for name, x, y, rot in placed:
        f = faces[name].rotate(rot, expand=True)
        art.paste(f.crop((b, b, f.width - b, f.height - b)), (mm(x), mm(y)))

    page = Image.new("RGB", (PW, PH), "white")
    page.paste(art, (0, 0), Image.fromarray(((inside | bleed) * 255).astype(np.uint8)))
    cut = (d_out <= 2.0) & (d_in <= 2.0)            # línea de corte fina, sobre el canto exacto
    arr = np.asarray(page).copy()
    arr[cut] = LINE
    page = Image.fromarray(arr)
    d = ImageDraw.Draw(page)
    for seg in slits():
        d.line(px(seg), fill=(255, 250, 240), width=max(4, mm(0.45)))
        d.line(px(seg), fill=LINE, width=max(2, mm(0.2)))
    fold_ticks(d)
    # leyenda en el recorte sobrante de arriba a la izquierda
    x, y = 8 * K, 26 * K
    d.text((x, y), "Animals · caja de una pieza", font=bc.font(True, mm(3.2)), fill=GREY)
    y += mm(5)
    for ln in ("Sin pegamento · A3 al 100 %.", "Recortar por la línea y abrir", "los 4 cortes de la base.", "Doblar con lo impreso hacia",
               "fuera. Instrucciones: pág. 2."):
        d.text((x, y), ln, font=bc.font(False, mm(2.8)), fill=GREY)
        y += mm(3.9)
    scale_bar(d, 8, 62, GREY)
    return page


def dashed(d, p0, p1, color, width):
    (x0, y0), (x1, y1) = px([p0, p1])
    n = math.hypot(x1 - x0, y1 - y0)
    dash, gap = mm(2.4), mm(1.5)
    t = 0.0
    while t < n:
        a, b_ = t / n, min(t + dash, n) / n
        d.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b_, y0 + (y1 - y0) * b_)], fill=color, width=width)
        t += dash + gap


def page_guide():
    page = Image.new("RGB", (PW, PH), "white")
    d = ImageDraw.Draw(page)
    polys = polygons()
    tint = {"oreja": (255, 232, 200), "solapa": (228, 238, 250), "ala": (228, 238, 250),
            "interior": (236, 244, 232), "lomo": (236, 244, 232), "pestana": (255, 205, 205)}
    for key, pts in polys.items():
        fill = next((c for k, c in tint.items() if key.startswith(k)), (250, 247, 240))
        d.polygon(px(pts), fill=fill)
    inside = shape_mask()
    arr = np.asarray(page).copy()
    edge = (ndi.distance_transform_edt(~inside) <= 2.5) & (ndi.distance_transform_edt(inside) <= 2.5)
    arr[edge] = (0, 0, 0)
    page = Image.fromarray(arr)
    d = ImageDraw.Draw(page)
    red = (200, 40, 40)
    for p0, p1 in folds():
        dashed(d, p0, p1, red, max(2, mm(0.3)))
    for seg in slits():
        d.line(px(seg), fill=(0, 0, 0), width=max(5, mm(0.6)))
    fold_ticks(d, red)

    fb, fr, fs = bc.font(True, mm(5.0)), bc.font(False, mm(3.2)), bc.font(False, mm(2.8))

    def label(cx, cy, title, sub=None, f=fb, color=(40, 40, 40)):
        d.text((cx * K, cy * K), title, font=f, fill=color, anchor="mm")
        if sub:
            d.text((cx * K, (cy + 6) * K), sub, font=fr, fill=GREY, anchor="mm")

    def vlabel(cx, cy, text, f=fr, color=(40, 40, 40)):
        lab = Image.new("RGBA", (mm(86), mm(7)), (0, 0, 0, 0))
        ImageDraw.Draw(lab).text((lab.width / 2, lab.height / 2), text, font=f, fill=color, anchor="mm")
        lab = lab.rotate(90, expand=True)
        page.paste(lab, (round(cx * K - lab.width / 2), round(cy * K - lab.height / 2)), lab)

    cx, ym = (XL + XR) / 2, (YB + YF) / 2
    label(cx, YL1 + H / 2 - 3, "TRASERA", f"{L:g} × {H:g} mm")
    label(cx, YF + H / 2 - 3, "FRENTE", f"{L:g} × {H:g} mm")
    label(cx, YL0 - FLAP / 2, "solapa (entra por dentro del frente)", f=fr)
    for x, s in ((XL, -1), (XR, 1)):
        vlabel(x + s * H / 2, ym, "PARED EXTERIOR", f=bc.font(True, mm(4.0)))
        vlabel(x + s * (H + SPINE + INNER / 2), ym, "pared interior (queda dentro de la caja)")
        vlabel(x + s * (H + SPINE + INNER + TAB + 4), ym, "pestañas → cortes de la base", color=(170, 40, 40))
        label(x + s * WING / 2, (YL0 + YL1) / 2, "ala", f=fr)
        for y in (YL1 + H / 2, YF + H / 2):
            label(x + s * EAR / 2, y, "oreja", f=fr, color=(150, 80, 0))
    d = ImageDraw.Draw(page)
    # tapa: título, leyenda y medidas
    x, y = (XL + 8) * K, (YL0 + 8) * K
    d.text((x, y), "TAPA · caja de una pieza para las 378 cartas, sin pegamento", font=bc.font(True, mm(4.2)), fill=(40, 40, 40))
    y += mm(10)
    d.line([(x, y), (x + mm(14), y)], fill=(0, 0, 0), width=max(3, mm(0.4)))
    d.text((x + mm(17), y), "cortar (también los 4 cortes de la base)", font=fr, fill=(40, 40, 40), anchor="lm")
    y += mm(6)
    dashed(d, (XL + 8, y / K), (XL + 22, y / K), red, max(2, mm(0.3)))
    d.text((x + mm(17), y), "doblar hacia atrás (lo impreso, por fuera)", font=fr, fill=(40, 40, 40), anchor="lm")
    y += mm(9)
    for ln in (f"Exterior {L:g} × {D:g} × {H:g} mm (largo × fondo × alto). Las cartas van tumbadas, en tres montones de 126.",
               "126 cartas de 0,30–0,32 mm (cartulina de 300 g) hacen un montón de 38 a 40 mm.",
               "El desarrollo queda a 5–6 mm del borde del A3 por arriba y por abajo: imprimir sin márgenes o con los mínimos.",
               "Mejor en cartulina de 300–350 g."):
        d.text((x, y), ln, font=fs, fill=GREY)
        y += mm(4.0)
    scale_bar(d, XL + 8, (y / K) + 6, GREY)
    # base: montaje
    x, y, wmax = (XL + 8) * K, (YB + 6) * K, mm(L - 16)
    d.text((x, y), "BASE · montaje", font=bc.font(True, mm(4.2)), fill=(40, 40, 40))
    y += mm(6.8)
    for i, step in enumerate(STEPS, start=1):
        for ln in bc.wrap(f"{i}. {step}", fr, wmax, d):
            d.text((x, y), ln, font=fr, fill=(40, 40, 40))
            y += mm(4.3)
        y += mm(1.0)
    return page


def preview(top, longf, shortf, path):
    """Maqueta isométrica (como la de build_caja.py, a otra escala): tapa + frente + un lateral."""
    k = 2.6
    c30, s30 = math.cos(math.radians(30)), math.sin(math.radians(30))
    ax, ay, az = (c30 * k, s30 * k), (-c30 * k, s30 * k), (0, k)
    CW, CH = 900, 560
    P0 = (D * c30 * k + 60, 50)

    def add(p, v, m):
        return (p[0] + v[0] * m, p[1] + v[1] * m)

    P1, P3 = add(P0, ax, L), add(P0, ay, D)
    P2 = add(P1, ay, D)
    b = mm(B)
    trim = lambda im: im.crop((b, b, im.width - b, im.height - b))
    faces = [(trim(top), P0, P1, P3, 1.0), (trim(longf), P3, P2, add(P3, az, H), 0.82), (trim(shortf), P2, P1, add(P2, az, H), 0.64)]
    sc = 3
    canvas = Image.new("RGBA", (CW * sc, CH * sc), (0, 0, 0, 0))
    for im, o, u_end, v_end, shade in faces:
        coeffs = bc._affine_from_pts([(0, 0), (im.width, 0), (0, im.height)],
                                     [(o[0] * sc, o[1] * sc), (u_end[0] * sc, u_end[1] * sc), (v_end[0] * sc, v_end[1] * sc)])
        t = im.convert("RGBA").transform(canvas.size, Image.AFFINE, coeffs, resample=Image.BICUBIC)
        m = Image.new("L", canvas.size, 0)
        fourth = (u_end[0] + v_end[0] - o[0], u_end[1] + v_end[1] - o[1])
        ImageDraw.Draw(m).polygon([tuple(np.array(p) * sc) for p in (o, u_end, fourth, v_end)], fill=255)
        if shade < 1:
            t = Image.blend(t, Image.new("RGBA", t.size, (0, 0, 0, 255)), 1 - shade)
        t.putalpha(m)
        canvas.alpha_composite(t)
    bg = Image.new("RGBA", (CW, CH), (236, 231, 222, 255))
    bg.alpha_composite(canvas.resize((CW, CH), Image.LANCZOS))
    bc._save_safe(bg.convert("RGB"), path)


def main():
    faces = {"lid": cover_part(0, D), "front": cover_part(D, H), "rear": face_rear(), "base": face_base(),
             "side0": face_side(0), "side1": face_side(1)}
    art = page_art(faces)
    guide = page_guide()
    out = pdf_path("es", "caja_una_pieza_a3.pdf")
    art.save(out, save_all=True, append_images=[guide], resolution=float(bc.PPI))
    os.makedirs(bc.OUT, exist_ok=True)
    bc._save_safe(art, os.path.join(bc.OUT, "una_pieza_a3.png"))
    preview(faces["lid"], faces["front"], faces["side1"], os.path.join(bc.OUT, "una_pieza_vista_previa.png"))
    print(out, f"(2 paginas A3; desarrollo {XR + H + SPINE + INNER + TAB - X0:g} x {YE - Y0:g} mm, "
               f"margenes {X0:g} mm a los lados, {Y0:g} arriba y {PAGE_H - YE:g} abajo)")


if __name__ == "__main__":
    main()

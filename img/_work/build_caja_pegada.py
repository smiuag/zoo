"""Caja de UNA PIEZA PEGADA para las 243 cartas + un librillo de reglas de 16 páginas (A6), en cartulina gorda.

Misma caja de envío de paredes laterales dobles que build_caja_a3.py, pero pensada para PEGARSE: sin
pestañas de enganche, sin chaflanes ni rebajes (todas las solapas son rectángulos que cubren su cara entera) y
ya sin el límite del A3: el desarrollo cabe en un pliego SRA3 (450 x 320 mm).

Las cartas van tumbadas en TRES montones de 81 (uno al lado del otro) y encima, tumbado, el librillo A6
(148 x 105). Medidas (interior): largo 3 x 63,5 + holguras, fondo 107 (el A6 de canto), alto = 81 cartas de
~0,33 mm + librillo + margen. Cartulina supuesta: 0,5 mm (unos 350-400 g); si es otra, cambiar T.

Desarrollo (cara impresa hacia fuera): en vertical, solapa, tapa (con un ala a cada lado), trasera y frente
(cada uno con dos orejas) a los lados de la base; en horizontal, a cada lado de la base, pared exterior, lomo y
pared interior. Pegado: las orejas a la cara interior de la pared exterior, y la pared interior encima
(el lomo envuelve el grosor de las tres capas). La solapa de la tapa entra por dentro del frente (sin cortes).

Escribe:
    pdf/es/caja_pegada.pdf       pág. 1 = arte para imprimir, pág. 2 = reverso liso del tono de dentro
    img/Caja/pegada.png          la página 1
    img/Caja/pegada_vista_previa.png   maqueta isométrica (no se imprime)

Uso:  /c/Python310/python img/_work/build_caja_pegada.py
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

T = 0.5                                # grosor de la cartulina
CARD_W, CARD_H, CARD_T = 63.5, 88.9, 0.33
PILES, PILE_CARDS = 3, 81              # 243 cartas en 3 montones
BOOK_W, BOOK_H, BOOK_T = 148.0, 105.0, 2.0   # librillo A6 de 16 páginas (cubierta incluida)
SLACK_H = 4.0                          # aire por encima del librillo

LIN = PILES * CARD_W + 3.0 + 2 * T     # largo interior: montones + holgura + las alas de la tapa
DIN = max(BOOK_H, CARD_H) + 2.0        # fondo interior: lo manda el A6 de canto
HIN = PILE_CARDS * CARD_T + BOOK_T + SLACK_H     # alto interior libre

GAP = 0.0                              # sin separación entre piezas contiguas (0,5 hasta 2026-10-12): cantos a ras
L = round(LIN + 6 * T)                 # exterior: pared exterior + orejas + pared interior a cada lado
D = round(DIN + 2 * T)
H = round(HIN + T, 1)                  # alto de pared (desde la cara inferior de la base)
SPINE = 3 * T                          # lomo de la pared doble: abraza las tres capas
INNER = H - T - 0.5                    # pared interior: ancha completa; baja hasta la cara de la base
FLAP = 14.0                            # solapa delantera de la tapa (entra por dentro del frente)
WING = H - 1.5                         # alas de la tapa (bajan por dentro de las paredes laterales)
EAR = 30.0                             # orejas de frente y trasera (pegadas a la pared exterior)
PAGE_W, PAGE_H = 450.0, 320.0          # SRA3 apaisado
MARGIN = 1.0
XL = (PAGE_W - L) / 2
XR = XL + L
X0 = XL - H - SPINE - INNER            # borde izquierdo del desarrollo
Y0 = (PAGE_H - (FLAP + 2 * D + 2 * H)) / 2   # desarrollo centrado en vertical
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

def polygons():
    """Piezas del desarrollo, en mm de página. Su unión es lo que se recorta."""
    p = {
        "tapa": [(XL, YL0), (XR, YL0), (XR, YL1), (XL, YL1)],
        "trasera": [(XL, YL1), (XR, YL1), (XR, YB), (XL, YB)],
        "base": [(XL, YB), (XR, YB), (XR, YF), (XL, YF)],
        "frente": [(XL, YF), (XR, YF), (XR, YE), (XL, YE)],
        "solapa": [(XL + 4, YL0), (XL + 4, YL0 - FLAP), (XR - 4, YL0 - FLAP), (XR - 4, YL0)],
    }
    for k, (x, s) in enumerate(((XL, -1), (XR, 1))):
        xo, xs, xi = x + s * H, x + s * (H + SPINE), x + s * (H + SPINE + INNER)
        p[f"exterior_{k}"] = [(x, YB + GAP), (xo, YB + GAP), (xo, YF - GAP), (x, YF - GAP)]
        p[f"lomo_{k}"] = [(xo, YB + GAP), (xs, YB + GAP), (xs, YF - GAP), (xo, YF - GAP)]
        p[f"interior_{k}"] = [(xs, YB + T + GAP), (xi, YB + T + GAP), (xi, YF - T - GAP), (xs, YF - T - GAP)]
        p[f"ala_{k}"] = [(x, YL0 + T + GAP), (x + s * WING, YL0 + T + GAP), (x + s * WING, YL1 - T - GAP), (x, YL1 - T - GAP)]
        for j, (ya, yb) in enumerate(((YL1 + GAP, YB - GAP), (YF + GAP, YE - GAP))):
            p[f"oreja_{k}{j}"] = [(x, ya), (x + s * EAR, ya), (x + s * EAR, yb), (x, yb)]
    return p


def folds():
    """Pliegues como segmentos ((x0, y0), (x1, y1)) en mm."""
    out = [((XL + 4, YL0), (XR - 4, YL0)), ((XL, YL1), (XR, YL1)), ((XL, YB), (XR, YB)), ((XL, YF), (XR, YF))]
    for x, s in ((XL, -1), (XR, 1)):
        out += [((x, YB + GAP), (x, YF - GAP)), ((x, YL0 + T + GAP), (x, YL1 - T - GAP)),
                ((x, YL1 + GAP), (x, YB - GAP)), ((x, YF + GAP), (x, YE - GAP)),
                ((x + s * H, YB + GAP), (x + s * H, YF - GAP)),
                ((x + s * (H + SPINE), YB + T + GAP), (x + s * (H + SPINE), YF - T - GAP))]
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
    # (2026-10-12) izquierda: emblema completo de portada_viva + texto debajo; derecha: abanico con los
    # iconos de jugadores / tiempo / edad debajo
    lx = B + 15
    ex = bc.emblem(48)
    d = ImageDraw.Draw(c)
    f = bc.font(False, mm(3.5))
    f2 = bc.font(True, mm(3.6))
    lines = bc.wrap(bc.BLURB, f, mm(76), d)
    text_w = max([d.textlength(ln, font=f) for ln in lines] + [d.textlength(bc.CONTENTS, font=f2)])
    c.alpha_composite(ex, (round(mm(lx) + text_w / 2 - ex.width / 2), mm(B + 17)))   # centrado sobre el texto, 1 cm más abajo
    y = mm(B + 17) + ex.height + mm(2.5)
    for ln in lines:
        d.text((mm(lx), y), ln, font=f, fill=bc.INK + (255,))
        y += mm(4.4)
    d.text((mm(lx), y + mm(1.2)), bc.CONTENTS, font=f2, fill=bc.INK + (255,))
    bc.fan(c, bc.BACK_FAN, (mm(B + L - 55), mm(B + D - 40)), 26, [-30, -15, 0, 15, 30], 28)
    yi = mm(B + D - 24)
    cx = mm(B + L - 55)
    bc.paste_center(c, bc.players_icon(mm(13), bc.INK), cx - mm(21), yi)
    bc.paste_time(c, mm(13), bc.INK, cx, yi)
    bc.paste_center(c, bc.age_icon(mm(11), bc.INK), cx + mm(21), yi)
    return c.convert("RGB")


# ---------------------------------------------------------------- páginas

def fold_ticks(d, color=LINE, d_out=None):
    """Marcas de pliegue en los márgenes, solo donde hay sitio: con el desarrollo tan ajustado al papel, una
    marca que quedaría pegada a una pieza (a menos de 3 mm) se omite."""
    w = max(2, mm(0.3))

    def free(x0, y0, x1, y1):
        if d_out is None:
            return True
        n = 8
        for t in range(n + 1):
            x, y = x0 + (x1 - x0) * t / n, y0 + (y1 - y0) * t / n
            if d_out[min(int(y * K), PH - 1), min(int(x * K), PW - 1)] < mm(3):
                return False
        return True

    segs = [((x0, y), (x1, y)) for y in (YL0, YL1, YB, YF) for x0, x1 in ((6, 14), (PAGE_W - 14, PAGE_W - 6))]
    for x, s in ((XL, -1), (XR, 1)):
        segs.append(((x, 7), (x, 16)))
        for xx in (x + s * H, x + s * (H + SPINE)):
            segs += [((xx, 8), (xx, 18)), ((xx, PAGE_H - 18), (xx, PAGE_H - 8))]
    for (x0, y0), (x1, y1) in segs:
        if free(x0, y0, x1, y1):
            d.line(px([(x0, y0), (x1, y1)]), fill=color, width=w)


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
    #    lomos y paredes interiores en madera; 3) cada cara exacta encima
    for name, x, y, rot in placed:
        art.paste(faces[name].rotate(rot, expand=True), (mm(x - B), mm(y - B)))
    flaps = Image.new("L", (PW, PH), 0)
    df = ImageDraw.Draw(flaps)
    for key, pts in polys.items():
        if key.startswith(("solapa", "ala", "oreja", "lomo", "interior")):
            df.polygon(px(pts), fill=255)
    art.paste(wood, (0, 0), flaps)
    b = mm(B)
    for name, x, y, rot in placed:
        f = faces[name].rotate(rot, expand=True)
        art.paste(f.crop((b, b, f.width - b, f.height - b)), (mm(x), mm(y)))

    # (2026-10-12) el sangrado que cae en un rincón entre dos piezas (p. ej. entre la pared lateral y la
    # oreja, que es 3 mm más corta) iba con el dibujo de la pared prolongado y parecía un trozo suelto:
    # ahí va en madera. Se detecta como sangrado a menos de B de dos piezas distintas.
    # (2026-10-12) Sangrado por piezas, rectangular (todas las piezas son rectángulos): cada pieza se
    # amplía B mm por cada lado. Un píxel de sangrado lleva el dibujo de una cara ilustrada solo si cae
    # en la ampliación de esa cara y de NINGUNA otra pieza (con 1 mm extra de respeto); el resto del
    # sangrado (rincones entre piezas, esquinas, solapas) va en madera. Antes el sangrado era una banda
    # a distancia B de la silueta (esquinas redondeadas) y en los rincones asomaban tiras de dibujo.
    def rect_mask(pts, grow):
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        m = np.zeros((PH, PW), bool)
        m[max(mm(min(ys) - grow), 0):mm(max(ys) + grow), max(mm(min(xs) - grow), 0):mm(max(xs) + grow)] = True
        return m
    illustrated = [k for k in polys if k in ("tapa", "trasera", "base", "frente") or k.startswith("exterior")]
    bleed = np.zeros((PH, PW), bool)
    for pts in polys.values():
        bleed |= rect_mask(pts, B)
    # Cada cara ilustrada tiene 4 tiras de sangrado (una por canto, del ancho exacto del canto). Una tira
    # lleva el dibujo salvo donde la pisa otra pieza: se descuentan, ampliadas B+1 mm, solo las piezas que
    # tocan esa tira (la oreja encima de la pared tapa su tira superior y el rincón de al lado; la oreja
    # al LADO del frente no toca la tira inferior del frente, y el dibujo sigue hasta la esquina).
    def strips(pts):
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        return [[(x0, y0 - B), (x1, y0)], [(x0, y1), (x1, y1 + B)],
                [(x0 - B, y0), (x0, y1)], [(x1, y0), (x1 + B, y1)]]
    drawn = np.zeros((PH, PW), bool)
    for key in illustrated:
        for (sx0, sy0), (sx1, sy1) in strips(polys[key]):
            strip = rect_mask([(sx0, sy0), (sx1, sy1)], 0)
            for k2, pts in polys.items():
                if k2 != key and (strip & rect_mask(pts, 0)).any():
                    strip &= ~rect_mask(pts, B + 1)
            drawn |= strip
    pocket = bleed & ~inside & ~drawn
    art.paste(wood, (0, 0), Image.fromarray((pocket * 255).astype(np.uint8)))
    page = Image.new("RGB", (PW, PH), "white")
    page.paste(art, (0, 0), Image.fromarray(((inside | bleed) * 255).astype(np.uint8)))
    # (2026-10-12) sin línea de corte sobre el canto: el arte llega hasta el final de cada pieza y el
    # sangrado de B mm sigue más allá; para cortar valen las marcas de pliegue de los márgenes.
    d = ImageDraw.Draw(page)
    fold_ticks(d, d_out=d_out)
    # leyenda en el recorte sobrante de arriba a la izquierda
    x, y = 8 * K, 26 * K
    d.text((x, y), "Animals · caja de una pieza (pegada)", font=bc.font(True, mm(3.2)), fill=GREY)
    y += mm(5)
    for ln in ("SRA3 (450 x 320) al 100 %.", "Recortar por la línea. Doblar con", "lo impreso hacia fuera.", "Pegar orejas y paredes interiores.", "Reverso: imprimir a doble cara."):
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


def page_back():
    """Reverso liso, del mismo tono que las piezas interiores (la madera de page_art): a doble cara, al
    doblar queda por dentro de la caja. Sin dibujo ni marcas: da igual cómo se voltee la hoja."""
    return bc.wood(PW, PH, 4).convert("RGB")


def main():
    faces = {"lid": cover_part(0, D), "front": cover_part(D, H), "rear": face_rear(), "base": face_base(),
             "side0": face_side(0), "side1": face_side(1)}
    art = page_art(faces)
    back = page_back()
    out = pdf_path("es", "caja_pegada.pdf")
    art.save(out, save_all=True, append_images=[back], resolution=float(bc.PPI))
    os.makedirs(bc.OUT, exist_ok=True)
    bc._save_safe(art, os.path.join(bc.OUT, "pegada.png"))
    preview(faces["lid"], faces["front"], faces["side1"], os.path.join(bc.OUT, "pegada_vista_previa.png"))
    print(out, f"(2 paginas SRA3; caja exterior {L:g} x {D:g} x {H + T:g} mm; interior {LIN:g} x {DIN:g} x {HIN:g}; desarrollo {XR + H + SPINE + INNER - X0:g} x {YE - Y0:g} mm, "
               f"margenes {X0:g} mm a los lados, {Y0:g} arriba y {PAGE_H - YE:g} abajo)")


if __name__ == "__main__":
    main()

"""Caja de UNA PIEZA y SIN PEGAMENTO para las 378 cartas, para imprimir en un A3 de cartulina: la caja de
envío automontable clásica, de paredes laterales DOBLES (como la de la foto que pasó el usuario).

Las cartas van tumbadas en TRES montones de 126, uno al lado del otro. Es la única colocación con la que
este tipo de caja cabe en un A3: el lado que no cabía con las cartas en fila (2 x fondo + 2 x alto + solapa)
depende aquí del alto del montón. Exterior 203 x 91 x 52 mm (largo x fondo x alto). El alto sale de 126
cartas de ~0,31 mm (cartulina de 300 g) + holgura; si el taco real mide otra cosa, cambiar H.
(2026-10-07: el primer prototipo, 198 x 92 x 42, se quedó corto al montarlo: +5 mm de largo y +10 de alto. El
alto cuenta dos veces en la hoja, así que para seguir en A3 con 1 mm de margen se acortaron la solapa (18 -> 9)
y el fondo (92 -> 91) y se quitaron las pestañas de las paredes interiores y los cortes de la base.)

Desarrollo (A3 apaisado, cara impresa hacia fuera): en vertical, solapa, tapa (con un ala a cada lado),
trasera y frente (cada uno con dos orejas) a los lados de la base; en horizontal, a cada lado de la base,
pared exterior, lomo y pared interior. Queda centrado, con 1 mm de margen por arriba y por abajo y 4 mm
a los lados.

Arte: la portada es img/Caja/Alternativa/front.jpg y CONTINÚA por el frente (el pliegue cae a la altura
de las patas de los tigres); trasera, la franja de selva con la serpiente que preparó el usuario
(img/Caja/Alternativa/Sin título.jpg); laterales, ilustraciones de las cartas del mismo estilo; base, el
pergamino con cinta, texto, iconos y abanico de build_caja.py. Solo castellano.

Escribe:
    pdf/es/caja_una_pieza_a3.pdf      pág. 1 = arte para imprimir, pág. 2 = reverso liso del tono de dentro (a doble cara)
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

L, D, H = 203.0, 91.0, 52.0            # exterior: largo (3 montones), fondo y alto
SPINE = 1.5                            # lomo de la pared doble (abraza las orejas)
INNER = H - 1.0                        # pared interior: 1 mm menos que la exterior, para que baje hasta el fondo
FLAP = 9.0                             # solapa delantera de la tapa (entra por dentro del frente)
WING = 34.0                            # alas de la tapa (entran por dentro de los laterales)
EAR = 36.0                             # orejas de frente y trasera (quedan dentro de la pared doble)
PAGE_W, PAGE_H = 420.0, 297.0          # A3 apaisado
MARGIN = 1.0                           # margen de la impresora
XL = (PAGE_W - L) / 2
XR = XL + L
X0 = XL - H - SPINE - INNER            # borde izquierdo del desarrollo
Y0 = (PAGE_H - (FLAP + 2 * D + 2 * H)) / 2   # desarrollo centrado en vertical (con 1 mm de margen, justo)
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
        "solapa": [(XL + 8, YL0), (XL + 8, YL0 - FLAP + 5), (XL + 13, YL0 - FLAP), (XR - 13, YL0 - FLAP),
                   (XR - 8, YL0 - FLAP + 5), (XR - 8, YL0)],
    }
    for k, (x, s) in enumerate(((XL, -1), (XR, 1))):
        xo, xs, xi = x + s * H, x + s * (H + SPINE), x + s * (H + SPINE + INNER)
        p[f"exterior_{k}"] = [(x, YB + 0.5), (xo, YB + 0.5), (xo, YF - 0.5), (x, YF - 0.5)]
        p[f"lomo_{k}"] = [(xo, YB + 0.5), (xs, YB + 0.5), (xs, YF - 0.5), (xo, YF - 0.5)]
        p[f"interior_{k}"] = [(xs, YB + 1.5), (xi, YB + 1.5), (xi, YF - 1.5), (xs, YF - 1.5)]
        p[f"ala_{k}"] = [(x, YL0 + 3), (x + s * (WING - 10), YL0 + 3), (x + s * WING, YL0 + 13),
                         (x + s * WING, YL1 - 15), (x + s * (WING - 10), YL1 - 3), (x, YL1 - 3)]
        for j, (ya, yb) in enumerate(((YL1 + 1, YB - 1), (YF + 1, YE - 1))):
            p[f"oreja_{k}{j}"] = [(x, ya), (x + s * (EAR - 4), ya), (x + s * EAR, ya + 4), (x + s * EAR, yb - 4),
                                  (x + s * (EAR - 4), yb), (x, yb)]
    return p


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

    page = Image.new("RGB", (PW, PH), "white")
    page.paste(art, (0, 0), Image.fromarray(((inside | bleed) * 255).astype(np.uint8)))
    cut = (d_out <= 2.0) & (d_in <= 2.0)            # línea de corte fina, sobre el canto exacto
    arr = np.asarray(page).copy()
    arr[cut] = LINE
    page = Image.fromarray(arr)
    d = ImageDraw.Draw(page)
    fold_ticks(d, d_out=d_out)
    # leyenda en el recorte sobrante de arriba a la izquierda
    x, y = 8 * K, 26 * K
    d.text((x, y), "Animals · caja de una pieza", font=bc.font(True, mm(3.2)), fill=GREY)
    y += mm(5)
    for ln in ("Sin pegamento · A3 al 100 %.", "Recortar por la línea. Doblar con", "lo impreso hacia fuera.", "Reverso: imprimir a doble cara."):
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
    out = pdf_path("es", "caja_una_pieza_a3.pdf")
    art.save(out, save_all=True, append_images=[back], resolution=float(bc.PPI))
    os.makedirs(bc.OUT, exist_ok=True)
    bc._save_safe(art, os.path.join(bc.OUT, "una_pieza_a3.png"))
    preview(faces["lid"], faces["front"], faces["side1"], os.path.join(bc.OUT, "una_pieza_vista_previa.png"))
    print(out, f"(2 paginas A3; desarrollo {XR + H + SPINE + INNER - X0:g} x {YE - Y0:g} mm, "
               f"margenes {X0:g} mm a los lados, {Y0:g} arriba y {PAGE_H - YE:g} abajo)")


if __name__ == "__main__":
    main()

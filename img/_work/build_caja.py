"""Compone las caras impresas de la caja de la edición clásica (img/Caja/).

Caja de 2 filas de cartas, medidas EXTERIORES 140 x 97 x 73 mm (ancho x fondo x alto), con hueco
para el librillo A7 encima de los dos montones. Ver la conversación del 2026-09-28 para el
cálculo (378 cartas de ~0,31 mm, montones de 189 = ~59 mm).

Sale una imagen por cara, a 300 ppp y con 3 mm de sangrado por cada lado (el corte real queda a
3 mm del borde de la imagen):

    01_tapa.png             140 x 97   cara superior (portada)
    02_reverso.png          140 x 97   cara inferior (contenido, iconos)
    03_lateral_largo.png    140 x 73   se usa DOS veces (delante y detrás)
    04_lateral_corto.png     97 x 73   se usa DOS veces (izquierda y derecha)
    vista_previa.png        maqueta isométrica para revisar (no se imprime)

Si la imprenta usa tapa + fondo en vez de un bloque, sus caras salen de estas mismas (la línea de
corte entre tapa y fondo cae sobre los laterales) — pedir su plantilla antes de cortar nada.

Todo el arte sale de lo que ya hay: emblema (portada_viva.png), marco de enredadera (back.jpg),
pergamino (fondo_pergamino_a4.jpg), cartas (img/cards) y la fuente Baloo. Iconos de jugadores, duración y
edad dibujados aquí. Sin texto en inglés: la caja es solo en castellano.

Uso:  /c/Python310/python img/_work/build_caja.py [--debug]
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.join(IMG, "Caja")
FONTS = os.path.join(HERE, "fonts")

PPI = 300
BLEED = 3  # mm por lado


def mm(v):
    return int(round(v * PPI / 25.4))


BOX_W, BOX_D, BOX_H = 140, 97, 73

BROWN = (116, 69, 45)      # el marrón del borde de las cartas
CREAM = (244, 234, 215)    # el de la banda del reglamento
INK = (74, 44, 23)

PLAYERS_TXT = "2–7"
AGE_TXT = "10+"
TIME_TXT = "30–60 min"
TIME_SUB = ""
BLURB = ("Invita a los animales a tu reserva a cambio de bellotas, aprovecha sus habilidades "
         "y reúne la colección que sume más puntos de victoria.")
CONTENTS = "378 cartas + reglamento"

# Cartas que salen en abanico (de atrás hacia delante) en cada cara.
TOP_LEFT = ["giraffe", "tiger", "elephant"]
TOP_RIGHT = ["penguin", "shark", "toucan"]
BACK_FAN = ["sloth", "coin-5", "dolphin", "parrot", "lion"]


def font(bold, size):
    name = "Baloo2-ExtraBold.ttf" if bold else "Baloo2-Regular.ttf"
    return ImageFont.truetype(os.path.join(FONTS, name), size)


# ---------------------------------------------------------------- fondos

_PERG = None


def parchment(w, h, seed):
    global _PERG
    if _PERG is None:
        _PERG = Image.open(os.path.join(IMG, "fondo_pergamino_a4.jpg")).convert("RGB")
    rng = np.random.default_rng(seed)
    x = int(rng.integers(0, _PERG.width - w))
    y = int(rng.integers(0, _PERG.height - h))
    return _PERG.crop((x, y, x + w, y + h))


def wood(w, h, seed=3):
    """Madera marrón procedural, veta horizontal. Se genera a 1/4 y se amplía (los filtros
    gaussianos largos a tamaño completo tardan una eternidad)."""
    rng = np.random.default_rng(seed)
    sw, sh = w // 4 + 1, h // 4 + 1
    n = np.zeros((sh, sw))
    for sx, sy, amp in ((70, 1.0, 1.0), (25, 0.7, 0.6), (150, 3.0, 0.8), (8, 0.5, 0.3)):
        r = ndi.gaussian_filter(rng.standard_normal((sh, sw)), (sy, sx), mode="wrap")
        n += amp * r / r.std()
    n /= n.std()
    n = np.asarray(Image.fromarray(n.astype(np.float32)).resize((w, h), Image.BICUBIC))
    fine = ndi.gaussian_filter(rng.standard_normal((h, w)), (0.6, 5.0))
    fine /= fine.std()
    lum = 1.0 + 0.075 * n + 0.03 * fine
    rgb = np.array(BROWN, dtype=float)[None, None, :] * lum[..., None]
    # un pelín más oscuro hacia los bordes
    yy, xx = np.mgrid[0:h, 0:w]
    vign = 1 - 0.10 * (((xx / w - 0.5) * 2) ** 2 + ((yy / h - 0.5) * 2) ** 2) / 2
    rgb *= vign[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------- marco de enredadera

# Punto de back.jpg (1024x1024) dentro del emblema central (la melena del león): la pieza
# conexa que lo contiene se descarta al sacar el marco.
EMBLEM_POINT = (450, 500)
_FRAME = None


def vine_frame():
    """Marco de enredadera de back.jpg como RGBA sin fondo, girado 90 grados (apaisado)."""
    global _FRAME
    if _FRAME is not None:
        return _FRAME
    src = np.asarray(Image.open(os.path.join(IMG, "back.jpg")).convert("RGB")).astype(float)
    grey = src.mean(axis=2)
    # fondo estimado: el cierre en gris borra lo oscuro fino (enredadera, hojas, flores)
    bg_grey = ndi.gaussian_filter(ndi.grey_closing(grey, size=(33, 33)), 12)
    d = bg_grey - grey
    alpha = np.clip((d - 18.0) / 45.0, 0, 1)
    # el moteado del pergamino también oscurece un poco: se conservan solo las manchas grandes
    # y conectadas (la enredadera es una sola pieza; las motas sueltas no), y se descarta la
    # pieza del emblema central, que es la que contiene el punto (450, 500)
    lab, n = ndi.label(ndi.binary_dilation(alpha > 0.3, iterations=2), structure=np.ones((3, 3)))
    sizes = ndi.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    big = 1 + np.flatnonzero(sizes > 6000)
    keep = np.isin(lab, big) & (lab != lab[EMBLEM_POINT[1], EMBLEM_POINT[0]])
    alpha *= keep
    # fuera del marco (las esquinas de la hoja) tampoco hay nada que conservar
    alpha[:30, :] = 0
    alpha[990:, :] = 0
    alpha[:, :150] = 0
    alpha[:, 880:] = 0
    # quita el color del fondo viejo en los bordes de las hojas
    bg_rgb = np.stack([ndi.gaussian_filter(ndi.grey_closing(src[..., c], size=(33, 33)), 12)
                       for c in range(3)], axis=2)
    a3 = np.maximum(alpha, 0.05)[..., None]
    fg = np.clip((src - (1 - alpha[..., None]) * bg_rgb) / a3, 0, 255)
    ys, xs = np.where(alpha > 0.25)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    rgba = np.dstack([fg, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA").crop(box).rotate(90, expand=True)
    _FRAME = im
    return im


def paste_frame(canvas, box_mm):
    """Pega el marco estirado a box_mm = (x, y, w, h) en mm sobre el lienzo (con sangrado)."""
    x, y, w, h = box_mm
    f = vine_frame().resize((mm(w), mm(h)), Image.LANCZOS)
    canvas.alpha_composite(f, (mm(x), mm(y)))


# ---------------------------------------------------------------- emblema y cartas

_EMB = None


def emblem(h_mm, glow=True):
    global _EMB
    if _EMB is None:
        _EMB = Image.open(os.path.join(IMG, "portada_viva.png")).convert("RGBA")
    h = mm(h_mm)
    w = round(_EMB.width * h / _EMB.height)
    return _EMB.resize((w, h), Image.LANCZOS)


def ribbon(w_mm):
    """Solo la cinta ANIMALS del emblema, recortada por el arco superior (sin el follaje)."""
    global _EMB
    emblem(10)
    x0, y0, x1, y1 = 60, 640, 760, 910   # medido sobre portada_viva.png (885x924)
    r = _EMB.crop((x0, y0, x1, y1))
    mask = Image.new("L", r.size, 0)
    pts = [(x - x0, 644 + 44 * ((x - 410) / 335) ** 2 - y0) for x in range(x0, x1 + 1, 5)]
    ImageDraw.Draw(mask).polygon(pts + [(r.width, r.height), (0, r.height)], fill=255)
    r.putalpha(ImageChops.multiply(r.getchannel("A"), mask.filter(ImageFilter.GaussianBlur(1.2))))
    h = round(r.height * mm(w_mm) / r.width)
    return r.resize((mm(w_mm), h), Image.LANCZOS)


def card_rgba(name, w_mm):
    """Carta recortada por su línea de corte real (750x1050 centrada en el PNG; el resto es
    sangrado), con las esquinas redondas transparentes. Antes se quitaba el marrón liso del
    sangrado por inundación desde fuera, pero el marco actual (template4) lleva la banda
    marrón PINTADA hasta el canto y la inundación se la comía a trozos."""
    im = Image.open(os.path.join(IMG, "cards", name + ".png")).convert("RGB")
    cw, ch, radius = 750, 1050, 46
    x0, y0 = (im.width - cw) // 2, (im.height - ch) // 2
    im = im.crop((x0, y0, x0 + cw, y0 + ch)).convert("RGBA")
    mask = Image.new("L", (cw * 4, ch * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw * 4 - 1, ch * 4 - 1), radius=radius * 4, fill=255)
    im.putalpha(mask.resize((cw, ch), Image.LANCZOS))
    w = mm(w_mm)
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def shadow_of(im, blur, opacity, color=(40, 22, 10)):
    a = im.getchannel("A").point(lambda v: int(v * opacity))
    sh = Image.new("RGBA", im.size, color + (0,))
    sh.putalpha(a)
    pad = blur * 3
    big = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), color + (0,))
    big.paste(sh, (pad, pad))
    return big.filter(ImageFilter.GaussianBlur(blur)), pad


def paste_rotated(canvas, im, angle, cx, cy, shadow=True):
    """Pega im girada `angle` grados (antihorario) centrada en (cx, cy) px, con sombra."""
    r = im.rotate(angle, expand=True, resample=Image.BICUBIC)
    x, y = round(cx - r.width / 2), round(cy - r.height / 2)
    if shadow:
        sh, pad = shadow_of(r, mm(1.1), 0.55)
        canvas.alpha_composite(sh, (x - pad + mm(0.6), y - pad + mm(0.9)))
    canvas.alpha_composite(r, (x, y))


def fan(canvas, names, pivot, card_w_mm, angles, radius_mm):
    """Abanico de cartas (la última va delante). Cada carta se coloca a `radius_mm` del pivote
    en la dirección `angle`, girada ese mismo ángulo."""
    px, py = pivot
    for name, ang in zip(names, angles):
        c = card_rgba(name, card_w_mm)
        cx = px + math.sin(math.radians(ang)) * mm(radius_mm)
        cy = py - math.cos(math.radians(ang)) * mm(radius_mm)
        paste_rotated(canvas, c, -ang, cx, cy)


# ---------------------------------------------------------------- iconos

S = 4  # supermuestreo


def _person(d, cx, base, head_r, body_w, body_h, fill):
    d.ellipse((cx - head_r, base - body_h - head_r * 2.35, cx + head_r, base - body_h - head_r * 0.35),
              fill=fill)
    d.rounded_rectangle((cx - body_w / 2, base - body_h, cx + body_w / 2, base),
                        radius=body_w / 2.2, corners=(True, True, False, False), fill=fill)


def players_icon(h_px, color):
    """Tres siluetas (la del centro delante) + '2-7' debajo."""
    H = h_px * S
    W = int(H * 0.95)
    icon_h = H * 0.62
    layer_back = Image.new("L", (W, H), 0)
    layer_front = Image.new("L", (W, H), 0)
    db, df = ImageDraw.Draw(layer_back), ImageDraw.Draw(layer_front)
    u = icon_h / 100.0
    base = icon_h
    cx = W / 2
    # atrás: dos figuras más pequeñas a los lados
    for sgn in (-1, 1):
        _person(db, cx + sgn * 36 * u, base, 12 * u, 36 * u, 34 * u, 255)
    _person(df, cx, base, 16 * u, 48 * u, 44 * u, 255)
    gap = layer_front.filter(ImageFilter.MaxFilter(1 + 2 * int(3.5 * u)))
    back = ImageChops.subtract(layer_back, gap)
    icon = ImageChops.lighter(back.point(lambda v: int(v * 0.72)), layer_front)
    out = Image.new("RGBA", (W, H), color + (0,))
    out.putalpha(icon)
    d = ImageDraw.Draw(out)
    f = font(True, int(H * 0.38))
    tw = d.textlength(PLAYERS_TXT, font=f)
    d.text(((W - tw) / 2, H * 0.60), PLAYERS_TXT, font=f, fill=color + (255,))
    return out.resize((W // S, H // S), Image.LANCZOS)


def age_icon(d_px, color):
    """Círculo con '10+' dentro."""
    D = d_px * S
    out = Image.new("RGBA", (D, D), color + (0,))
    d = ImageDraw.Draw(out)
    t = D * 0.07
    d.ellipse((t / 2, t / 2, D - t / 2, D - t / 2), outline=color + (255,), width=int(t))
    f = font(True, int(D * 0.44))
    tw = d.textlength(AGE_TXT, font=f)
    bbox = d.textbbox((0, 0), AGE_TXT, font=f)
    th = bbox[3] - bbox[1]
    d.text(((D - tw) / 2 - bbox[0] * 0, (D - th) / 2 - bbox[1]), AGE_TXT, font=f, fill=color + (255,))
    return out.resize((D // S, D // S), Image.LANCZOS)


def time_icon(h_px, color):
    """Reloj (círculo con agujas) + duración debajo (y TIME_SUB si lo hay); mismo arranque que players_icon."""
    H = h_px * S
    W = int(H * 1.6)
    out = Image.new("RGBA", (W, int(H * 1.16)), color + (0,))
    d = ImageDraw.Draw(out)
    D = H * 0.60
    cx, cy = W / 2, D / 2 + H * 0.01
    t = D * 0.09
    d.ellipse((cx - D / 2 + t / 2, cy - D / 2 + t / 2, cx + D / 2 - t / 2, cy + D / 2 - t / 2),
              outline=color + (255,), width=int(t))
    # agujas: minutero a las 12 y horario a las 4 (10 min ~ un cuarto de vuelta larga)
    r = D / 2
    d.line((cx, cy, cx, cy - r * 0.62), fill=color + (255,), width=int(t * 0.9))
    d.line((cx, cy, cx + r * 0.40, cy + r * 0.24), fill=color + (255,), width=int(t * 0.9))
    d.ellipse((cx - t * 0.7, cy - t * 0.7, cx + t * 0.7, cy + t * 0.7), fill=color + (255,))
    f1, f2 = font(True, int(H * 0.235)), font(False, int(H * 0.15))
    w1 = d.textlength(TIME_TXT, font=f1)
    d.text(((W - w1) / 2, H * 0.635), TIME_TXT, font=f1, fill=color + (255,))
    if TIME_SUB:
        w2 = d.textlength(TIME_SUB, font=f2)
        d.text(((W - w2) / 2, H * 0.635 + H * 0.235 * 1.25), TIME_SUB, font=f2, fill=color + (255,))
    return out.resize((W // S, out.height // S), Image.LANCZOS)


def paste_time(canvas, h_px, color, cx, cy):
    """Como paste_center con players_icon(h_px) en (cx, cy): alinea por arriba el reloj, que es
    más alto por la segunda línea de texto."""
    im = time_icon(h_px, color)
    canvas.alpha_composite(im, (round(cx - im.width / 2), round(cy - h_px / 2)))


def paste_center(canvas, im, cx, cy):
    canvas.alpha_composite(im, (round(cx - im.width / 2), round(cy - im.height / 2)))


def wrap(text, f, max_w, d):
    lines, cur = [], ""
    for word in text.split():
        t = (cur + " " + word).strip()
        if d.textlength(t, font=f) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    return lines


# ---------------------------------------------------------------- caras

def new_face(w_mm, h_mm):
    return (mm(w_mm + 2 * BLEED), mm(h_mm + 2 * BLEED))


def face_top():
    W, H = new_face(BOX_W, BOX_D)
    c = parchment(W, H, 11).convert("RGBA")
    paste_frame(c, (BLEED + 3.2, BLEED + 3.2, BOX_W - 6.4, BOX_D - 6.4))
    cx = W / 2
    ex = emblem(56)
    # abanicos a los lados, detrás del emblema
    fan(c, TOP_LEFT, (mm(BLEED + 34), mm(BLEED + 58)), 25, [-16, 0, 16], 19)
    fan(c, TOP_RIGHT, (mm(BLEED + BOX_W - 34), mm(BLEED + 58)), 25, [-16, 0, 16], 19)
    sh, pad = shadow_of(ex, mm(1.4), 0.35)
    ey = mm(BLEED + 11)
    c.alpha_composite(sh, (round(cx - ex.width / 2) - pad, ey - pad + mm(0.8)))
    c.alpha_composite(ex, (round(cx - ex.width / 2), ey))
    # iconos abajo: jugadores, duración, edad
    paste_center(c, players_icon(mm(18), INK), mm(BLEED + 31), mm(BLEED + BOX_D - 25))
    paste_time(c, mm(18), INK, cx, mm(BLEED + BOX_D - 25))
    paste_center(c, age_icon(mm(15), INK), mm(BLEED + BOX_W - 31), mm(BLEED + BOX_D - 25))
    return c.convert("RGB")


def face_back():
    W, H = new_face(BOX_W, BOX_D)
    c = parchment(W, H, 22).convert("RGBA")
    paste_frame(c, (BLEED + 3.2, BLEED + 3.2, BOX_W - 6.4, BOX_D - 6.4))
    # izquierda: cinta, texto, iconos
    lx = BLEED + 14
    rb = ribbon(46)
    c.alpha_composite(rb, (mm(lx), mm(BLEED + 14)))
    d = ImageDraw.Draw(c)
    f = font(False, mm(3.5))
    y = mm(BLEED + 14) + rb.height + mm(3)
    for ln in wrap(BLURB, f, mm(50), d):
        d.text((mm(lx), y), ln, font=f, fill=INK + (255,))
        y += mm(4.4)
    f2 = font(True, mm(3.6))
    d.text((mm(lx), y + mm(1.5)), CONTENTS, font=f2, fill=INK + (255,))
    paste_center(c, players_icon(mm(14), INK), mm(lx + 7), mm(BLEED + BOX_D - 22))
    paste_time(c, mm(14), INK, mm(lx + 24), mm(BLEED + BOX_D - 22))
    paste_center(c, age_icon(mm(11.5), INK), mm(lx + 42), mm(BLEED + BOX_D - 22))
    # derecha: abanico de 5 cartas
    fan(c, BACK_FAN, (mm(BLEED + 104), mm(BLEED + 76)), 27, [-30, -15, 0, 15, 30], 30)
    return c.convert("RGB")


def _side_frame(c, W, H):
    d = ImageDraw.Draw(c)
    m = mm(BLEED + 3.0)
    d.rounded_rectangle((m, m, W - m, H - m), radius=mm(3), outline=CREAM + (150,), width=mm(0.5))


def face_long():
    W, H = new_face(BOX_W, BOX_H)
    c = wood(W, H, 5).convert("RGBA")
    _side_frame(c, W, H)
    ex = emblem(58)
    sh, pad = shadow_of(ex, mm(1.2), 0.5)
    ex_x, ex_y = round(mm(BLEED + 62) - ex.width / 2), round(H / 2 - ex.height / 2)
    c.alpha_composite(sh, (ex_x - pad, ex_y - pad + mm(0.8)))
    c.alpha_composite(ex, (ex_x, ex_y))
    paste_center(c, players_icon(mm(17), CREAM), mm(BLEED + 19), H / 2)
    paste_time(c, mm(17), CREAM, mm(BLEED + 106), H / 2)
    paste_center(c, age_icon(mm(15), CREAM), mm(BLEED + 127), H / 2)
    return c.convert("RGB")


def face_short():
    W, H = new_face(BOX_D, BOX_H)
    c = wood(W, H, 8).convert("RGBA")
    _side_frame(c, W, H)
    ex = emblem(58)
    sh, pad = shadow_of(ex, mm(1.2), 0.5)
    ex_x, ex_y = round(W / 2 - ex.width / 2), round(H / 2 - ex.height / 2)
    c.alpha_composite(sh, (ex_x - pad, ex_y - pad + mm(0.8)))
    c.alpha_composite(ex, (ex_x, ex_y))
    return c.convert("RGB")


# ---------------------------------------------------------------- maqueta isométrica

def _affine_from_pts(src, dst):
    """Coeficientes PIL (mapa INVERSO destino->origen) para 3 puntos."""
    (x0, y0), (x1, y1), (x2, y2) = dst
    A = np.array([[x0, y0, 1], [x1, y1, 1], [x2, y2, 1]], float)
    B = np.array(src, float)
    cx = np.linalg.solve(A, B[:, 0])
    cy = np.linalg.solve(A, B[:, 1])
    return (*cx, *cy)


def _save_safe(im, path):
    """Si Windows bloquea el archivo (abierto en un visor), escribe a un temporal y lo copia encima."""
    try:
        im.save(path, dpi=(PPI, PPI))
    except OSError:
        import shutil
        import tempfile
        tmp = os.path.join(tempfile.gettempdir(), "caja_" + os.path.basename(path))
        im.save(tmp, dpi=(PPI, PPI))
        shutil.copyfile(tmp, path)


def preview(top, longf, shortf, path):
    """Bloque visto en isométrica: tapa + lateral largo (izq) + lateral corto (dcha)."""
    k = 3.2  # px por mm
    c30, s30 = math.cos(math.radians(30)), math.sin(math.radians(30))
    ax = (c30 * k, s30 * k)       # eje del ancho (140 mm): abajo-derecha
    ay = (-c30 * k, s30 * k)      # eje del fondo (97 mm): abajo-izquierda
    az = (0, k)                   # altura (73 mm): abajo
    CW, CH = 900, 720
    p0 = (CW * 0.36 + BOX_D * c30 * k * 0.6, 60)
    p0 = (p0[0], p0[1])

    def add(p, v, m):
        return (p[0] + v[0] * m, p[1] + v[1] * m)

    P0 = p0
    P1 = add(P0, ax, BOX_W)
    P3 = add(P0, ay, BOX_D)
    P2 = add(P1, ay, BOX_D)

    def crop_trim(im):
        b = mm(BLEED)
        return im.crop((b, b, im.width - b, im.height - b))

    faces = [
        (crop_trim(top), P0, P1, P3, 1.0),                                           # tapa
        (crop_trim(longf), P3, P2, add(P3, az, BOX_H), 0.80),                        # lateral largo
        (crop_trim(shortf), P2, P1, add(P2, az, BOX_H), 0.62),                       # lateral corto
    ]
    sc = 3
    canvas = Image.new("RGBA", (CW * sc, CH * sc), (0, 0, 0, 0))
    for im, o, u_end, v_end, shade in faces:
        # o = origen del borde, u_end = extremo del eje u, v_end = extremo del eje v
        src_pts = [(0, 0), (im.width, 0), (0, im.height)]
        dst_pts = [(o[0] * sc, o[1] * sc), (u_end[0] * sc, u_end[1] * sc), (v_end[0] * sc, v_end[1] * sc)]
        coeffs = _affine_from_pts(src_pts, dst_pts)
        t = im.convert("RGBA").transform(canvas.size, Image.AFFINE, coeffs, resample=Image.BICUBIC)
        # máscara del paralelogramo
        m = Image.new("L", canvas.size, 0)
        fourth = (u_end[0] + v_end[0] - o[0], u_end[1] + v_end[1] - o[1])
        ImageDraw.Draw(m).polygon([tuple(np.array(p) * sc) for p in (o, u_end, fourth, v_end)], fill=255)
        t.putalpha(m)
        if shade < 1:
            t = Image.blend(t, Image.new("RGBA", t.size, (0, 0, 0, 255)), 1 - shade).convert("RGBA")
            t.putalpha(m)
        canvas.alpha_composite(t)
    canvas = canvas.resize((CW, CH), Image.LANCZOS)
    bg = Image.new("RGBA", canvas.size, (236, 231, 222, 255))
    bg.alpha_composite(canvas)
    _save_safe(bg.convert("RGB"), path)


def save(im, name):
    p = os.path.join(OUT, name)
    _save_safe(im, p)
    print("saved", p, im.size, f"= {im.width / PPI * 25.4:.1f} x {im.height / PPI * 25.4:.1f} mm")


def main():
    os.makedirs(OUT, exist_ok=True)
    if "--debug" in sys.argv:
        vine_frame().save(os.path.join(OUT, "_marco_debug.png"))
    top, back, longf, shortf = face_top(), face_back(), face_long(), face_short()
    save(top, "01_tapa.png")
    save(back, "02_reverso.png")
    save(longf, "03_lateral_largo.png")
    save(shortf, "04_lateral_corto.png")
    preview(top, longf, shortf, os.path.join(OUT, "vista_previa.png"))


if __name__ == "__main__":
    main()

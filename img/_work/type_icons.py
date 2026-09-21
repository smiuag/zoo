"""Iconos de tipo de animal pintados sobre el redondo de madera img/redondo.jpg.
  OFICIALES:        land = hoja, bird = nube, aquatic = gota            -> img/iconos_tipo/
  EDICION COMPLETA: pet = caseta, dinosaur = hueso (solo pruebas)       -> img/iconos_tipo_completa/
Variantes descartadas que siguen disponibles: bird_a/b/c (plumas) y pet_b (casita con puerta y ventana).
build_badge(clave, diametro) devuelve el redondo con el icono (RGBA); build_icon, el icono suelto.
Uso:  /c/Python310/python img/_work/type_icons.py   (regenera los PNG de las dos carpetas)
Ver img/_work/README.md.

Cada icono es una lista de PIEZAS (mascara + degradado) que se pintan en orden, cada una con su
contorno oscuro, mas unas LINEAS de detalle recortadas a una pieza.
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

REDONDO = r"C:\proyectos\Claude\zoo\img\redondo.jpg"
OUTLINE = (66, 46, 30)
SS = 4                      # supermuestreo de los iconos
_disc_cache = {}


def load_disc():
    """Recorta el disco de madera del fondo blanco (la sombra gris de debajo queda fuera por saturacion)."""
    if 'disc' in _disc_cache:
        return _disc_cache['disc']
    im = Image.open(REDONDO).convert('RGB')
    hsv = np.asarray(im.convert('HSV')).astype(float)
    m = (hsv[..., 1] > 45) & (hsv[..., 2] > 50)
    m = ndimage.binary_opening(m, iterations=2)
    lab, n = ndimage.label(m)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    m = ndimage.binary_fill_holes(lab == (np.argmax(sizes) + 1))
    m = ndimage.binary_erosion(m, iterations=2)
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    a = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    disc = im.convert('RGBA')
    disc.putalpha(a)
    disc = disc.crop((x0, y0, x1, y1))
    side = max(disc.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(disc, ((side - disc.width) // 2, (side - disc.height) // 2))
    _disc_cache['disc'] = sq
    return sq


# ---------------------------------------------------------------- utilidades de dibujo
def _bezier(p0, p1, p2, n=40):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in np.linspace(0, 1, n)]


def _rot(pts, ang, c):
    ca, sa = math.cos(ang), math.sin(ang)
    return [(c[0] + (x - c[0]) * ca - (y - c[1]) * sa, c[1] + (x - c[0]) * sa + (y - c[1]) * ca) for x, y in pts]


def _mask(S, draw_fn):
    im = Image.new('L', (S, S), 0)
    draw_fn(ImageDraw.Draw(im))
    return np.asarray(im) > 0


def _poly(S, pts):
    return _mask(S, lambda d: d.polygon(pts, fill=255))


def _part(mask, stops, axis=((0.5, 0.2), (0.5, 0.8))):
    """Pieza: mascara + degradado de colores `stops` [(pos 0..1, rgb), ...] a lo largo de `axis` (fracciones de S)."""
    if not isinstance(stops[0][1], (tuple, list)):              # forma corta: [color_inicio, color_fin]
        stops = [(0.0, stops[0]), (1.0, stops[1])]
    return dict(mask=mask, stops=stops, axis=axis)


# ---------------------------------------------------------------- formas
def _icon_drop(S):
    c = S / 2
    r = S * 0.215
    cy = c + S * 0.075
    tip = (c, c - S * 0.30)
    a0 = math.radians(-38)
    right = (c + r * math.cos(a0), cy + r * math.sin(a0))
    left = (c - r * math.cos(a0), cy + r * math.sin(a0))
    arc = [(c + r * math.cos(t), cy + r * math.sin(t)) for t in np.linspace(a0, math.pi - a0, 80)]
    pts = _bezier(tip, (c + r * 0.35, c - S * 0.12), right, 25) + arc + _bezier(left, (c - r * 0.35, c - S * 0.12), tip, 25)
    body = _part(_poly(S, pts), [(150, 214, 245), (40, 118, 196)])
    shine = _mask(S, lambda d: d.ellipse((c - S * 0.12, c - S * 0.02, c - S * 0.05, c + S * 0.09), fill=255))
    return [body, dict(mask=shine, stops=[(0, (255, 255, 255)), (1, (235, 246, 255))], axis=((0.5, 0), (0.5, 1)), outline=False)], []


def _icon_leaf(S):
    c = S / 2
    L = S * 0.33
    ang = math.radians(35)
    base, tip = (c, c + L), (c, c - L)
    w = S * 0.30
    pts = _rot(_bezier(base, (c + w, c + L * 0.15), tip, 40) + _bezier(tip, (c - w, c + L * 0.15), base, 40), ang, (c, c))
    blade = _part(_poly(S, pts), [(176, 214, 96), (72, 140, 52)])
    lw = max(2, int(S * 0.016))
    stem_l = _rot([(c, c + L * 1.18), (c, c + L * 0.9)], ang, (c, c))
    stem = _part(_mask(S, lambda d: d.line(stem_l, fill=255, width=lw)), [OUTLINE, OUTLINE])
    stem['outline'] = False
    lines = [(_rot([(c, c + L), (c, c - L * 0.82)], ang, (c, c)), (44, 92, 36), lw, 1)]
    for k, t in enumerate((0.45, 0.10, -0.25)):
        y = c + L * t
        reach = S * (0.115 - 0.02 * k)
        for sgn in (1, -1):
            lines.append((_rot([(c, y), (c + sgn * reach, y - S * 0.085)], ang, (c, c)), (44, 92, 36), lw, 1))
    return [stem, blade], lines


def _feather(S, stops, line_rgb, quill_rgb=(245, 236, 214), notches=((0.30, 1), (0.58, -1)), wr=0.175, wl=0.125):
    """Pluma sobre un raquis curvo de abajo-izquierda a arriba-derecha. `stops` colorea de la base a la punta."""
    P0, P1, P2 = (0.23 * S, 0.80 * S), (0.47 * S, 0.63 * S), (0.76 * S, 0.17 * S)
    N = 160
    ts = np.linspace(0, 1, N)
    sp = np.array(_bezier(P0, P1, P2, N))
    tg = np.gradient(sp, axis=0)
    tg /= np.linalg.norm(tg, axis=1, keepdims=True)
    nr = np.stack([-tg[:, 1], tg[:, 0]], 1)                     # normal hacia abajo-derecha
    T0 = 0.24                                                   # donde empieza la barba (antes es solo canon)
    u = np.clip((ts - T0) / (1 - T0), 0, 1)

    def width(W, side):
        w = W * S * np.sin(np.pi * np.clip(u, 0, 1) ** 0.85) ** 0.62
        for (u0, sd) in notches:                                # muescas en V
            if sd == side:
                w = w * np.minimum(1.0, np.abs(u - u0) / 0.035 + 0.30)
        return w

    wR, wL = width(wr, 1), width(wl, -1)
    sel = ts >= T0
    right = sp[sel] + nr[sel] * wR[sel, None]
    left = sp[sel] - nr[sel] * wL[sel, None]
    vane = _part(_poly(S, [tuple(p) for p in right] + [tuple(p) for p in left[::-1]]), stops, axis=((0.23, 0.80), (0.76, 0.17)))
    lw = max(2, int(S * 0.014))
    qpts = [tuple(p) for p in sp[ts <= T0 + 0.06]]
    quill = _part(_mask(S, lambda d: d.line(qpts, fill=255, width=int(S * 0.030), joint='curve')), [quill_rgb, quill_rgb])
    lines = []
    for uu in np.linspace(0.10, 0.88, 9):                       # barbas inclinadas hacia la punta
        i = int(np.argmin(np.abs(u - uu)))
        j = min(N - 1, i + int(N * 0.09))
        lines.append(([tuple(sp[i]), tuple(sp[j] + nr[j] * wR[j] * 0.86)], line_rgb, lw, 1))
        lines.append(([tuple(sp[i]), tuple(sp[j] - nr[j] * wL[j] * 0.86)], line_rgb, lw, 1))
    lines.append(([tuple(p) for p in sp[(ts >= T0) & (ts <= 0.97)]], quill_rgb, lw + 2, 1))   # raquis claro, encima de las barbas
    return [quill, vane], lines


def _icon_feather_a(S):     # ELEGIDA: crema casi blanca en la base, tostado claro hacia la punta
    return _feather(S, [(0.0, (255, 252, 240)), (0.45, (244, 228, 196)), (0.78, (222, 192, 146)), (1.0, (196, 158, 110))], (168, 130, 88))


def _icon_feather_b(S):     # guacamayo: rojo, amarillo y azul
    return _feather(S, [(0.0, (228, 62, 52)), (0.40, (240, 120, 50)), (0.58, (250, 205, 70)), (0.74, (70, 160, 215)), (1.0, (36, 92, 180))], (120, 50, 40))


def _icon_feather_c(S):     # azul cielo con la punta blanca, sin muescas y mas ancha
    return _feather(S, [(0.0, (60, 130, 200)), (0.6, (120, 190, 235)), (1.0, (245, 252, 255))], (40, 96, 160), notches=(), wr=0.19, wl=0.15)


def _icon_cloud(S):         # volador (2026-09-20: sustituye a la pluma a peticion del usuario)
    c = S / 2
    base_y = c + 0.135 * S
    blobs = [(-0.17, 0.035, 0.105), (-0.045, -0.075, 0.150), (0.115, -0.020, 0.125), (0.215, 0.060, 0.080), (-0.255, 0.075, 0.065)]

    def draw(d):
        for dx, dy, r in blobs:
            d.ellipse((c + (dx - r) * S, c + (dy - r) * S, c + (dx + r) * S, c + (dy + r) * S), fill=255)
        d.rounded_rectangle((c - 0.31 * S, c + 0.02 * S, c + 0.29 * S, base_y), radius=int(0.06 * S), fill=255)

    body = _part(_mask(S, draw), [(255, 255, 255), (176, 206, 236)], axis=((0.5, 0.30), (0.5, 0.66)))
    lw = max(2, int(S * 0.016))
    arcs = []
    for cx, cy, r, a0, a1 in ((-0.045, -0.075, 0.105, 200, 300), (0.115, -0.020, 0.085, 215, 310)):   # brillos interiores
        pts = [(c + (cx + r * math.cos(math.radians(a))) * S, c + (cy + r * math.sin(math.radians(a))) * S) for a in range(a0, a1, 6)]
        arcs.append((pts, (225, 238, 250), lw, 0))
    return [body], arcs


def _icon_bone(S):
    a, b = np.array([0.30 * S, 0.70 * S]), np.array([0.70 * S, 0.30 * S])
    d = (b - a) / np.linalg.norm(b - a)
    n = np.array([-d[1], d[0]])
    r = 0.088 * S

    def draw(dr):
        dr.line([tuple(a), tuple(b)], fill=255, width=int(0.115 * S))
        for end, sg in ((a, -1), (b, 1)):
            for side in (1, -1):
                cx, cy = end + d * sg * 0.035 * S + n * side * 0.072 * S
                dr.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)

    bone = _part(_mask(S, draw), [(255, 250, 235), (216, 198, 160)], axis=((0.35, 0.30), (0.65, 0.72)))
    lw = max(2, int(S * 0.016))
    off = n * -0.026 * S                                        # brillo a lo largo de la cana, por el lado de la luz
    lines = [([tuple(a + d * 0.10 * S + off), tuple(b - d * 0.10 * S + off)], (255, 255, 255), lw + 2, 0)]
    for t in (0.40, 0.62):                                      # dos marquitas
        p = a + (b - a) * t + n * 0.030 * S
        lines.append(([tuple(p), tuple(p + d * 0.05 * S)], (176, 152, 112), lw, 0))
    return [bone], lines


def _house(S, doghouse):
    c = S / 2
    wall_box = (0.29 * S, 0.47 * S, 0.71 * S, 0.77 * S)
    walls = _part(_mask(S, lambda d: d.rectangle(wall_box, fill=255)), [(255, 244, 214), (230, 204, 160)])
    roof_pts = [(0.17 * S, 0.50 * S), (c, 0.20 * S), (0.83 * S, 0.50 * S), (0.76 * S, 0.555 * S), (c, 0.30 * S), (0.24 * S, 0.555 * S)]
    gable = _part(_poly(S, [(0.24 * S, 0.555 * S), (c, 0.30 * S), (0.76 * S, 0.555 * S)]), [(255, 244, 214), (240, 220, 180)])
    gable['outline'] = False
    roof = _part(_poly(S, roof_pts), [(226, 84, 60), (170, 48, 40)])
    chimney = _part(_mask(S, lambda d: d.rectangle((0.63 * S, 0.24 * S, 0.71 * S, 0.42 * S), fill=255)), [(190, 96, 70), (150, 66, 50)])
    parts = [chimney, walls, gable, roof]
    if doghouse:                                                # caseta: entrada oscura en arco
        dw = 0.115 * S

        def door(d):
            d.rectangle((c - dw, 0.62 * S, c + dw, 0.77 * S), fill=255)
            d.ellipse((c - dw, 0.62 * S - dw, c + dw, 0.62 * S + dw), fill=255)
        parts.append(_part(_mask(S, door), [(92, 60, 40), (52, 34, 24)]))
    else:                                                       # casita: puerta y ventana
        parts.append(_part(_mask(S, lambda d: d.rounded_rectangle((0.35 * S, 0.57 * S, 0.47 * S, 0.77 * S), radius=int(0.03 * S), fill=255)), [(150, 96, 56), (112, 68, 40)]))
        parts.append(_part(_mask(S, lambda d: d.rectangle((0.54 * S, 0.57 * S, 0.65 * S, 0.67 * S), fill=255)), [(190, 228, 250), (120, 180, 225)]))
    return parts, []


def _icon_doghouse(S):
    return _house(S, True)


def _icon_house(S):
    return _house(S, False)


ICONS = {
    'land': _icon_leaf, 'aquatic': _icon_drop, 'dinosaur': _icon_bone,
    'bird_a': _icon_feather_a, 'bird_b': _icon_feather_b, 'bird_c': _icon_feather_c,
    'pet_a': _icon_doghouse, 'pet_b': _icon_house,
}
ICONS['bird_cloud'] = _icon_cloud
ICONS['bird'] = _icon_cloud  # nube, antes: ICONS['bird_a']       # elegidas por el usuario (2026-09-20): pluma clara y caseta
ICONS['pet'] = ICONS['pet_a']
# iconos que se reencajan: centrados en el redondo y con su punto mas lejano a esta fraccion del
# diametro desde el centro, para que no toquen el cordon del borde (que empieza hacia 0.43)
FIT = {'bird': 0.37, 'bird_cloud': 0.37, 'bird_a': 0.38, 'bird_b': 0.38, 'bird_c': 0.38, 'dinosaur': 0.38}
FINAL_KEYS = ['land', 'aquatic', 'bird']                 # OFICIALES: los 3 tipos clasicos
FULL_EDITION_KEYS = ['dinosaur', 'pet']                  # solo edicion completa (pruebas): a carpeta aparte
FINAL_DIR = r"C:\proyectos\Claude\zoo\img\iconos_tipo"


# ---------------------------------------------------------------- render
def _gradient(S, stops, axis):
    yy, xx = np.mgrid[0:S, 0:S].astype(float)
    (ax, ay), (bx, by) = [(p[0] * S, p[1] * S) for p in axis]
    dx, dy = bx - ax, by - ay
    g = np.clip(((xx - ax) * dx + (yy - ay) * dy) / (dx * dx + dy * dy), 0, 1)
    pos = [s[0] for s in stops]
    cols = np.array([s[1] for s in stops], float)
    return np.stack([np.interp(g, pos, cols[:, k]) for k in range(3)], -1)


def build_icon(key, D):
    S = D * SS
    parts, lines = ICONS[key](S)
    rgb = np.zeros((S, S, 3))
    alpha = np.zeros((S, S), bool)
    ow = max(2, int(S * 0.02))
    yy, xx = np.mgrid[0:S, 0:S] / S
    light = np.exp(-(((xx - 0.40) ** 2 + (yy - 0.36) ** 2) / 0.03))[..., None] * 26
    for p in parts:
        m = p['mask']
        if p.get('outline', True):
            ring = ndimage.binary_dilation(m, iterations=ow)
            rgb[ring] = OUTLINE
            alpha |= ring
        fill = np.clip(_gradient(S, p['stops'], p['axis']) + light, 0, 255)
        rgb[m] = fill[m]
        alpha |= m
    for pts, col, w, part_idx in lines:                         # detalles, recortados a su pieza
        lm = _mask(S, lambda d: d.line(pts, fill=255, width=w, joint='curve')) & parts[part_idx]['mask']
        rgb[lm] = col
    out = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')
    if key in FIT:                                              # centrar y escalar para no tocar el cordon
        ys, xs = np.where(alpha)
        cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        k = FIT[key] * S / np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max()
        crop = out.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        crop = crop.resize((max(1, round(crop.width * k)), max(1, round(crop.height * k))), Image.LANCZOS)
        out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        out.paste(crop, ((S - crop.width) // 2, (S - crop.height) // 2))
    return out.resize((D, D), Image.LANCZOS)


def build_badge(key, D):
    """Redondo de madera de diametro D con el icono encima."""
    disc = load_disc().resize((D, D), Image.LANCZOS)
    icon = build_icon(key, D)
    sh = Image.new('RGBA', (D, D), (0, 0, 0, 0))                # sombra corta del icono sobre la madera
    a = icon.getchannel('A').filter(ImageFilter.GaussianBlur(max(1, D * 0.015)))
    sh.putalpha(a.point(lambda v: int(v * 0.35)))
    badge = disc.copy()
    off = max(1, int(D * 0.02))
    badge.alpha_composite(sh, (off, off))
    badge.alpha_composite(icon)
    badge.putalpha(disc.getchannel('A'))                        # nada sobresale del disco
    return badge


def paste_badge(card, badge, center, shadow=True):
    """Pega el redondo centrado en `center` con una sombra suave sobre la carta."""
    D = badge.width
    x, y = int(round(center[0] - D / 2)), int(round(center[1] - D / 2))
    base = card.convert('RGBA')
    if shadow:
        pad = 12
        sh = Image.new('RGBA', (D + 2 * pad, D + 2 * pad), (0, 0, 0, 0))
        a = Image.new('L', sh.size, 0)
        a.paste(badge.getchannel('A'), (pad, pad))
        a = a.filter(ImageFilter.GaussianBlur(4)).point(lambda v: int(v * 0.45))
        sh.putalpha(a)
        base.alpha_composite(sh, (x - pad + 2, y - pad + 4))
    base.alpha_composite(badge, (x, y))
    return base.convert('RGB')


if __name__ == '__main__':
    # iconos listos para usar: redondo con icono (512 px) y el icono suelto sin madera
    big, small = 240, 62
    for folder, keys in ((FINAL_DIR, FINAL_KEYS), (FINAL_DIR + '_completa', FULL_EDITION_KEYS)):
        os.makedirs(folder, exist_ok=True)
        sheet = Image.new('RGB', (len(keys) * 260 + 40, 300 + 110), (236, 226, 204))
        for i, k in enumerate(keys):
            build_badge(k, 512).save(os.path.join(folder, f'{k}.png'))
            build_icon(k, 512).save(os.path.join(folder, f'{k}_solo.png'))
            sheet = paste_badge(sheet, build_badge(k, big), (150 + i * 260, 150))
            sheet = paste_badge(sheet, build_badge(k, small), (150 + i * 260, 345))     # a tamano real de carta
        sheet.save(os.path.join(folder, 'muestra.png'))
        print('ok', folder)

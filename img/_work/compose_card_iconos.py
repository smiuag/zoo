"""Diseno OFICIAL de las cartas de animal (desde 2026-09-20): redondos de tipo en vez del texto
"Terrestre - Acuatico", plantilla estandar de madera para todas, nombre en blanco y texto centrado bajo los
iconos. Es la variante A_pergamino; compose_all.py / compose_all_en.py la usan via compose_official().
El resto de variantes (B..H) son las pruebas de colocacion que se descartaron; se conservan para probar:
  /c/Python310/python img/_work/compose_card_iconos.py [id_carta] [variantes]   -> img/templates/pruebas/iconos_tipo
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose_card as cc
import compose_all as ca
import type_icons as ti

OUT = r"C:\proyectos\Claude\zoo\img\templates\pruebas\iconos_tipo"
M = cc.TEMPLATE_BLEED_MARGIN


def P(x, y):
    return (x + M, y + M)


def row_centers(center, n, D, gap):
    """Centros de n redondos en fila, centrados en `center`."""
    total = n * D + (n - 1) * gap
    x0 = center[0] - total / 2 + D / 2
    return [(x0 + i * (D + gap), center[1]) for i in range(n)]


# variante -> (centro de la fila en coordenadas de diseno 615x878, diametro, separacion, pintar texto de tipo)
VARIANTS = {
    'A_pergamino': dict(center=(307, 648), D=52, gap=12, text=False, body_dy=8, title_fill=(255, 255, 255), template='land', body_center=True),   # plantilla estandar (tablon de madera) para todas: el tipo ya lo dicen los iconos      # sustituyen al texto "Terrestre - Acuatico"
    'B_arriba': dict(center=(307, 44), D=62, gap=8, text=True),            # sobre el liston superior, entre bolsa y escudo
    'C_ilustracion': dict(center=None, D=64, gap=6, text=True),            # esquina inferior izquierda de la ilustracion
    # a caballo del borde de la ilustracion (mitad sobre el marco, mitad sobre la imagen)
    'D_borde_arriba': dict(center=(308, 64), D=62, gap=8, text=True),
    'E_borde_abajo': dict(center=(308, 481), D=62, gap=8, text=True),
    'F_borde_derecha': dict(center=(550, 273), D=62, gap=8, text=True, vertical=True),
    'G_borde_izquierda': dict(center=(66, 273), D=62, gap=8, text=True, vertical=True),
    # columna bajo la bolsa, centrada en su eje (x=81); la bolsa acaba en y=169 y el primer redondo
    # empieza a `gap` px de ella, la misma separacion que hay entre redondos
    'H_bajo_bolsa': dict(center=(81, None), top=169, D=62, gap=8, text=True, vertical=True),
}


DOUBLE_ICON = {'goldfish': {'aquatic': 2}, 'parakeet': {'bird': 2}}


def compose(card, variant, lang='es', out_dir=None):
    v = VARIANTS[variant]
    cid = card['id']
    photo = os.path.join(ca.IMG_DIR, ca.SPECIES_PHOTO[card['species']])
    habitats = [h for h in ca.HABITAT_ORDER + ca.EXTRA_TYPE_ORDER if h in card['habitats']]   # habitats y, detras, tipos extra
    # Excepción explícita del usuario (2026-09-21): el Albatros lista sus 3
    # tipos básicos por separado en vez de colapsarlos en "Todoterreno".
    type_label = ca.type_label_for(card['habitats'], ca.HABITAT_ES, None if cid == 'albatross' else 'Todoterreno')
    # Cartas que CUENTAN COMO 2 animales de un habitat (ver habitatWeight en effects/registry.ts): ese icono sale doble.
    for h, n in DOUBLE_ICON.get(cid, {}).items():
        i = habitats.index(h)
        habitats[i:i + 1] = [h] * n
    text = ca.CARD_TEXT_ES_PRINT.get(cid, card['text'])
    name = card['name']
    if lang == 'en':
        from card_text_en import CARD_TEXT_EN
        name, text = CARD_TEXT_EN[cid]

    img = cc.build_card_base(photo, v.get('template') or ca.template_key_for_card(card))
    draw = ImageDraw.Draw(img)
    f_cost = ImageFont.truetype(cc.FONT_BOLD, cc.BADGE_NUMBER_SIZE)
    cc.draw_centered(draw, cc.COST_BADGE, str(card['marketCost']), f_cost, fill=cc.COST_COLOR)
    cc.draw_centered(draw, cc.PV_BADGE, str(card['victoryPoints']), f_cost, fill=cc.PV_COLOR)
    title_w = cc.TITLE_BOX[2] - cc.TITLE_BOX[0] - 16
    f_title = cc.fit_font(draw, name.upper(), title_w, max_size=37)
    if v.get('title_fill'):      # titulo claro: lleva un contorno marron fino para leerse tambien sobre el tablon palido de las aves
        cc.draw_curved_text(img, cc.TITLE_BOX, name.upper(), f_title, fill=v['title_fill'], stroke_width=2, stroke_fill=(74, 50, 32))
    else:
        cc.draw_curved_text(img, cc.TITLE_BOX, name.upper(), f_title, fill=cc.HEADING_INK)
    draw = ImageDraw.Draw(img)
    if v['text']:
        f_type = cc.fit_font(draw, type_label, cc.TYPE_LINE_MAX_WIDTH, max_size=38, min_size=20)
        cc.draw_centered(draw, cc.TYPE_LINE_POINT, type_label, f_type, fill=cc.HEADING_INK)
    bx0, by0, bx1, by1 = cc.PANEL_BODY_BOX
    body_box = (bx0, by0 + v.get('body_dy', 0), bx1, by1)                   # el texto baja lo mismo que los iconos
    if v.get('body_center') and v.get('center'):
        # Texto centrado en vertical entre dos lineas fijas (marcadas por el usuario): el borde inferior
        # de los iconos y y=816 del diseno, la base de la ultima linea de un texto de 3 lineas (el
        # pergamino acaba en 828). Se centra la TINTA real del bloque (del tope de las letras de la
        # primera linea a la base de la ultima), no la caja de la fuente, que lleva aire arriba y
        # hacia que el texto se viera caido.
        import re as _re
        top_line = v['center'][1] + v['D'] / 2 + M
        bottom_line = 816 + M
        spacing = 10
        MIN_AIR = 10                     # aire minimo entre los iconos y la tinta del texto (y lo mismo abajo)
        shown = _re.sub(r"(?<=\d)PV", " PV", text)
        size = ca.BODY_MAX_SIZE_OVERRIDE.get(cid, 26)
        while True:                      # baja la letra hasta que la TINTA del bloque quepa con ese aire
            f_body = ImageFont.truetype(cc.FONT_REG, size)
            lines = [" ".join(tokens) for tokens in cc._wrap_lines(draw, shown, f_body, bx1 - bx0)]
            line_h = f_body.size + spacing
            ink_top = draw.textbbox((0, 0), lines[0], font=f_body)[1]
            ink_bottom = (len(lines) - 1) * line_h + draw.textbbox((0, 0), lines[-1], font=f_body)[3]
            if ink_bottom - ink_top <= (bottom_line - top_line) - 2 * MIN_AIR or size <= 16:
                break
            size -= 1
        y_start = (top_line + bottom_line) / 2 - (ink_top + ink_bottom) / 2
        cc.draw_wrapped(img, draw, (bx0, int(round(y_start)), bx1, by1), text, f_body, valign='top', top_pad=0)
    else:
        f_body = cc.fit_body_font(draw, text, body_box, max_size=26)
        cc.draw_wrapped(img, draw, body_box, text, f_body, valign='top')

    D, gap, n = v['D'], v['gap'], len(habitats)
    if v['center'] is None:                                                 # fila pegada a la esquina inferior izquierda
        x0 = 66 + 8 + D / 2
        centers = [P(x0 + i * (D + gap), 483 - 6 - D / 2) for i in range(n)]
    elif v.get('vertical'):                                                 # columna centrada en `center`
        if 'top' in v:                                                      # columna que arranca bajo `top`
            cx = v['center'][0] + M
            centers = [(cx, v['top'] + M + gap + D / 2 + i * (D + gap)) for i in range(n)]
        else:
            cx, cy = P(*v['center'])
            centers = [(cx, y) for (y, _) in row_centers((cy, cx), n, D, gap)]
    else:
        centers = row_centers(P(*v['center']), n, D, gap)
    for h, c in zip(habitats, centers):
        img = ti.paste_badge(img, ti.build_badge(h, D), c)

    img = cc.resize_to_print_size(img)
    out = os.path.join(out_dir, f'{cid}.png') if out_dir else os.path.join(OUT, f'{cid}_{variant}.png')
    img.save(out)
    return out


OFFICIAL_VARIANT = 'A_pergamino'


def compose_official(card, lang, out_dir):
    """Carta de animal con el diseno oficial, en `lang` ('es'/'en'), a out_dir/<id>.png."""
    return compose(card, OFFICIAL_VARIANT, lang=lang, out_dir=out_dir)


if __name__ == '__main__':
    cid = sys.argv[1] if len(sys.argv) > 1 else 'hippopotamus'
    os.makedirs(OUT, exist_ok=True)
    card = next(c for c in ca.load_cards() if c['id'] == cid)
    only = sys.argv[2].split(',') if len(sys.argv) > 2 else list(VARIANTS)   # 2o argumento: variantes (prefijo), p. ej. D,E,F,G
    outs = [compose(card, v) for v in VARIANTS if any(v.startswith(o) for o in only)]
    ims = [Image.open(o) for o in outs]
    w, h = ims[0].size
    sheet = Image.new('RGB', (w * len(ims) + 20 * (len(ims) - 1), h), 'white')
    for i, im in enumerate(ims):
        sheet.paste(im, (i * (w + 20), 0))
    sheet.save(os.path.join(OUT, f'{cid}_comparativa' + ('_' + ''.join(only) if len(sys.argv) > 2 else '') + '.png'))
    print('\n'.join(outs))

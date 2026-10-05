"""Diseno OFICIAL de las cartas de animal (desde 2026-10-05): marco template4, con el nombre en un pergamino
enrollado del color de los habitats de la carta (tierra marron, agua azul, aire blanco y sus mezclas), el
tipo ESCRITO bajo el nombre ("Terrestre - Acuatico") y el texto centrado debajo. compose_all.py y
compose_all_en.py lo usan via compose_official(). Las plantillas las genera build_scroll_templates.py y las
medidas del marco estan en compose_card.py. El diseno anterior (redondos de tipo, tablon de madera) sigue
en compose_card_iconos.py. Para probar una carta:
  /c/Python310/python img/_work/compose_card_pergamino.py toucan [en]   -> img/templates/pruebas/pergamino
"""
import os, re, sys
from PIL import ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose_card as cc
import compose_all as ca

OUT = r"C:\proyectos\Claude\zoo\img\templates\pruebas\pergamino"

# Orden de los colores, de izquierda a derecha, en los pergaminos mixtos que no siguen ca.HABITAT_ORDER
# (ver build_scroll_templates.py): la etiqueta de tipo lista los habitats en ese mismo orden.
SCROLL_COLOR_ORDER = {'aquatic_bird': ['aquatic', 'bird'], 'land_aquatic_bird': ['aquatic', 'land', 'bird']}


def type_label(card, key, names, all_terrain):
    """Etiqueta de tipo: habitats en el orden de los colores del pergamino y, detras, los tipos extra.
    `all_terrain` sustituye a los 3 habitats juntos (None = se listan)."""
    if all_terrain and key == 'land_aquatic_bird':
        parts = [all_terrain]
    else:
        parts = [names[h] for h in SCROLL_COLOR_ORDER.get(key, ca.HABITAT_ORDER) if h in card['habitats']]
    return ' - '.join(parts + [names[h] for h in ca.EXTRA_TYPE_ORDER if h in card['habitats']])


def compose_official(card, lang, out_dir):
    """Carta de animal con el diseno oficial, en `lang` ('es'/'en'), a out_dir/<id>.png."""
    cid = card['id']
    key = ca.template_key_for_card(card)
    photo = os.path.join(ca.IMG_DIR, ca.SPECIES_PHOTO[card['species']])
    if lang == 'en':
        from card_text_en import CARD_TEXT_EN, HABITAT_EN
        name, text = CARD_TEXT_EN[cid]
        label = type_label(card, key, HABITAT_EN, None)        # en ingles nunca hubo "todoterreno": se listan los 3
    else:
        name, text = card['name'], ca.CARD_TEXT_ES_PRINT.get(cid, card['text'])
        label = type_label(card, key, ca.HABITAT_ES, 'Todoterreno')
    name = name.upper()

    img = cc.build_card_base(photo, key)
    draw = ImageDraw.Draw(img)
    f_cost = ImageFont.truetype(cc.FONT_BOLD, cc.BADGE_NUMBER_SIZE)
    cc.draw_centered(draw, cc.COST_BADGE, str(card['marketCost']), f_cost, fill=cc.COST_COLOR)
    cc.draw_centered(draw, cc.PV_BADGE, str(card['victoryPoints']), f_cost, fill=cc.PV_COLOR)
    # nombre recto y en tinta oscura: el pergamino es plano y claro (el blanco del tablon no se leeria)
    f_title = cc.fit_font(draw, name, cc.TITLE_BOX[2] - cc.TITLE_BOX[0] - 16, max_size=37)
    cc.draw_centered(draw, cc.TITLE_BOX, name, f_title, fill=cc.HEADING_INK)
    f_type = cc.fit_font(draw, label, cc.TYPE_LINE_MAX_WIDTH, max_size=38, min_size=20)
    cc.draw_centered(draw, cc.TYPE_LINE_POINT, label, f_type, fill=cc.HEADING_INK)

    # Texto centrado en vertical entre el pie de la etiqueta de tipo y la ultima linea util del panel
    # (cc.PANEL_BODY_BOX). Se centra la TINTA real del bloque (del tope de las letras de la primera linea
    # a la base de la ultima), no la caja de la fuente, que lleva aire arriba y hace que se vea caido.
    # Si no cabe con MIN_AIR de aire arriba y abajo, baja la letra.
    bx0, top_line, bx1, bottom_line = cc.PANEL_BODY_BOX
    spacing, MIN_AIR = 10, 10
    shown = re.sub(r"(?<=\d)PV", " PV", text)
    size = ca.BODY_MAX_SIZE_OVERRIDE.get(cid, 26)
    while True:
        f_body = ImageFont.truetype(cc.FONT_REG, size)
        lines = [" ".join(tokens) for tokens in cc._wrap_lines(draw, shown, f_body, bx1 - bx0)]
        line_h = f_body.size + spacing
        ink_top = draw.textbbox((0, 0), lines[0], font=f_body)[1]
        ink_bottom = (len(lines) - 1) * line_h + draw.textbbox((0, 0), lines[-1], font=f_body)[3]
        if ink_bottom - ink_top <= (bottom_line - top_line) - 2 * MIN_AIR or size <= 16:
            break
        size -= 1
    y_start = (top_line + bottom_line) / 2 - (ink_top + ink_bottom) / 2
    cc.draw_wrapped(img, draw, (bx0, int(round(y_start)), bx1, bottom_line), text, f_body, valign='top', top_pad=0)

    img = cc.resize_to_print_size(img)
    out = os.path.join(out_dir, f'{cid}.png')
    img.save(out)
    return out


if __name__ == '__main__':
    cid = sys.argv[1] if len(sys.argv) > 1 else 'hippopotamus'
    lang = sys.argv[2] if len(sys.argv) > 2 else 'es'
    os.makedirs(OUT, exist_ok=True)
    card = next(c for c in ca.load_cards() if c['id'] == cid)
    print(compose_official(card, lang, OUT))

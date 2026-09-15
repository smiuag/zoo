import os
import re
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter, ImageOps

LAUREL_ICON_PATH = r"C:\proyectos\Claude\zoo\img\_work\laurel_icon.png"

INK = (42, 28, 18)
# Nombre y hábitat de la carta usaban negro puro (0,0,0) o el propio INK
# (que a tamaño grande y con Baloo 2 ExtraBold se percibe casi tan "duro"
# como el negro): pedido explícito (2026-09-14) de que se vean muy oscuros
# pero SIN llegar a negro — un marrón oscuro más suave que INK, reservado
# para el nombre/tipo; el cuerpo del texto sigue en INK, que no se quejó.
HEADING_INK = (74, 56, 42)
# Baloo 2 (SIL OFL, https://fonts.google.com/specimen/Baloo+2): fuente
# redondeada/"alegre", la misma familia que ya usa apps/web (ver
# body{font-family:'Baloo 2',...} en styles.css) — pedido explícitamente
# 2026-09-14 para que las cartas impresas dejen de usar Georgia (serif
# formal, no "alegre"). Es una fuente VARIABLE (un único archivo con eje de
# peso 400-800): estos 2 .ttf son instancias ESTÁTICAS ya extraídas con
# fontTools (`from fontTools.varLib import instancer;
# instancer.instantiateVariableFont(ttLib.TTFont(...), {'wght': 400 | 800})`)
# desde ofl/baloo2/Baloo2[wght].ttf del repo google/fonts, para poder seguir
# usando ImageFont.truetype(path, size) tal cual en todo el resto de este
# módulo sin tocar ninguna otra línea — Pillow SÍ soporta instanciar pesos
# de una fuente variable en tiempo de ejecución
# (font.set_variation_by_name), pero habría obligado a tocar cada llamada
# a ImageFont.truetype de este archivo para pasar también el peso.
FONT_BOLD = r"C:\proyectos\Claude\zoo\img\_work\fonts\Baloo2-ExtraBold.ttf"
FONT_REG = r"C:\proyectos\Claude\zoo\img\_work\fonts\Baloo2-Regular.ttf"

# Plantillas "madera claras CON SANGRADO" (una por combinación de hábitats,
# más una para las monedas): el mismo diseño de siempre (615x878,
# comprobado pixel a pixel idéntico con diff) pero centrado dentro de un
# lienzo más grande (811x1074), con 98px de fondo de sobra en cada lado
# (TEMPLATE_BLEED_MARGIN) — igual filosofía que el reverso (ver
# compose_back.py): así el corte real de la carta impresa puede quedar
# 0.1cm por dentro del borde del papel sin que se vea nunca blanco/vacío,
# tanto en el frente como en el reverso, cuadrando ambos exactamente igual.
TEMPLATES_DIR = r"C:\proyectos\Claude\zoo\img\templates\sangrado\medias"
TEMPLATE_FILES = {
    "land": "tierra.png",
    "aquatic": "agua.png",
    "bird": "aire.png",
    "land_aquatic": "tierra_agua.png",
    "land_bird": "tierra_aire.png",
    "aquatic_bird": "agua_aire.png",
    "land_aquatic_bird": "tierra_agua_aire.png",
    "coin": "monedas.png",
}
# Plantillas en RGBA con la ventana de ilustración ya recortada como
# transparencia real (ver _build_template_alpha) — se detecta por flood fill
# la primera vez que hace falta cada una y se cachea aquí en disco, porque
# detectarla es más caro que leer un PNG. Si cambia el arte de una plantilla
# hay que borrar su cache (o el directorio entero) para forzar que se
# vuelva a detectar la ventana.
_ALPHA_CACHE_DIR = r"C:\proyectos\Claude\zoo\img\_work\template_alpha_cache"

# Tamaño del DISEÑO real de la carta (sin sangrado de plantilla): el mismo
# lienzo de siempre (615x878, como el antiguo template3.png). Los ARCHIVOS
# de plantilla en TEMPLATES_DIR son más grandes porque llevan ese diseño
# EXACTO centrado con RAW_TEMPLATE_BLEED_MARGIN de fondo alrededor — pero
# usamos menos que eso (TEMPLATE_BLEED_MARGIN, ver _load_raw_template):
# con el margen COMPLETO del archivo, escalado a tamaño de impresión, cada
# carta mide ~989x1310px y solo caben 4 por hoja A4 (2x2) sin recortar ni
# solapar ninguna — el usuario pidió recortar el sangrado de la plantilla
# lo justo para que sigan cabiendo 9 (3x3), sin volver a inventar ni
# recortar el DISEÑO en sí (solo el margen de sobra, simétrico, alrededor).
TEMPLATE_DESIGN_W, TEMPLATE_DESIGN_H = 615, 878
RAW_TEMPLATE_BLEED_MARGIN = 98    # margen real que traen los archivos de TEMPLATES_DIR
TEMPLATE_BLEED_MARGIN = 30        # margen que de verdad usamos (recortado del anterior, ver arriba)


def _offset_box(box):
    x0, y0, x1, y1 = box
    return (
        x0 + TEMPLATE_BLEED_MARGIN,
        y0 + TEMPLATE_BLEED_MARGIN,
        x1 + TEMPLATE_BLEED_MARGIN,
        y1 + TEMPLATE_BLEED_MARGIN,
    )


def _offset_point(point):
    x, y = point
    return (x + TEMPLATE_BLEED_MARGIN, y + TEMPLATE_BLEED_MARGIN)


# Coordenadas de siempre, medidas sobre el diseño puro de 615x878 (sin
# sangrado) — se desplazan por TEMPLATE_BLEED_MARGIN para caer en el sitio
# correcto dentro del lienzo de plantilla, más grande, con sangrado.
ILLUSTRATION_BOX = _offset_box((66, 64, 551, 483))
# Ajuste 2026-09-13: el numero de la bolsa quedaba alto respecto al cuerpo de la bolsa y el del
# escudo bajo respecto al hueco del laurel (revisado sobre las cartas impresas): bolsa 6 px mas
# abajo, escudo 7 px mas arriba (en espacio de diseno 615x878).
COST_BADGE = _offset_point((83, 109))             # center of the coin pouch body
PV_BADGE = _offset_point((526, 90))               # center of the laurel wreath opening
BADGE_NUMBER_SIZE = 50             # 45 + 10%
TITLE_BOX = _offset_box((95, 518, 540, 566))    # wood ribbon banner: card name (bajado 3px + 2px, 2026-09-14)
TYPE_LINE_POINT = _offset_point((307, 640))       # "Terrestre" label, centered in the panel
TYPE_LINE_MAX_WIDTH = 420          # shrink multi-habitat labels to fit
PANEL_BODY_BOX = _offset_box((95, 663, 540, 858))  # starts right below the type label, top-aligned

COST_COLOR = (0, 100, 0)    # verde bosque
PV_COLOR = (94, 35, 123)    # morado (el mismo que la Hiena en la tanda 4)

# Tamaño físico real "carta de MTG" (2.5x3.5in) a 300dpi: 750x1050px exacto
# (2.5*300=750, 3.5*300=1050 sin redondeos). El DISEÑO (TEMPLATE_DESIGN_W x
# H, 615x878) se escala para medir esto exactamente al imprimir — ver
# resize_to_print_size.
CARD_PRINT_W = 750
CARD_PRINT_H = 1050
# Lienzo "canónico" con sangrado: el mismo tamaño que ya traen las
# plantillas de TEMPLATES_DIR (811x1074 = 615x878 + 98px de margen por
# lado, ver TEMPLATE_BLEED_MARGIN). resize_to_print_size normaliza
# CUALQUIER carta a este tamaño exacto ANTES de escalar — si ya lo trae
# (las plantillas de animal, tal cual las preparó el usuario), no se toca
# ni un pixel; si no (las monedas, planas a 615x878 sin margen propio), se
# amplía repitiendo el borde para llegar al mismo tamaño, nunca menos.
CANVAS_W = TEMPLATE_DESIGN_W + 2 * TEMPLATE_BLEED_MARGIN
CANVAS_H = TEMPLATE_DESIGN_H + 2 * TEMPLATE_BLEED_MARGIN


def _load_raw_template(filename):
    """Abre un archivo de TEMPLATES_DIR (RAW_TEMPLATE_BLEED_MARGIN de
    sangrado por lado, tal como lo preparó el usuario) y lo recorta,
    centrado, al margen que de verdad usamos (TEMPLATE_BLEED_MARGIN) — un
    recorte simétrico del sangrado de SOBRA, nunca del diseño (615x878, que
    siempre se queda intacto en el centro). Es el único sitio donde se toca
    el archivo de plantilla; todo lo demás (build_card_base,
    build_coin_card_base) trabaja ya sobre el resultado, más pequeño."""
    raw = Image.open(os.path.join(TEMPLATES_DIR, filename)).convert("RGB")
    trim = RAW_TEMPLATE_BLEED_MARGIN - TEMPLATE_BLEED_MARGIN
    if trim <= 0:
        return raw
    return raw.crop((trim, trim, raw.width - trim, raw.height - trim))


def build_coin_card_base(coin_photo_path):
    """Las monedas (img/coins/*.png) llegan como un diseño de carta YA
    TERMINADO (marco + ilustración + badges, pintado aparte, sin pasar por
    build_card_base) pero exactamente al tamaño del DISEÑO puro
    (TEMPLATE_DESIGN_W x H, sin sangrado propio — a diferencia de las
    plantillas de animal, que ya traen su sangrado incorporado). Para darle
    el mismo sangrado real (nunca inventado: ni un color liso de relleno ni
    replicar su propio borde) se pega tal cual, sin recortar ni escalar,
    centrado sobre la plantilla "coin" (monedas.png) — que ya trae de
    fábrica exactamente ese hueco y ese sangrado de sobra alrededor, igual
    que las demás plantillas."""
    template = _load_raw_template(TEMPLATE_FILES["coin"])
    coin = Image.open(coin_photo_path).convert("RGB")
    if coin.size != (TEMPLATE_DESIGN_W, TEMPLATE_DESIGN_H):
        coin = coin.resize((TEMPLATE_DESIGN_W, TEMPLATE_DESIGN_H), Image.LANCZOS)
    card = template.copy()
    card.paste(coin, (TEMPLATE_BLEED_MARGIN, TEMPLATE_BLEED_MARGIN))
    return card


def resize_to_print_size(card, target_w=CARD_PRINT_W, target_h=CARD_PRINT_H):
    """`card` es el lienzo YA COMPUESTO (foto+plantilla+texto, o
    build_coin_card_base para monedas) — SIEMPRE exactamente CANVAS_W x
    CANVAS_H (el diseño más el sangrado real de la plantilla, nunca
    inventado). Se escala ENTERO —sin recortar nada— para que el DISEÑO
    real (TEMPLATE_DESIGN_W x H) mida EXACTAMENTE target_w x target_h (el
    tamaño real de una carta de MTG, 750x1050 a 300dpi) — la parte que de
    verdad se recorta al imprimir. Como la proporción del diseño (615:878)
    no es idéntica a la de destino (750:1050), esto usa un factor de
    escala DISTINTO por eje (scale_x, scale_y) en vez de uno solo: un solo
    factor (el máximo de los dos, "cover") solo puede dejar UN eje exacto
    y el otro se pasa (con 615x878/750x1050 salía ~1071 de alto en vez de
    1050, un 2% de más) — el estiramiento resultante de usar dos escalas
    es del mismo orden (~2%) y no se aprecia, pero así el recorte real
    siempre da el tamaño de carta pedido en las dos direcciones. El
    sangrado que sobra (el margen de la plantilla, con su color y textura
    reales, intacto) se queda tal cual en el resultado: quien construye la
    página (print_layout.py) pega cada carta ENTERA, pegada a la de al
    lado sin hueco NI solape — nunca se decide aquí cuánto bleed
    "exponer", se usa TODO el que haya (el ya recortado a
    TEMPLATE_BLEED_MARGIN, ver _load_raw_template)."""
    assert card.size == (CANVAS_W, CANVAS_H), (
        f"resize_to_print_size espera un lienzo ya compuesto a {CANVAS_W}x{CANVAS_H} "
        f"(con el sangrado real de la plantilla incluido), llegó {card.size}"
    )
    scale_x = target_w / TEMPLATE_DESIGN_W
    scale_y = target_h / TEMPLATE_DESIGN_H
    return card.resize((round(card.width * scale_x), round(card.height * scale_y)), Image.LANCZOS)


def _build_template_alpha(template_key):
    """Devuelve la plantilla `template_key` (ver TEMPLATE_FILES) en RGBA con
    la ventana de ilustración recortada como transparencia real. La ventana
    se detecta por flood fill desde un punto que cae dentro de ella en las 7
    plantillas (mismo diseño base, solo cambia la decoración): se rellena la
    región blanca contigua al punto semilla y se usa como máscara, en vez de
    depender de un fichero de máscara pintado a mano por plantilla. Igual que
    antes (ver el MaxFilter de más abajo), la ventana se agranda 2px para que
    el anillo antialiseado casi-blanco del borde quede del lado transparente
    y lo tape la foto en vez de dejar una línea blanca dentada. Se cachea en
    disco (_ALPHA_CACHE_DIR): detectar la ventana es más caro que leer un PNG."""
    os.makedirs(_ALPHA_CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(_ALPHA_CACHE_DIR, f"{template_key}.png")
    if os.path.exists(cache_path):
        return Image.open(cache_path).convert("RGBA")

    template = _load_raw_template(TEMPLATE_FILES[template_key])
    w, h = template.size
    seed = (w // 2, h // 3)  # cae dentro de la ventana en las 7 plantillas
    marker = (1, 2, 3)       # color imposible de confundir con arte real
    filled = template.copy()
    ImageDraw.floodfill(filled, seed, marker, thresh=30)

    r, g, b = filled.split()
    is_marker = ImageChops.multiply(
        ImageChops.multiply(r.point(lambda p: 255 if p == marker[0] else 0),
                             g.point(lambda p: 255 if p == marker[1] else 0)),
        b.point(lambda p: 255 if p == marker[2] else 0),
    )
    grown_window = is_marker.filter(ImageFilter.MaxFilter(5))
    alpha = ImageOps.invert(grown_window)  # 255 = marco opaco, 0 = ventana transparente

    template_rgba = template.copy()
    template_rgba.putalpha(alpha)
    template_rgba.save(cache_path)
    return template_rgba


def build_card_base(photo_path, template_key):
    """Compone la carta pegando la foto PRIMERO y el marco (con la ventana
    ya recortada como transparencia real) ENCIMA — así cualquier imprecisión
    de un par de píxeles en el borde la absorbe el marco (que tapa un pelín
    de más de la foto, invisible) en vez de dejar ver el blanco de la
    plantilla por debajo (que sí se nota). `template_key` decide qué de las 7
    plantillas usar (ver TEMPLATE_FILES / template_key_for_card en
    compose_all.py)."""
    x0, y0, x1, y1 = ILLUSTRATION_BOX
    bw, bh = x1 - x0, y1 - y0

    photo = Image.open(photo_path).convert("RGB")
    w, h = photo.size
    # Zoom in (80% of the shorter side) and bias the crop toward the top,
    # since the subject is usually drawn in the upper-middle area and the
    # bottom (ground/legs) can be cropped off without losing much. Crop at
    # the same aspect ratio as the window so the photo isn't stretched.
    aspect = bw / bh
    crop_h = int(min(h, w / aspect) * 1.0)
    crop_w = int(crop_h * aspect)
    left = (w - crop_w) // 2
    top = int(h * 0.03)
    photo = photo.crop((left, top, left + crop_w, top + crop_h))
    photo = photo.resize((bw, bh), Image.LANCZOS)

    template_rgba = _build_template_alpha(template_key)
    card = Image.new("RGB", template_rgba.size, (255, 255, 255))
    card.paste(photo, (x0, y0))
    card.paste(template_rgba, (0, 0), template_rgba)
    return card


def draw_centered(draw, box_or_point, text, font, fill=INK):
    if len(box_or_point) == 4:
        x0, y0, x1, y1 = box_or_point
        point = ((x0 + x1) // 2, (y0 + y1) // 2)
    else:
        point = box_or_point
    draw.text(point, text, font=font, fill=fill, anchor="mm")


# Pedido explícito (2026-09-14): el nombre del animal debe seguir la curva
# del tablón de madera de la plantilla (más alto en el centro, cayendo
# hacia los extremos — ver TITLE_BOX/el tablón en TEMPLATES_DIR), no ir en
# línea recta. ImageDraw.text no soporta texto en un arco directamente, así
# que cada carácter se dibuja en su propia imagen RGBA, se ROTA según la
# pendiente local del arco en ese punto, y se pega sobre `card` (no sobre
# `draw`: hace falta el Image de verdad para pegar con máscara alfa, un
# ImageDraw no expone eso). `curve_height` es cuánto sube el centro
# respecto a los extremos (arco tipo "sonrisa" ⌢, parabólico); el ángulo de
# cada carácter sigue la derivada de esa misma parábola, así que el propio
# glifo se inclina siguiendo la tangente del arco en su posición.
def draw_curved_text(card, box, text, font, fill=HEADING_INK, curve_height=12, max_angle=16):
    x0, y0, x1, y1 = box
    box_w = x1 - x0
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2

    measurer = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    widths = [measurer.textlength(ch, font=font) for ch in text]
    total_w = sum(widths)
    ascent, descent = font.getmetrics()
    char_h = ascent + descent

    x = cx - total_w / 2
    for ch, w in zip(text, widths):
        char_center_x = x + w / 2
        t = (char_center_x - cx) / (box_w / 2)
        t = max(-1.0, min(1.0, t))
        y_offset = -curve_height * (1 - t * t)
        angle_deg = -t * max_angle

        glyph = Image.new("RGBA", (int(w) + 8, char_h + 8), (0, 0, 0, 0))
        ImageDraw.Draw(glyph).text((4, 4), ch, font=font, fill=fill)
        rotated = glyph.rotate(angle_deg, resample=Image.BICUBIC, expand=True)

        paste_x = int(char_center_x - rotated.width / 2)
        paste_y = int(cy + y_offset - rotated.height / 2)
        card.paste(rotated, (paste_x, paste_y), rotated)

        x += w


def draw_title_with_big_number(draw, box, prefix, number, f_title, f_number, gap=12, fill=HEADING_INK):
    x0, y0, x1, y1 = box
    cy = (y0 + y1) // 2
    # Same font as the prefix, just a bigger size — anchor both runs on the
    # SAME baseline (computed from the smaller/reference font) instead of
    # each one's own vertical center, otherwise the bigger digit's taller
    # bounding box makes it sit visibly lower than "MONEDA DE ".
    ascent, descent = f_title.getmetrics()
    baseline = cy + (ascent - descent) // 2
    prefix_w = draw.textlength(prefix + " ", font=f_title)
    number_w = draw.textlength(number, font=f_number)
    total_w = prefix_w + gap + number_w
    start_x = (x0 + x1) / 2 - total_w / 2
    draw.text((start_x, baseline), prefix + " ", font=f_title, fill=fill, anchor="ls")
    draw.text((start_x + prefix_w + gap, baseline), number, font=f_number, fill=fill, anchor="ls")


def fit_font(draw, text, max_width, max_size, min_size=20, font_path=FONT_BOLD):
    size = max_size
    while size > min_size:
        font = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 2
    return ImageFont.truetype(font_path, min_size)


def _wrap_lines(draw, text, font, max_width):
    space_w = draw.textlength(" ", font=font)

    def token_width(tok):
        return draw.textlength(tok, font=font)

    # `\n` en el texto de la carta (ver packages/engine/src/cards/data/*.json,
    # p. ej. para separar visualmente "gana valor de compra" de "al final de
    # la partida, +1PV..." en las cartas con 2 efectos) fuerza un salto de
    # línea de verdad, ANTES del auto-wrap normal por ancho: sin partir el
    # texto por "\n" primero, text.split() (usado antes) trataba el salto
    # como un espacio más y lo tragaba en silencio, así que nunca se veía
    # ningún salto por mucho "\n" que llevara el JSON.
    lines = []
    for segment in text.split("\n"):
        words = segment.split()
        current, current_w = [], 0
        for word in words:
            w = token_width(word)
            add_w = w if not current else space_w + w
            if current and current_w + add_w > max_width:
                lines.append(current)
                current, current_w = [word], w
            else:
                current.append(word)
                current_w += add_w
        lines.append(current)
    return lines


def fit_body_font(draw, text, box, font_path=FONT_REG, max_size=26, min_size=16, line_spacing=10, top_pad=8, bottom_pad=12):
    """Shrinks the body font until the wrapped text fits inside the box's
    height (some cards, like the Biólogo with its 4 modes, have much more
    text than a typical animal card). bottom_pad reserves real breathing
    room below the last line — without it, a text that "fits" exactly at
    y1 reads as touching the card's bottom edge (this is what happened to
    Flamenco's 5-line text: it fit by 3px with no bottom margin at all)."""
    text = re.sub(r"(?<=\d)PV\b", " PV", text)
    x0, y0, x1, y1 = box
    max_width = x1 - x0
    available_h = (y1 - y0) - top_pad - bottom_pad
    size = max_size
    while size > min_size:
        font = ImageFont.truetype(font_path, size)
        lines = _wrap_lines(draw, text, font, max_width)
        total_h = (font.size + line_spacing) * len(lines)
        if total_h <= available_h:
            return font
        size -= 1
    return ImageFont.truetype(font_path, min_size)


def draw_wrapped(card, draw, box, text, font, fill=INK, line_spacing=10, valign="center", top_pad=8):
    del card  # unused now that "PV" is drawn as plain text again
    # "+1PV" -> "+1 PV" (just a spacing fix; drawn as plain text).
    text = re.sub(r"(?<=\d)PV\b", " PV", text)

    x0, y0, x1, y1 = box
    max_width = x1 - x0
    space_w = draw.textlength(" ", font=font)
    lines = _wrap_lines(draw, text, font, max_width)

    line_h = font.size + line_spacing
    total_h = line_h * len(lines)
    if valign == "top":
        y = y0 + top_pad
    else:
        y = y0 + max(0, (y1 - y0 - total_h) // 2)

    for tokens in lines:
        widths = [draw.textlength(t, font=font) for t in tokens]
        line_w = sum(widths) + space_w * (len(tokens) - 1)
        x = x0 + (max_width - line_w) / 2
        for tok, w in zip(tokens, widths):
            draw.text((x, y), tok, font=font, fill=fill)
            x += w + space_w
        y += line_h


def compose(species_photo, name, habitat_label, cost, pv, text, out_path, template_key="land"):
    card = build_card_base(species_photo, template_key)
    draw = ImageDraw.Draw(card)

    f_cost = ImageFont.truetype(FONT_BOLD, BADGE_NUMBER_SIZE)
    f_body = fit_body_font(draw, text, PANEL_BODY_BOX, max_size=26)

    draw_centered(draw, COST_BADGE, str(cost), f_cost, fill=COST_COLOR)
    draw_centered(draw, PV_BADGE, str(pv), f_cost, fill=PV_COLOR)

    title_box_w = TITLE_BOX[2] - TITLE_BOX[0] - 16
    f_title = fit_font(draw, name.upper(), title_box_w, max_size=37)
    draw_curved_text(card, TITLE_BOX, name.upper(), f_title, fill=HEADING_INK)

    f_type = fit_font(draw, habitat_label, TYPE_LINE_MAX_WIDTH, max_size=38, min_size=20)
    draw_centered(draw, TYPE_LINE_POINT, habitat_label, f_type, fill=HEADING_INK)

    draw_wrapped(card, draw, PANEL_BODY_BOX, text, f_body, valign="top")

    card.save(out_path)


if __name__ == "__main__":
    compose(
        species_photo=r"C:\proyectos\Claude\zoo\img\elefantes.jpg",
        name="Elefante",
        habitat_label="Terrestre",
        cost=7,
        pv=2,
        text="Al jugarlo, capturas gratis (sin gastar monedas ni tu limite de capturas) el animal del mercado de coste 3 o menos que elijas.",
        out_path=r"C:\proyectos\Claude\zoo\img\_work\card3_elephant.png",
    )

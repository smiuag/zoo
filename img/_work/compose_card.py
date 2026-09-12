import os
import re
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter, ImageOps

LAUREL_ICON_PATH = r"C:\proyectos\Claude\zoo\img\_work\laurel_icon.png"

INK = (42, 28, 18)
FONT_BOLD = r"C:\Windows\Fonts\georgiab.ttf"
FONT_REG = r"C:\Windows\Fonts\georgia.ttf"

# Plantillas "madera claras" (una por combinación de hábitats, más una para
# las monedas): mismo lienzo (615x878) y composición en las 7 (ventana de
# ilustración, bolsa de monedas arriba-izq., escudo de laureles arriba-dcha.,
# cinta con el nombre, panel de pergamino con el texto) — solo cambia el
# COLOR de la cinta del nombre entre unas y otras (comprobado por diff de
# píxeles: todo lo demás es idéntico), igual que la versión "madera" sin
# aclarar de la que viene. Ver template_key_for_card() en compose_all.py
# para cómo se elige cada una por carta.
TEMPLATES_DIR = r"C:\proyectos\Claude\zoo\img\Nueva carpeta\madera\claras"
TEMPLATE_FILES = {
    "land": "tierra.png",
    "aquatic": "agua.png",
    "bird": "aire.png",
    "land_aquatic": "tierra_agua.png",
    "land_bird": "tierra_aire.png",
    "aquatic_bird": "agua_aire.png",
    "coin": "monedas.png",
}
# Plantillas en RGBA con la ventana de ilustración ya recortada como
# transparencia real (ver _build_template_alpha) — se detecta por flood fill
# la primera vez que hace falta cada una y se cachea aquí en disco, porque
# detectarla es más caro que leer un PNG. Si cambia el arte de una plantilla
# hay que borrar su cache (o el directorio entero) para forzar que se
# vuelva a detectar la ventana.
_ALPHA_CACHE_DIR = r"C:\proyectos\Claude\zoo\img\_work\template_alpha_cache"

# Mismo lienzo (615x878) que el antiguo template3.png: coordenadas sin
# escalar (a diferencia de la versión "Definitivas", en 718x1024).
ILLUSTRATION_BOX = (66, 64, 551, 483)
COST_BADGE = (83, 103)             # center of the coin pouch
PV_BADGE = (524, 86)               # center of the laurel shield
BADGE_NUMBER_SIZE = 50             # 45 + 10%
TITLE_BOX = (95, 513, 540, 561)    # wood ribbon banner: card name
TYPE_LINE_POINT = (307, 648)       # "Terrestre" label, centered in the panel
TYPE_LINE_MAX_WIDTH = 420          # shrink multi-habitat labels to fit
PANEL_BODY_BOX = (95, 672, 540, 858)  # starts right below the type label, top-aligned

COST_COLOR = (0, 100, 0)    # verde bosque
PV_COLOR = (94, 35, 123)    # morado (el mismo que la Hiena en la tanda 4)


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

    filename = TEMPLATE_FILES[template_key]
    template = Image.open(os.path.join(TEMPLATES_DIR, filename)).convert("RGB")
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


def draw_title_with_big_number(draw, box, prefix, number, f_title, f_number, gap=12):
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
    draw.text((start_x, baseline), prefix + " ", font=f_title, fill=(0, 0, 0), anchor="ls")
    draw.text((start_x + prefix_w + gap, baseline), number, font=f_number, fill=(0, 0, 0), anchor="ls")


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

    words = text.split()
    lines, current, current_w = [], [], 0
    for word in words:
        w = token_width(word)
        add_w = w if not current else space_w + w
        if current and current_w + add_w > max_width:
            lines.append(current)
            current, current_w = [word], w
        else:
            current.append(word)
            current_w += add_w
    if current:
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
    draw_centered(draw, TITLE_BOX, name.upper(), f_title, fill=(0, 0, 0))

    f_type = fit_font(draw, habitat_label, TYPE_LINE_MAX_WIDTH, max_size=38, min_size=20)
    draw_centered(draw, TYPE_LINE_POINT, habitat_label, f_type)

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

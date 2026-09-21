"""Rejilla de página compartida por los 4 build_*.py (cartas_zoo.pdf/_en.pdf,
mazo_impresion.pdf/_en.pdf). Filosofía (fijada 2026-09-13, tras corregir un
intento anterior que "inventaba" fondo y recortaba cartas vecinas por
error): las imágenes YA COMPUESTAS (ver compose_card.resize_to_print_size)
llevan su sangrado real de plantilla íntegro, sin recortar. Aquí NO se
recorta nada, NO se rellena nada y NO se solapan cartas entre sí: cada
imagen se pega ENTERA, EN SU TAMAÑO NATIVO, pegada directamente a sus
vecinas (sin hueco) — el sangrado de cada carta se queda pegado al de la
de al lado, nunca superpuesto. Lo único que "se calcula" es cuántas caben
por página y dónde cae, DENTRO de cada imagen, el corte real (inset desde
su borde por el sangrado de la plantilla) para dibujar las marcas de
corte."""
import math

from PIL import Image, ImageDraw

import compose_card as cc

PAGE_W, PAGE_H = 2480, 3508  # A4 @ 300dpi

# Marcas de corte (rediseñadas 2026-09-20 a petición del usuario): una cruz en cada esquina del corte real,
# SIN hueco, que sale hacia el sangrado y además ENTRA un poco en la carta. Antes eran solo trazos por fuera,
# en el sangrado: al dar el primer corte desaparecían y las cartas de enmedio se quedaban sin referencia. La
# parte que entra cae dentro de la zona que luego se redondea (la esquina se corta con radio ~46 px a este
# tamaño, y el tramo de borde a menos de ese radio de la esquina desaparece entero), así que no se ve en la
# carta terminada. Trazo negro con alma blanca: contrasta sobre el sangrado marrón oscuro, sobre el marco y
# sobre el reverso claro, cosa que el magenta de antes no conseguía sobre el marrón.
CROP_MARK_OUT = 34    # px hacia fuera, por el sangrado (el sangrado mide ~37)
CROP_MARK_IN = 26     # px hacia dentro de la carta, siempre menos que el radio de la esquina redondeada
CROP_MARK_WIDTH = 3           # alma clara
CROP_MARK_OUTLINE_WIDTH = 7   # borde oscuro
CROP_MARK_COLOR = (255, 255, 255)
CROP_MARK_OUTLINE_COLOR = (0, 0, 0)

class Grid:
    """cols/rows: cuántas imágenes caben por página, a su tamaño nativo
    tile_w x tile_h (sin escalar). margin_x/y: lo que sobra de página se
    reparte como margen EXTERIOR (nunca como hueco entre cartas). bleed_x/y:
    cuánto del propio tile es sangrado de la plantilla en cada lado (ver
    compose_card.TEMPLATE_BLEED_MARGIN) — el corte real de cada carta cae a
    esa distancia hacia dentro del borde de su tile."""

    def __init__(self, tile_w, tile_h):
        self.tile_w, self.tile_h = tile_w, tile_h
        self.cols = max(1, PAGE_W // tile_w)
        self.rows = max(1, PAGE_H // tile_h)
        self.margin_x = (PAGE_W - self.cols * tile_w) // 2
        self.margin_y = (PAGE_H - self.rows * tile_h) // 2
        # El sangrado del tile es el margen de la plantilla ya escalado por
        # el mismo factor (POR EJE, ver compose_card.resize_to_print_size)
        # que se le aplicó al componer la carta.
        self.bleed_x = round(cc.TEMPLATE_BLEED_MARGIN * (cc.CARD_PRINT_W / cc.TEMPLATE_DESIGN_W))
        self.bleed_y = round(cc.TEMPLATE_BLEED_MARGIN * (cc.CARD_PRINT_H / cc.TEMPLATE_DESIGN_H))
        self.per_page = self.cols * self.rows

    def cell_origin(self, r, c):
        return self.margin_x + c * self.tile_w, self.margin_y + r * self.tile_h

    def cut_bounds(self, r, c):
        """Rectángulo del corte real (post-recorte) de la celda (r, c),
        dentro de su tile — no del tile completo (que incluye sangrado)."""
        x0, y0 = self.cell_origin(r, c)
        return (
            x0 + self.bleed_x, y0 + self.bleed_y,
            x0 + self.tile_w - self.bleed_x, y0 + self.tile_h - self.bleed_y,
        )


def build_grid_for(sample_image_path):
    """Lee el tamaño real de una carta ya compuesta (todas salen del mismo
    tamaño, ver compose_card.resize_to_print_size) y construye la rejilla a
    partir de eso — nunca se asume un tamaño fijo de antemano."""
    with Image.open(sample_image_path) as im:
        return Grid(*im.size)


def _crop_mark_segments(grid, r, c):
    x0, y0, x1, y1 = grid.cut_bounds(r, c)
    for x, dx in ((x0, -1), (x1, 1)):          # dx/dy apuntan hacia FUERA de la carta
        for y, dy in ((y0, -1), (y1, 1)):
            yield [(x + dx * CROP_MARK_OUT, y), (x - dx * CROP_MARK_IN, y)]
            yield [(x, y + dy * CROP_MARK_OUT), (x, y - dy * CROP_MARK_IN)]


def draw_crop_marks(draw, grid, r, c, layer="both"):
    """layer: "outline" solo el borde oscuro, "core" solo el alma clara, "both" las dos."""
    segments = list(_crop_mark_segments(grid, r, c))
    if layer in ("outline", "both"):
        for seg in segments:
            draw.line(seg, fill=CROP_MARK_OUTLINE_COLOR, width=CROP_MARK_OUTLINE_WIDTH)
    if layer in ("core", "both"):
        for seg in segments:
            draw.line(seg, fill=CROP_MARK_COLOR, width=CROP_MARK_WIDTH)

def make_page(grid, images_or_paths):
    """Pega cada imagen ENTERA a su tamaño nativo (grid.tile_w x tile_h),
    sin escalar ni recortar, en celdas pegadas unas a otras (sin hueco).
    Las marcas de corte se dibujan en una segunda pasada, después de pegar
    TODAS las imágenes, para que nunca queden tapadas por la carta vecina."""
    page = Image.new("RGB", (PAGE_W, PAGE_H), (255, 255, 255))
    n = len(images_or_paths)
    for i, item in enumerate(images_or_paths):
        r, c = divmod(i, grid.cols)
        img = item if isinstance(item, Image.Image) else Image.open(item).convert("RGB")
        page.paste(img, grid.cell_origin(r, c))

    draw = ImageDraw.Draw(page)
    # Dos pasadas (todos los bordes oscuros y luego todas las almas claras): las marcas de cartas vecinas se
    # tocan en el sangrado, y asi el borde de una nunca pisa el alma de otra.
    for layer in ("outline", "core"):
        for i in range(n):
            r, c = divmod(i, grid.cols)
            draw_crop_marks(draw, grid, r, c, layer)
    return page


def n_pages_for(grid, total):
    return math.ceil(total / grid.per_page)

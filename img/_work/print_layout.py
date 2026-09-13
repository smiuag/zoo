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

CROP_MARK_GAP = 8     # separación entre el corte real y el inicio de la marca
CROP_MARK_LEN = 22    # longitud de cada trazo
CROP_MARK_WIDTH = 2
CROP_MARK_COLOR = (255, 0, 255)  # magenta vivo: se distingue tanto sobre el sangrado oscuro del frente como sobre el pastel del reverso


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


def draw_crop_marks(draw, grid, r, c):
    x0, y0, x1, y1 = grid.cut_bounds(r, c)
    for x, dx in ((x0, -1), (x1, 1)):
        for y, dy in ((y0, -1), (y1, 1)):
            hx0, hx1 = x + dx * CROP_MARK_GAP, x + dx * (CROP_MARK_GAP + CROP_MARK_LEN)
            draw.line([(hx0, y), (hx1, y)], fill=CROP_MARK_COLOR, width=CROP_MARK_WIDTH)
            vy0, vy1 = y + dy * CROP_MARK_GAP, y + dy * (CROP_MARK_GAP + CROP_MARK_LEN)
            draw.line([(x, vy0), (x, vy1)], fill=CROP_MARK_COLOR, width=CROP_MARK_WIDTH)


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
    for i in range(n):
        r, c = divmod(i, grid.cols)
        draw_crop_marks(draw, grid, r, c)
    return page


def n_pages_for(grid, total):
    return math.ceil(total / grid.per_page)

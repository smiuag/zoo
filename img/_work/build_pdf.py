import glob
import json
import math
import os
from PIL import Image, JpegImagePlugin  # noqa: F401  (forces JPEG codec registration for PDF export)

Image.init()

CARDS_DIR = r"C:\proyectos\Claude\zoo\img\cards"
DATA_DIR = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
OUT_PDF = r"C:\proyectos\Claude\zoo\img\cartas_zoo.pdf"
BACK_PATH = os.path.join(CARDS_DIR, "_back.png")

PAGE_W, PAGE_H = 2480, 3508  # A4 @ 300dpi
COLS, ROWS = 3, 3
MARGIN = 60
GAP = 40

cell_w = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP) // COLS
cell_h = (PAGE_H - 2 * MARGIN - (ROWS - 1) * GAP) // ROWS


def load_costs():
    """id -> marketCost, leído directamente de los datos de cartas (coin-1
    no tiene coste real: queda a 0 por defecto, así que sale primero)."""
    costs = {}
    for path in glob.glob(os.path.join(DATA_DIR, "*.json")):
        with open(path, encoding="utf-8") as f:
            card = json.load(f)
        costs[card["id"]] = card.get("marketCost", 0)
    return costs


# Las 4 monedas van siempre las primeras (en este orden), delante de
# cualquier animal aunque coincida en coste.
COIN_ORDER = {"coin-1": 0, "coin-2": 1, "coin-3": 2, "coin-5": 3}


def load_cards():
    costs = load_costs()
    paths = [p for p in glob.glob(os.path.join(CARDS_DIR, "*.png")) if p != BACK_PATH]

    def sort_key(path):
        cid = os.path.splitext(os.path.basename(path))[0]
        if cid in COIN_ORDER:
            return (0, COIN_ORDER[cid])
        return (1, costs.get(cid, 0), cid)

    return sorted(paths, key=sort_key)


def make_page(card_paths):
    page = Image.new("RGB", (PAGE_W, PAGE_H), (255, 255, 255))
    for i, path in enumerate(card_paths):
        r, c = divmod(i, COLS)
        card = Image.open(path).convert("RGB")
        cw, ch = card.size
        scale = min(cell_w / cw, cell_h / ch)
        new_size = (int(cw * scale), int(ch * scale))
        card = card.resize(new_size, Image.LANCZOS)
        x = MARGIN + c * (cell_w + GAP) + (cell_w - new_size[0]) // 2
        y = MARGIN + r * (cell_h + GAP) + (cell_h - new_size[1]) // 2
        page.paste(card, (x, y))
    return page


def main():
    card_paths = load_cards()
    per_page = COLS * ROWS
    n_pages = math.ceil(len(card_paths) / per_page)
    # Este PDF es solo de referencia (no para imprimir a doble cara): todos
    # los frentes primero, y al final UNA sola página de reverso, solo para
    # ver cómo queda.
    all_pages = []
    for p in range(n_pages):
        chunk = card_paths[p * per_page:(p + 1) * per_page]
        all_pages.append(make_page(chunk))
        print(f"page {p+1}/{n_pages}: {len(chunk)} cards")

    all_pages.append(make_page([BACK_PATH] * per_page))

    all_pages[0].save(OUT_PDF, save_all=True, append_images=all_pages[1:])
    print(f"\nSaved {OUT_PDF} ({n_pages} páginas de frente + 1 de reverso de muestra, {len(card_paths)} cartas)")


if __name__ == "__main__":
    main()

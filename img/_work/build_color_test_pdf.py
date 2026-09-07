import glob
import json
import math
import os
from PIL import Image, JpegImagePlugin  # noqa: F401

Image.init()

CARDS_DIR = r"C:\proyectos\Claude\zoo\img\cards_colortest"
DATA_DIR = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
OUT_PDF = r"C:\proyectos\Claude\zoo\img\cartas_zoo_colores.pdf"

PAGE_W, PAGE_H = 2480, 3508
COLS, ROWS = 3, 3
MARGIN = 60
GAP = 40

cell_w = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP) // COLS
cell_h = (PAGE_H - 2 * MARGIN - (ROWS - 1) * GAP) // ROWS


def load_costs():
    costs = {}
    for path in glob.glob(os.path.join(DATA_DIR, "*.json")):
        with open(path, encoding="utf-8") as f:
            card = json.load(f)
        costs[card["id"]] = card.get("marketCost", 0)
    return costs


COIN_ORDER = {"coin-1": 0, "coin-2": 1, "coin-3": 2}


def load_cards(cards_dir=CARDS_DIR):
    costs = load_costs()
    paths = glob.glob(os.path.join(cards_dir, "*.png"))

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


def build(cards_dir=CARDS_DIR, out_pdf=OUT_PDF):
    card_paths = load_cards(cards_dir)
    per_page = COLS * ROWS
    n_pages = math.ceil(len(card_paths) / per_page)
    pages = []
    for p in range(n_pages):
        chunk = card_paths[p * per_page:(p + 1) * per_page]
        pages.append(make_page(chunk))
        print(f"page {p+1}/{n_pages}: {len(chunk)} cards")

    pages[0].save(out_pdf, save_all=True, append_images=pages[1:])
    print(f"\nSaved {out_pdf} ({n_pages} pages, {len(card_paths)} cards) - solo frentes, cada uno con un color distinto de coste/PV")


def main():
    build()


if __name__ == "__main__":
    main()

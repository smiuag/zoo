import glob
import json
import math
import os
from PIL import Image, JpegImagePlugin  # noqa: F401  (forces JPEG codec registration for PDF export)

Image.init()

CARDS_DIR = r"C:\proyectos\Claude\zoo\img\cards"
DATA_DIR = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
OUT_PDF = r"C:\proyectos\Claude\zoo\img\mazo_impresion.pdf"
BACK_PATH = os.path.join(CARDS_DIR, "_back.png")

PAGE_W, PAGE_H = 2480, 3508  # A4 @ 300dpi
COLS, ROWS = 3, 3
MARGIN = 60
GAP = 40

cell_w = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP) // COLS
cell_h = (PAGE_H - 2 * MARGIN - (ROWS - 1) * GAP) // ROWS

# Copias pedidas para esta tirada de impresión.
COUNTS = {
    "sloth": 26,
    "coin-1": 49,
    "coin-2": 18,
    "coin-3": 11,
}
DEFAULT_ANIMAL_COPIES = 10  # especies de coste < 5: 10 copias cada una
HIGH_COST_ANIMAL_COPIES = 5  # especies de coste 5 o más: solo 5 copias (escasez), igual que el motor


def load_costs():
    costs = {}
    for path in glob.glob(os.path.join(DATA_DIR, "*.json")):
        with open(path, encoding="utf-8") as f:
            card = json.load(f)
        costs[card["id"]] = card.get("marketCost", 0)
    return costs


# Las 3 monedas van siempre las primeras (en este orden), delante de
# cualquier animal aunque coincida en coste.
COIN_ORDER = {"coin-1": 0, "coin-2": 1, "coin-3": 2}


def sort_key(cid, costs):
    if cid in COIN_ORDER:
        return (0, COIN_ORDER[cid])
    return (1, costs.get(cid, 0), cid)


def copies_for(cid, costs):
    if cid in COUNTS:
        return COUNTS[cid]
    return HIGH_COST_ANIMAL_COPIES if costs.get(cid, 0) >= 5 else DEFAULT_ANIMAL_COPIES


def build_deck():
    costs = load_costs()
    png_ids = [
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(CARDS_DIR, "*.png"))
        if p != BACK_PATH
    ]

    ordered_ids = sorted(png_ids, key=lambda cid: sort_key(cid, costs))

    deck = []
    for cid in ordered_ids:
        deck.extend([os.path.join(CARDS_DIR, f"{cid}.png")] * copies_for(cid, costs))
    return deck, ordered_ids, costs


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
    deck, ordered_ids, costs = build_deck()
    per_page = COLS * ROWS
    n_pages = math.ceil(len(deck) / per_page)
    # Frente y reverso alternados (frente1, reverso1, frente2, reverso2...)
    # para que la impresión a doble cara automática empareje cada hoja sin
    # tener que dar la vuelta al taco de papel a mano.
    all_pages = []
    for p in range(n_pages):
        chunk = deck[p * per_page:(p + 1) * per_page]
        all_pages.append(make_page(chunk))
        all_pages.append(make_page([BACK_PATH] * len(chunk)))
        print(f"page {p+1}/{n_pages}: {len(chunk)} cards")

    all_pages[0].save(OUT_PDF, save_all=True, append_images=all_pages[1:])

    print(f"\nSaved {OUT_PDF} ({len(all_pages)} páginas alternadas frente/reverso, {len(deck)} cartas)")
    print("\nResumen de copias:")
    for cid in ordered_ids:
        n = copies_for(cid, costs)
        print(f"  {cid:14} x{n}  (coste {costs.get(cid, 0)})")


if __name__ == "__main__":
    main()

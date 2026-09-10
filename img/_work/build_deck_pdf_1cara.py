import glob
import json
import math
import os
from PIL import Image, JpegImagePlugin  # noqa: F401  (forces JPEG codec registration for PDF export)

Image.init()

CARDS_DIR = r"C:\proyectos\Claude\zoo\img\cards"
DATA_DIR = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
OUT_PDF = r"C:\proyectos\Claude\zoo\img\mazo_impresion_1cara.pdf"
BACK_PATH = os.path.join(CARDS_DIR, "_back.png")

PAGE_W, PAGE_H = 2480, 3508  # A4 @ 300dpi
COLS, ROWS = 3, 3
MARGIN = 60
GAP = 40

cell_w = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP) // COLS
cell_h = (PAGE_H - 2 * MARGIN - (ROWS - 1) * GAP) // ROWS

# Igual que build_deck_pdf.py, pero pensado para imprimir a 1 sola cara (sin
# reverso): no hace falta que el total sea múltiplo de 18 (9 delante + 9
# detrás por hoja), basta con que sea múltiplo de 9 (una página de 3x3 sin
# huecos vacíos). Menos monedas de 1 y de perezosos que la tirada a 2 caras;
# si el total no cuadra a múltiplo de 9, se recorta 1 copia de moneda de 2 o
# de 3 (nunca de 1 ni de perezoso, que son las cantidades pedidas) hasta que
# cuadre.
COUNTS = {
    "sloth": 20,
    "coin-1": 35,
    "coin-2": 20,
    "coin-3": 12,
}
DEFAULT_ANIMAL_COPIES = 10  # especies de coste < 5: 10 copias cada una
HIGH_COST_ANIMAL_COPIES = 6  # especies de coste 5 o más: solo 6 copias (escasez), igual que el motor


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

    if len(deck) % per_page != 0:
        raise SystemExit(
            f"El total ({len(deck)}) no es múltiplo de {per_page}: ajusta COUNTS "
            "(quita/añade copias de coin-2 o coin-3) antes de generar el PDF."
        )

    n_pages = len(deck) // per_page
    # A 1 sola cara: solo frentes, sin ninguna página de reverso.
    all_pages = []
    for p in range(n_pages):
        chunk = deck[p * per_page:(p + 1) * per_page]
        all_pages.append(make_page(chunk))
        print(f"page {p+1}/{n_pages}: {len(chunk)} cards")

    all_pages[0].save(OUT_PDF, save_all=True, append_images=all_pages[1:])

    print(f"\nSaved {OUT_PDF} ({n_pages} páginas a 1 cara, {len(deck)} cartas, múltiplo de {per_page})")
    print("\nResumen de copias:")
    for cid in ordered_ids:
        n = copies_for(cid, costs)
        print(f"  {cid:14} x{n}  (coste {costs.get(cid, 0)})")


if __name__ == "__main__":
    main()

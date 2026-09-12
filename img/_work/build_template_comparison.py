"""Genera un cartas_zoo.pdf POR CADA variante de plantilla en img/templates/
(claras, definitivas, medias, normal, primeras), para poder compararlas
entre sí sin tocar la plantilla "real" que use compose_card.py ahora mismo
(se restaura tal cual al terminar). Los PDF salen a img/templates/
cartas_zoo_<variante>.pdf. Uso: python build_template_comparison.py
"""
import glob
import math
import os
import shutil

from PIL import Image

import compose_all as ca
import compose_card as cc

TEMPLATES_ROOT = r"C:\proyectos\Claude\zoo\img\templates"
OUT_DIR = TEMPLATES_ROOT
SCRATCH_CARDS_DIR = r"C:\proyectos\Claude\zoo\img\_work\_template_compare_cards"
SCRATCH_ALPHA_DIR = r"C:\proyectos\Claude\zoo\img\_work\_template_compare_alpha"

# Las convenciones de nombre de fichero ya vistas en las plantillas de este
# proyecto (ver print_asset_pipeline en memoria): "Definitivas"/"primeras"
# van en 718x1024 con nombres mixtos jpg/png y 1 sola plantilla de moneda;
# "claras"/"medias"/"normal" van en 615x878, todo en minúscula .png, también
# con 1 sola plantilla de moneda; "medias_hojas" va en 615x878 pero con una
# plantilla DISTINTA por cada denominación de moneda (moneda_cobre =
# coin-1/Bronce, moneda_plata = coin-2/Plata, moneda_oro = coin-3/Oro,
# moneda_platino = coin-5/Platino) en vez de una genérica "monedas.*". Se
# detecta cuál toca por los ficheros que de verdad haya en la carpeta, no
# por su nombre.
NAME_STYLES = [
    {
        "habitats": {
            "land": "Tierra.jpg", "aquatic": "agua.jpg", "bird": "aire.jpg",
            "land_aquatic": "Tierra_agua.png", "land_bird": "Tierra_aire.png",
            "aquatic_bird": "agua_aire.png",
        },
        "coins": {"coin": "monedas.jpg"},
    },
    {
        "habitats": {
            "land": "tierra.png", "aquatic": "agua.png", "bird": "aire.png",
            "land_aquatic": "tierra_agua.png", "land_bird": "tierra_aire.png",
            "aquatic_bird": "agua_aire.png",
        },
        "coins": {"coin": "monedas.png"},
    },
    {
        "habitats": {
            "land": "tierra.png", "aquatic": "agua.png", "bird": "aire.png",
            "land_aquatic": "tierra_agua.png", "land_bird": "tierra_aire.png",
            "aquatic_bird": "agua_aire.png",
        },
        "coins": {
            "coin-1": "moneda_cobre.png", "coin-2": "moneda_plata.png",
            "coin-3": "moneda_oro.png", "coin-5": "moneda_platino.png",
        },
    },
]

# Coordenadas base (615x878, ver compose_card.py de la versión "madera"):
# se usan tal cual para plantillas de ese mismo lienzo, o escaladas para las
# de 718x1024 (ver _SCALE_* más abajo) — mismo criterio ya validado antes.
BASE_ILLUSTRATION_BOX = (66, 64, 551, 483)
BASE_COST_BADGE = (83, 103)
BASE_PV_BADGE = (524, 86)
BASE_TITLE_BOX = (95, 513, 540, 561)
BASE_TYPE_LINE_POINT = (307, 648)
BASE_TYPE_LINE_MAX_WIDTH = 420
BASE_PANEL_BODY_BOX = (95, 672, 540, 858)
BASE_CANVAS = (615, 878)


def detect_style(variant_dir):
    files = set(os.listdir(variant_dir))
    for style in NAME_STYLES:
        required = set(style["habitats"].values()) | set(style["coins"].values())
        if required.issubset(files):
            return style
    raise SystemExit(f"{variant_dir}: no encaja con ninguna convención de nombre conocida (ficheros: {sorted(files)})")


def template_key_for(card, style):
    if card["type"] == "coin":
        # Estilo "1 sola plantilla de moneda" -> clave genérica "coin"; estilo
        # "1 plantilla por denominación" -> la propia id de la carta
        # (coin-1/coin-2/coin-3/coin-5), que debe existir en style["coins"].
        return "coin" if "coin" in style["coins"] else card["id"]
    return ca.template_key_for_card(card)


def configure_variant(variant_dir, out_alpha_dir, style):
    sample_file = next(iter(style["habitats"].values()))
    sample = Image.open(os.path.join(variant_dir, sample_file))
    w, h = sample.size
    scale_x = w / BASE_CANVAS[0]
    scale_y = h / BASE_CANVAS[1]

    def sx(x):
        return round(x * scale_x)

    def sy(y):
        return round(y * scale_y)

    cc.TEMPLATES_DIR = variant_dir
    cc.TEMPLATE_FILES = {**style["habitats"], **style["coins"]}
    cc._ALPHA_CACHE_DIR = out_alpha_dir
    cc.ILLUSTRATION_BOX = (sx(BASE_ILLUSTRATION_BOX[0]), sy(BASE_ILLUSTRATION_BOX[1]),
                            sx(BASE_ILLUSTRATION_BOX[2]), sy(BASE_ILLUSTRATION_BOX[3]))
    cc.COST_BADGE = (sx(BASE_COST_BADGE[0]), sy(BASE_COST_BADGE[1]))
    cc.PV_BADGE = (sx(BASE_PV_BADGE[0]), sy(BASE_PV_BADGE[1]))
    cc.TITLE_BOX = (sx(BASE_TITLE_BOX[0]), sy(BASE_TITLE_BOX[1]), sx(BASE_TITLE_BOX[2]), sy(BASE_TITLE_BOX[3]))
    cc.TYPE_LINE_POINT = (sx(BASE_TYPE_LINE_POINT[0]), sy(BASE_TYPE_LINE_POINT[1]))
    cc.TYPE_LINE_MAX_WIDTH = round(BASE_TYPE_LINE_MAX_WIDTH * scale_x)
    cc.PANEL_BODY_BOX = (sx(BASE_PANEL_BODY_BOX[0]), sy(BASE_PANEL_BODY_BOX[1]),
                          sx(BASE_PANEL_BODY_BOX[2]), sy(BASE_PANEL_BODY_BOX[3]))


def compose_variant_cards(cards, out_cards_dir, style):
    os.makedirs(out_cards_dir, exist_ok=True)
    for card in cards:
        cid = card["id"]
        ctype = card["type"]
        if ctype == "animal":
            photo = os.path.join(ca.IMG_DIR, ca.SPECIES_PHOTO[card["species"]])
            name = card["name"]
            if len(card["habitats"]) == len(ca.HABITAT_ORDER):
                type_label = "Todoterreno"
            else:
                type_label = " - ".join(ca.HABITAT_ES[h] for h in ca.HABITAT_ORDER if h in card["habitats"])
            cost, pv, text = card["marketCost"], card["victoryPoints"], card["text"]
        elif ctype == "coin":
            photo = os.path.join(ca.IMG_DIR, ca.COIN_PHOTO[cid])
            name = card["name"]
            type_label = "Moneda"
            cost = card["marketCost"] if card.get("marketCost") else "-"
            pv, text = card["victoryPoints"], card["text"]
        else:
            continue

        out_path = os.path.join(out_cards_dir, f"{cid}.png")
        ca.compose_generic(photo, name, type_label, cost, pv, text, out_path,
                            template_key_for(card, style), is_coin=(ctype == "coin"))


def build_pdf(cards_dir, out_pdf):
    PAGE_W, PAGE_H, COLS, ROWS, MARGIN, GAP = 2480, 3508, 3, 3, 60, 40
    cell_w = (PAGE_W - 2 * MARGIN - (COLS - 1) * GAP) // COLS
    cell_h = (PAGE_H - 2 * MARGIN - (ROWS - 1) * GAP) // ROWS

    paths = sorted(glob.glob(os.path.join(cards_dir, "*.png")))

    def make_page(chunk):
        page = Image.new("RGB", (PAGE_W, PAGE_H), (255, 255, 255))
        for i, path in enumerate(chunk):
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

    per_page = COLS * ROWS
    n_pages = math.ceil(len(paths) / per_page)
    pages = [make_page(paths[p * per_page:(p + 1) * per_page]) for p in range(n_pages)]
    pages[0].save(out_pdf, save_all=True, append_images=pages[1:])
    print(f"  guardado {out_pdf} ({len(paths)} cartas, {n_pages} paginas)")


def main():
    # Restaurar la configuración "real" de compose_card.py al terminar, la
    # toquemos o no (por si algún día deja de coincidir con la 1a variante).
    original = {k: getattr(cc, k) for k in (
        "TEMPLATES_DIR", "TEMPLATE_FILES", "_ALPHA_CACHE_DIR", "ILLUSTRATION_BOX",
        "COST_BADGE", "PV_BADGE", "TITLE_BOX", "TYPE_LINE_POINT", "TYPE_LINE_MAX_WIDTH", "PANEL_BODY_BOX",
    )}

    cards = ca.load_cards()
    variants = sorted(
        d for d in os.listdir(TEMPLATES_ROOT) if os.path.isdir(os.path.join(TEMPLATES_ROOT, d))
    )
    try:
        for variant in variants:
            print(f"=== {variant} ===")
            variant_dir = os.path.join(TEMPLATES_ROOT, variant)
            out_cards_dir = os.path.join(SCRATCH_CARDS_DIR, variant)
            out_alpha_dir = os.path.join(SCRATCH_ALPHA_DIR, variant)
            style = detect_style(variant_dir)
            configure_variant(variant_dir, out_alpha_dir, style)
            compose_variant_cards(cards, out_cards_dir, style)
            build_pdf(out_cards_dir, os.path.join(OUT_DIR, f"cartas_zoo_{variant}.pdf"))
    finally:
        for k, v in original.items():
            setattr(cc, k, v)
        shutil.rmtree(SCRATCH_CARDS_DIR, ignore_errors=True)
        shutil.rmtree(SCRATCH_ALPHA_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()

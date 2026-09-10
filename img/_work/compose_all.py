import json
import glob
import os
from PIL import Image, ImageDraw, ImageFont

import compose_card as cc

DATA_DIR = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
IMG_DIR = r"C:\proyectos\Claude\zoo\img"
OUT_DIR = r"C:\proyectos\Claude\zoo\img\cards"
os.makedirs(OUT_DIR, exist_ok=True)

HABITAT_ES = {"land": "Terrestre", "aquatic": "Acu\u00e1tico", "bird": "Volador"}
# Mismo orden que apps/web/src/lib/cardVisuals.ts (habitatLabel): tierra,
# aire, agua. Los animales con varios h\u00e1bitats a la vez (Ping\u00fcino,
# Hipop\u00f3tamo, Cocodrilo) muestran los que tengan, unidos con " - ".
HABITAT_ORDER = ["land", "bird", "aquatic"]

SPECIES_PHOTO = {
    "monkey": "monos.jpg",
    "penguin": "pinguino.jpg",
    "peacock": "pavoreal.jpg",
    "lion": "leones.jpg",
    "tiger": "tigres.jpg",
    "dolphin": "delfin.jpg",
    "goldfish": "pecesColores.jpg",
    "snake": "serpiente.jpg",
    "parrot": "loros.jpg",
    "elephant": "elefantes.jpg",
    "giraffe": "jirafas.jpg",
    "spider": "ara\u00f1as.jpg",
    "hyena": "hienas.jpg",
    "orca": "orca.jpg",
    "polar-bear": "osopolar.jpg",
    "albatross": "albatros.jpg",
    "crocodile": "cocodrilos.jpg",
    "hippopotamus": "hipopotamos.jpg",
    "vulture": "buitres.jpg",
    "sloth": "perezoso.jpg",
    "duck": "patos.jpg",
    "flamingo": "flamencos.jpg",
    "seal": "focas.jpg",
    "parakeet": "periquitos.jpg",
    "owl": "buho.jpg",
    "bat": "zorroVolador.jpg",
    "turtle": "tortugas.jpg",
    "platypus": "ornitorrinco.jpg",
    "rabbit": "conejos.jpg",
    "eagle": "aguilas.jpg",
}
COIN_PHOTO = {
    "coin-1": "moneda1.jpg",
    "coin-2": "moneda2.jpg",
    "coin-3": "moneda3.jpg",
}


def load_cards():
    cards = []
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            cards.append(json.load(f))
    return cards


def compose_generic(photo_path, name, type_label, cost, pv, text, out_path, is_coin=False,
                     badge_color=None, cost_color=None, pv_color=None):
    card = cc.build_card_base(photo_path)
    draw = ImageDraw.Draw(card)

    f_cost = ImageFont.truetype(cc.FONT_BOLD, cc.BADGE_NUMBER_SIZE)
    f_title_number = ImageFont.truetype(cc.FONT_BOLD, 54)
    f_body = cc.fit_body_font(draw, text, cc.PANEL_BODY_BOX, max_size=26)

    c_cost = cost_color or badge_color or cc.COST_COLOR
    c_pv = pv_color or badge_color or cc.PV_COLOR
    cc.draw_centered(draw, cc.COST_BADGE, str(cost), f_cost, fill=c_cost)
    if pv is not None:
        cc.draw_centered(draw, cc.PV_BADGE, str(pv), f_cost, fill=c_pv)

    title_box_w = cc.TITLE_BOX[2] - cc.TITLE_BOX[0] - 16
    # Antes los nombres de moneda tenían dos palabras ("MONEDA DE ORO"), y se
    # partían en "prefijo chico" + "última palabra grande". Ahora son de una
    # sola palabra (Oro/Plata/Bronce): sin espacio que partir, se pinta como
    # un título normal en vez de intentar el split y reventar.
    if is_coin and " " in name:
        prefix, number = name.upper().rsplit(" ", 1)
        f_title = cc.fit_font(draw, prefix + " " + number, title_box_w, max_size=37)
        cc.draw_title_with_big_number(draw, cc.TITLE_BOX, prefix, number, f_title, f_title_number)
    else:
        f_title = cc.fit_font(draw, name.upper(), title_box_w, max_size=37)
        cc.draw_centered(draw, cc.TITLE_BOX, name.upper(), f_title, fill=(248, 226, 178))

    f_type = cc.fit_font(draw, type_label, cc.TYPE_LINE_MAX_WIDTH, max_size=38, min_size=20)
    cc.draw_centered(draw, cc.TYPE_LINE_POINT, type_label, f_type)
    cc.draw_wrapped(card, draw, cc.PANEL_BODY_BOX, text, f_body, valign="top")

    card.save(out_path)


def main():
    cards = load_cards()
    generated = []
    for card in cards:
        cid = card["id"]
        ctype = card["type"]
        if ctype == "animal":
            photo = os.path.join(IMG_DIR, SPECIES_PHOTO[card["species"]])
            name = card["name"]
            # Un animal con los 3 hábitats a la vez (Pingüino, Pato) se
            # etiqueta "Todoterreno" en vez de listar los 3 por separado.
            if len(card["habitats"]) == len(HABITAT_ORDER):
                type_label = "Todoterreno"
            else:
                type_label = " - ".join(HABITAT_ES[h] for h in HABITAT_ORDER if h in card["habitats"])
            cost = card["marketCost"]
            pv = card["victoryPoints"]
            text = card["text"]
        elif ctype == "coin":
            photo = os.path.join(IMG_DIR, COIN_PHOTO[cid])
            name = card["name"]
            type_label = "Moneda"
            # coin-2/coin-3 se pueden comprar (marketCost > 0); coin-1 no.
            cost = card["marketCost"] if card.get("marketCost") else "-"
            pv = card["victoryPoints"]
            text = card["text"]
        else:
            continue

        out_path = os.path.join(OUT_DIR, f"{cid}.png")
        compose_generic(photo, name, type_label, cost, pv, text, out_path, is_coin=(ctype == "coin"))
        generated.append(out_path)
        print("generated", cid)

    print(f"\nTotal: {len(generated)} cards")
    return generated


if __name__ == "__main__":
    main()

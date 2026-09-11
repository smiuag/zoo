import os
import shutil

from PIL import Image, ImageDraw, ImageFont

import compose_card as cc
import compose_all as ca
from card_text_en import CARD_TEXT_EN, HABITAT_EN

IMG_DIR = r"C:\proyectos\Claude\zoo\img"
OUT_DIR = r"C:\proyectos\Claude\zoo\img\cards_en"
os.makedirs(OUT_DIR, exist_ok=True)


def main():
    cards = ca.load_cards()
    generated = []
    for card in cards:
        cid = card["id"]
        ctype = card["type"]
        name, text = CARD_TEXT_EN[cid]

        if ctype == "animal":
            photo = os.path.join(IMG_DIR, ca.SPECIES_PHOTO[card["species"]])
            type_label = " - ".join(HABITAT_EN[h] for h in ca.HABITAT_ORDER if h in card["habitats"])
            cost = card["marketCost"]
            pv = card["victoryPoints"]
        elif ctype == "coin":
            photo = os.path.join(IMG_DIR, ca.COIN_PHOTO[cid])
            type_label = "Coin"
            cost = card["marketCost"] if card.get("marketCost") else "-"
            pv = card["victoryPoints"]
        else:
            continue

        out_path = os.path.join(OUT_DIR, f"{cid}.png")
        ca.compose_generic(photo, name, type_label, cost, pv, text, out_path, is_coin=(ctype == "coin"))
        generated.append(out_path)
        print("generated", cid)

    back_src = os.path.join(IMG_DIR, "cards", "_back.png")
    back_dst = os.path.join(OUT_DIR, "_back.png")
    shutil.copyfile(back_src, back_dst)
    print("copied _back.png")

    print(f"\nTotal: {len(generated)} cards")
    return generated


if __name__ == "__main__":
    main()

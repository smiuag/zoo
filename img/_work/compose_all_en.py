import os
import shutil

import compose_card as cc
import compose_all as ca
from card_text_en import CARD_TEXT_EN, HABITAT_EN

IMG_DIR = r"C:\proyectos\Claude\zoo\img"
OUT_DIR = r"C:\proyectos\Claude\zoo\img\cards_en" if ca.EDITION == "classic" else r"C:\proyectos\Claude\zoo\img\cards_completa_en"   # ver ca.EDITION
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
            type_label = ca.type_label_for(card["habitats"], HABITAT_EN, None)   # en ingles nunca hubo "todoterreno": se listan los 3
            cost = card["marketCost"]
            pv = card["victoryPoints"]
        elif ctype == "coin":
            # Sin texto que traducir (ver ca.COIN_IMAGE): misma imagen que la
            # versión española, solo redimensionada al tamaño de impresión.
            out_path = os.path.join(OUT_DIR, f"{cid}.png")
            coin_card = cc.build_coin_card_base(ca.COIN_IMAGE[cid])
            coin_card = cc.resize_to_print_size(coin_card)
            coin_card.save(out_path)
            generated.append(out_path)
            print("generated", cid, "(coin image, mounted on the coin template)")
            continue
        else:
            continue

        import compose_card_iconos                      # diseno oficial con iconos, ver compose_all.py
        out_path = compose_card_iconos.compose_official(card, "en", OUT_DIR)
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

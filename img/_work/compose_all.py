import json
import glob
import os
from PIL import Image, ImageDraw, ImageFont

import compose_card as cc
from card_text_es_print import CARD_TEXT_ES_PRINT

DATA_DIR = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
IMG_DIR = r"C:\proyectos\Claude\zoo\img"
# Edicion que se compone. "classic" (por defecto) es la OFICIAL: las cartas de
# siempre con sus 3 habitats, lo unico que va a img/cards y a los PDFs. "full"
# anade mascotas y dinosaurios (cartas con "edition": "full" y tipos extra
# pet/dinosaur); es de pruebas y va a carpetas aparte, nunca a los PDFs:
#   ZOO_EDITION=full /c/Python310/python img/_work/compose_all.py
EDITION = os.environ.get("ZOO_EDITION", "classic")
OUT_DIR = r"C:\proyectos\Claude\zoo\img\cards" if EDITION == "classic" else r"C:\proyectos\Claude\zoo\img\cards_completa"
os.makedirs(OUT_DIR, exist_ok=True)

HABITAT_ES = {"land": "Terrestre", "aquatic": "Acu\u00e1tico", "bird": "Volador", "pet": "Mascota", "dinosaur": "Dinosaurio"}
# Mismo orden que apps/web/src/lib/cardVisuals.ts (habitatLabel): tierra,
# aire, agua. Los animales con varios h\u00e1bitats a la vez (Ping\u00fcino,
# Hipop\u00f3tamo, Cocodrilo) muestran los que tengan, unidos con " - ".
HABITAT_ORDER = ["land", "bird", "aquatic"]
# Tipos extra (2026-09-20): van en la misma lista "habitats" de la carta pero no
# son habitat: no deciden la plantilla y se escriben detras de los habitats.
EXTRA_TYPE_ORDER = ["pet", "dinosaur"]


def type_label_for(habitats, names, all_terrain):
    """Etiqueta de tipo de una carta: habitats (o `all_terrain` si tiene los 3) + tipos extra."""
    base = [h for h in HABITAT_ORDER if h in habitats]
    parts = [all_terrain] if all_terrain and len(base) == len(HABITAT_ORDER) else [names[h] for h in base]
    return " - ".join(parts + [names[h] for h in EXTRA_TYPE_ORDER if h in habitats])

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
    "shark": "tiburones.jpg",
    "toucan": "tucan.jpg",
    "squirrel": "ardillas.jpg",
    "raven": "cuevos.jpg",
    # Mascotas y dinosaurios (2026-09-20). OJO: los archivos del tiranosaurio y el
    # triceratops llegaron con el nombre cruzado: tiranosaurios.jpg muestra un
    # triceratops y triceratops.jpg muestra el tiranosaurio, asi que se usa este.
    "dog": "perros.jpg",
    "cat": "gatos.jpg",
    "diplodocus": "diplodocus.jpg",
    "tyrannosaurus": "triceratops.jpg",
    "pterodactyl": "terodactilo.jpg",
    "mosasaurus": "mosasaurus.jpg",
    # Segunda tanda de la edicion completa (2026-09-21)
    "chicken": "gallina.jpg",
    "golden-fish": "pezdorado.jpg",
    "hamster": "hamsters.jpg",
    "hummingbird": "colibri.jpg",
    "iguana": "iguanas.jpg",
    "ostrich": "avestruz.jpg",
    "otter": "nutrias.jpg",
    "pig": "cerdos.jpg",
    "plesiosaurus": "plesiosaurio.jpg",
    "pteranodon": "ptenarodon.jpg",
}
COIN_PHOTO = {
    "coin-1": "moneda1.jpg",
    "coin-2": "moneda2.jpg",
    "coin-3": "moneda3.jpg",
    "coin-5": "moneda5.jpg",
}
# Cartas de moneda ya compuestas del todo (marco + ilustracion + badges de
# coste/PV ya pintados por compose_coin_full.py, sin ribbon de titulo ni
# panel de texto) en img/coins/ — se usan tal cual, sin pasar por
# compose_generic ni por ninguna plantilla de img/templates/.
COIN_IMAGE = {
    "coin-1": os.path.join(r"C:\proyectos\Claude\zoo\img\coins", "moneda1_marco_intento.png"),
    "coin-2": os.path.join(r"C:\proyectos\Claude\zoo\img\coins", "moneda2_marco_intento.png"),
    "coin-3": os.path.join(r"C:\proyectos\Claude\zoo\img\coins", "moneda3_marco_intento.png"),
    "coin-5": os.path.join(r"C:\proyectos\Claude\zoo\img\coins", "moneda5_marco_intento.png"),
}
BODY_MAX_SIZE_OVERRIDE: dict[str, int] = {}


def load_cards():
    cards = []
    for path in sorted(glob.glob(os.path.join(DATA_DIR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            card = json.load(f)
        if EDITION == "classic":
            if card.get("edition", "classic") != "classic":
                continue                                    # carta solo de la edicion completa
            card["habitats"] = [h for h in card.get("habitats", []) if h in HABITAT_ORDER]   # sin tipos extra
        cards.append(card)
    return cards


# Qué plantilla le toca a una carta según su combinación exacta de hábitats
# (o "coin" si es una moneda). Ver cc.TEMPLATE_FILES. La combinación de los
# 3 hábitats ("todoterreno") usa la plantilla triple tierra_agua_aire.
def template_key_for_card(card):
    if card["type"] == "coin":
        return "coin"
    habitats = frozenset(h for h in card.get("habitats", []) if h in HABITAT_ORDER)   # los tipos extra no deciden plantilla
    key = {
        frozenset(["land"]): "land",
        frozenset(["aquatic"]): "aquatic",
        frozenset(["bird"]): "bird",
        frozenset(["land", "aquatic"]): "land_aquatic",
        frozenset(["land", "bird"]): "land_bird",
        frozenset(["aquatic", "bird"]): "aquatic_bird",
        frozenset(["land", "aquatic", "bird"]): "land_aquatic_bird",
    }.get(habitats)
    if key is None:
        raise ValueError(f"Sin plantilla para la combinación de hábitats {sorted(habitats)} (carta {card['id']})")
    return key


def compose_generic(photo_path, name, type_label, cost, pv, text, out_path, template_key, is_coin=False,
                     badge_color=None, cost_color=None, pv_color=None, body_max_size=26):
    card = cc.build_card_base(photo_path, template_key)
    draw = ImageDraw.Draw(card)

    f_cost = ImageFont.truetype(cc.FONT_BOLD, cc.BADGE_NUMBER_SIZE)
    f_title_number = ImageFont.truetype(cc.FONT_BOLD, 54)
    f_body = cc.fit_body_font(draw, text, cc.PANEL_BODY_BOX, max_size=body_max_size)

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
        cc.draw_curved_text(card, cc.TITLE_BOX, name.upper(), f_title, fill=cc.HEADING_INK)

    f_type = cc.fit_font(draw, type_label, cc.TYPE_LINE_MAX_WIDTH, max_size=38, min_size=20)
    cc.draw_centered(draw, cc.TYPE_LINE_POINT, type_label, f_type, fill=cc.HEADING_INK)
    cc.draw_wrapped(card, draw, cc.PANEL_BODY_BOX, text, f_body, valign="top")

    card = cc.resize_to_print_size(card)
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
            # Un animal con los 3 hábitats a la vez se etiqueta "Todoterreno"
            # en vez de listar los 3 por separado. Excepción explícita del
            # usuario (2026-09-21): el Albatros SÍ tiene los 3 a la vez, pero
            # se listan por separado en vez de colapsarlos.
            all_terrain_label = None if cid == "albatross" else "Todoterreno"
            type_label = type_label_for(card["habitats"], HABITAT_ES, all_terrain_label)
            cost = card["marketCost"]
            pv = card["victoryPoints"]
            text = CARD_TEXT_ES_PRINT.get(cid, card["text"])
        elif ctype == "coin":
            out_path = os.path.join(OUT_DIR, f"{cid}.png")
            coin_card = cc.build_coin_card_base(COIN_IMAGE[cid])
            coin_card = cc.resize_to_print_size(coin_card)
            coin_card.save(out_path)
            generated.append(out_path)
            print("generated", cid, "(coin image, mounted on the coin template)")
            continue
        else:
            continue

        # Diseno oficial desde 2026-09-20: iconos de tipo (ver compose_card_iconos.py). compose_generic, mas
        # arriba, es el diseno anterior (texto de tipo y tablon de color) y ya no se usa. Import aqui dentro
        # porque ese modulo importa a su vez este.
        import compose_card_iconos
        out_path = compose_card_iconos.compose_official(card, "es", OUT_DIR)
        generated.append(out_path)
        print("generated", cid)

    print(f"\nTotal: {len(generated)} cards")
    return generated


if __name__ == "__main__":
    main()

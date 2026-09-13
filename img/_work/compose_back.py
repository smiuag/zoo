"""Compone el reverso de las cartas a partir de img/back.jpg: un diseño de
pergamino con un marco de enredadera de forma rectangular (la "ventana de
carta") y fondo de pergamino continuo alrededor. Genera UNA sola salida,
img/cards/_back.png, usada tanto por build_pdf.py (hoja de referencia) como
por build_deck_pdf.py (mazo real, pegada centrada y repetida en cada celda de
la rejilla) — desde que compose_card.resize_to_print_size() dejó de recortar
el sangrado a un tamaño fijo y en su lugar escala el lienzo COMPLETO tal cual
(ver ahí), el mismo archivo ya sirve para las dos cosas: no hace falta una
versión "de referencia" (recorte ajustado) y otra "de sangrado" (recorte más
generoso) por separado, basta con una que lleve todo el margen nativo de la
plantilla y dejar que build_deck_pdf.py decida cuánto se sale de la celda al
pegarla centrada.

Recorta cc.CANVAS_W x cc.CANVAS_H centrado en la vid (usando un fondo
extendido, ver más abajo, porque el back.jpg original no tiene margen nativo
de sobra suficiente alrededor del marco) y llama a
compose_card.resize_to_print_size() igual que cualquier otra carta.

El pergamino original (1024x1024) no tiene margen de sobra suficiente
alrededor del marco para sacar un recorte de cc.CANVAS_W x cc.CANVAS_H en
todas direcciones (sobre todo arriba/abajo), así que el fondo se extiende
primero por reflejo (mosaico espejado): la textura de pergamino es lo
bastante uniforme como para que la costura sea invisible.
"""
import numpy as np
from PIL import Image

import compose_card as cc

BACK_SRC_PATH = r"C:\proyectos\Claude\zoo\img\back.jpg"
OUT_PLAIN_PATH = r"C:\proyectos\Claude\zoo\img\cards\_back.png"

# Caja del marco de enredadera dentro de back.jpg (1024x1024), medida a
# mano sobre una rejilla de referencia (izq, arriba, dcha, abajo). Si se
# cambia el arte de back.jpg hay que volver a medir esto.
# Ajuste 2026-09-13: medido sobre mazo_impresion.pdf, el marco quedaba 1 mm bajo dentro del
# corte (4,1 mm de margen arriba, 2,0 abajo): la caja estaba unos 11 px alta respecto al
# dibujo real, asi que se baja 11 px (misma altura, solo cambia el centro).
BORDER_BOX = (168, 46, 858, 961)

# El marco de enredadera debe quedar POR DENTRO de la zona de corte real,
# con unos mm de margen de sobra (nunca ajustado al borde) — si no, un
# corte impreciso se lleva parte del dibujo por delante. Margen objetivo
# POR EJE (mm, en la carta ya impresa) — ya no es el mismo en ambos ejes:
# el usuario pidió agrandar el marco ~4mm de ancho y ~10mm de alto
# respecto al primer ajuste (que dejaba 3mm/7mm de margen por lado según
# el "contain fit" de entonces), así que ahora el margen de cada eje se
# fija por separado en vez de derivarse de un único "encaje" (que no deja
# controlar los dos ejes de forma independiente).
BACK_MARGIN_MM_X = 1.0
BACK_MARGIN_MM_Y = 2.0

REFLECT_PAD = 500  # de sobra para que el recorte nunca se salga del fondo extendido

# Esquina de back.jpg sin vid ni ilustración: solo textura de pergamino
# lisa, usada como tesela para extender el fondo (ver _build_extended_bg).
TEXTURE_SAMPLE_BOX = (900, 900, 1024, 1024)


def _build_extended_background(src):
    """Lienzo (1024+2*REFLECT_PAD) cuadrado: relleno con un mosaico
    espejado de TEXTURE_SAMPLE_BOX (pergamino liso, sin costura visible
    porque el propio tile ya es simétrico) y el back.jpg original pegado
    centrado encima, en su posición real. A diferencia de reflejar el
    lienzo COMPLETO (que arrastraría una copia fantasma de la propia
    enredadera hasta la zona de sangrado), esto deja solo fondo liso más
    allá del borde original — que es lo que de verdad hace falta ahí."""
    w, h = src.size
    tex = src.crop(TEXTURE_SAMPLE_BOX)
    tex_w, tex_h = tex.size
    # Tesela de 2x2 espejada (mismo truco que un "mirror tile" de textura):
    # sus 4 bordes casan consigo misma al repetirla, sin costura.
    mirror_tile = Image.new("RGB", (tex_w * 2, tex_h * 2))
    mirror_tile.paste(tex, (0, 0))
    mirror_tile.paste(tex.transpose(Image.FLIP_LEFT_RIGHT), (tex_w, 0))
    mirror_tile.paste(tex.transpose(Image.FLIP_TOP_BOTTOM), (0, tex_h))
    mirror_tile.paste(tex.transpose(Image.ROTATE_180), (tex_w, tex_h))

    canvas_size = w + 2 * REFLECT_PAD
    tile_arr = np.asarray(mirror_tile)
    reps_y = -(-canvas_size // tile_arr.shape[0])  # ceil division
    reps_x = -(-canvas_size // tile_arr.shape[1])
    bg_arr = np.tile(tile_arr, (reps_y, reps_x, 1))[:canvas_size, :canvas_size]

    extended = Image.fromarray(bg_arr)
    extended.paste(src, (REFLECT_PAD, REFLECT_PAD))
    return extended


def _fit_scale():
    """Cuánto hay que escalar el marco de enredadera (tal como sale de
    back.jpg), POR EJE (no un único factor), para que quepa DENTRO del
    área de corte real (TEMPLATE_DESIGN_W x H) dejando exactamente
    BACK_MARGIN_MM_X/Y de margen respecto al corte en cada eje — nunca se
    recorta el marco, se escala entero (un pelín distinto en cada eje: el
    marco no comparte proporción exacta con el área de corte, así que
    fijar los dos márgenes a la vez implica un estirado no-uniforme muy
    pequeño, del mismo orden que el que ya se le aplica al frente en
    resize_to_print_size). Los márgenes se piden en mm de la carta YA
    IMPRESA (target_w x target_h), así que se convierten a "espacio de
    diseño" (antes del escalado final por eje de resize_to_print_size)
    dividiendo por el factor de cada eje."""
    margin_x = round(BACK_MARGIN_MM_X * 300 / 25.4) / (cc.CARD_PRINT_W / cc.TEMPLATE_DESIGN_W)
    margin_y = round(BACK_MARGIN_MM_Y * 300 / 25.4) / (cc.CARD_PRINT_H / cc.TEMPLATE_DESIGN_H)
    target_border_w = cc.TEMPLATE_DESIGN_W - 2 * margin_x
    target_border_h = cc.TEMPLATE_DESIGN_H - 2 * margin_y
    bx0, by0, bx1, by1 = BORDER_BOX
    border_w, border_h = bx1 - bx0, by1 - by0
    return target_border_w / border_w, target_border_h / border_h


def compose_plain():
    src = Image.open(BACK_SRC_PATH).convert("RGB")
    # Recorta exactamente cc.CANVAS_W x cc.CANVAS_H (el mismo tamaño que ya
    # traen las plantillas del frente) centrado en la vid, usando el fondo
    # extendido en vez del back.jpg original tal cual: éste no tiene
    # margen de sobra suficiente por sí solo (sobre todo arriba/abajo) para
    # ese tamaño, y sin el fondo extendido resize_to_print_size tendría que
    # rellenar el hueco con color liso en vez de pergamino real. Antes de
    # recortar, el fondo extendido se ENCOGE (ver _fit_scale) para que el
    # marco de enredadera quede más pequeño que el área de corte real, con
    # margen — si no, un corte impreciso se lleva el marco por delante
    # (justo lo que pasaba antes de este ajuste).
    extended = _build_extended_background(src)
    scale_x, scale_y = _fit_scale()
    extended = extended.resize(
        (round(extended.width * scale_x), round(extended.height * scale_y)), Image.LANCZOS
    )
    bx0, by0, bx1, by1 = BORDER_BOX
    border_cx = ((bx0 + bx1) / 2 + REFLECT_PAD) * scale_x
    border_cy = ((by0 + by1) / 2 + REFLECT_PAD) * scale_y
    left, top = round(border_cx - cc.CANVAS_W / 2), round(border_cy - cc.CANVAS_H / 2)
    card = extended.crop((left, top, left + cc.CANVAS_W, top + cc.CANVAS_H))
    card = cc.resize_to_print_size(card)
    card.save(OUT_PLAIN_PATH)
    print(
        f"Saved {OUT_PLAIN_PATH} ({card.size[0]}x{card.size[1]}, "
        f"marco escalado x{scale_x:.4f} (ancho) / x{scale_y:.4f} (alto))"
    )


if __name__ == "__main__":
    compose_plain()

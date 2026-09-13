"""Zonas manuales de la tabla del nombre (coordenadas de template3.png, 615x878):
cajas (y0, y1, x0, x1) que NUNCA se repintan (quedan madera) y cajas que SIEMPRE se
repintan. Se aplican despues de la deteccion automatica. Ajustar a ojo con la imagen de
control que genera build_plank_templates.py (plank_zonas_control.png).
- En NO_PINTAR se deja en madera lo mas claro que UMBRAL_MADERA (con 0, la caja entera).
- En SI_PINTAR se pinta todo lo que no sea contorno oscuro (valor >= UMBRAL_OSCURO) ni hoja,
  asi las lineas del contorno siguen en madera y solo se rellena la madera clara.
"""
UMBRAL_MADERA = 200
UMBRAL_OSCURO = 112     # en las cajas de si pintar, solo el contorno realmente oscuro queda en madera
NO_PINTAR = [
]
# cajas pequenas alrededor de las lineas de las muescas: dentro, lo mas oscuro que
# UMBRAL_LINEA (las lineas, marron medio) queda en madera; la cara clara se pinta
UMBRAL_LINEA = 150
# (y0, y1, x0, x1[, umbral propio]): cajas ajustadas a cada linea; el quinto valor opcional
# sustituye a UMBRAL_LINEA en esa caja (mas bajo = solo lo mas oscuro)
NO_PINTAR_LINEAS = [
    (526, 538, 90, 110, 150),    # linea muesca izquierda superior
    (544, 556, 90, 114, 150),    # linea muesca izquierda inferior
    (543, 555, 500, 517, 138),   # linea muesca derecha inferior
]
SI_PINTAR = [
    (516, 560, 86, 112),    # extremo izquierdo: las dos muescas y la esquina superior
    (512, 572, 496, 530),   # extremo derecho: las dos muescas y la grieta entre ellas
]

# cajas donde los trazos oscuros (grietas) se pintan solo en parte: PESO_MEDIO es la fraccion
# de color del tipo (0 = madera, 1 = color). (y0, y1, x0, x1[, umbral]).
PESO_MEDIO = 0.5
MEDIO = [
    (512, 540, 408, 518, 150),   # grieta larga del extremo derecho, de su cola izquierda hasta la muesca
]

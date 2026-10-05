"""Genera apps/web/public/scan/: plantillas de bolsa y escudo (sin el número) y miniaturas de la
ilustración de cada carta clásica, a partir de las cartas impresas (img/cards).
Todo a la mitad de la resolución de las cartas de referencia (823x1122): el escáner solo las reduce.
Usa las cartas impresas de img/cards (edición clásica). Volver a ejecutarlo si cambia la ilustración de una
carta o el diseño de la bolsa/escudo (las coordenadas de recorte son las del diseño actual, 823x1122).
Ejecutar con /c/Python310/python (necesita opencv-python y numpy). Ver apps/web/src/lib/cardScanCv.ts."""
import cv2, numpy as np, json, glob, os

import pathlib
ROOT = str(pathlib.Path(__file__).resolve().parents[2])  # raíz del repo
OUT = f'{ROOT}/apps/web/public/scan'
os.makedirs(f'{OUT}/refs', exist_ok=True)
SCALE = 0.5

ref = cv2.imread(f'{ROOT}/img/cards/eagle.png')
bag = ref[88:236, 68:204].copy()      # 136x148 px en la referencia
cream = np.median(np.array([bag[y, x] for x, y in [(40, 70), (105, 70), (68, 40), (68, 110)]]), axis=0)
cv2.circle(bag, (68, 74), 36, tuple(int(c) for c in cream), -1)
sh = ref[76:226, 610:745].copy()      # 135x150 px
gray = np.median(np.array([sh[y, x] for x, y in [(25, 75), (110, 75), (68, 30), (68, 120)]]), axis=0)
cv2.circle(sh, (68, 72), 34, tuple(int(c) for c in gray), -1)
for name, img in (('bag', bag), ('shield', sh)):
    small = cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA)
    cv2.imwrite(f'{OUT}/{name}.png', small)
    print(name, small.shape)

ids = []
for f in sorted(glob.glob(f'{ROOT}/packages/engine/src/cards/data/*.json')):
    c = json.load(open(f, encoding='utf8'))
    if c.get('edition', 'classic') == 'classic' and c['type'] in ('animal', 'coin'):
        ids.append(c['id'])
total = 0
for cid in ids:
    p = f'{ROOT}/img/cards/{cid}.png'
    if not os.path.exists(p):
        print('FALTA', cid)
        continue
    im = cv2.imread(p)
    art = im[172:552, 177:650]        # centro de la ilustración (473x380), sin bordes
    small = cv2.resize(art, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_AREA)
    out = f'{OUT}/refs/{cid}.jpg'
    cv2.imwrite(out, small, [cv2.IMWRITE_JPEG_QUALITY, 88])
    total += os.path.getsize(out)
json.dump(ids, open(f'{OUT}/refs/index.json', 'w'))
print(len(ids), 'referencias,', total // 1024, 'KB')

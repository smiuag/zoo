import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage, sparse
from scipy.sparse.linalg import spsolve
S=sys.argv[1]
E=np.asarray(Image.open('img/moneda3Alargada_original.jpg').convert('RGB')).astype(float); H,W,_=E.shape
O=Image.open('img/moneda3.jpg').convert('RGB'); SCALE,DX,DY=0.62,26,195
size=(round(1024*SCALE),round(1024*SCALE)); Os=np.asarray(O.resize(size,Image.LANCZOS)).astype(float)
src=E.copy(); have=np.zeros((H,W),bool)
y1,x1=min(H,DY+size[1]),min(W,DX+size[0]); src[DY:y1,DX:x1]=Os[:y1-DY,:x1-DX]; have[DY:y1,DX:x1]=True
same=np.load(S+'/m3_same.npy')
BAND=int(sys.argv[2]) if len(sys.argv)>2 else 8
mask=(ndimage.binary_dilation(same,iterations=BAND) if BAND<900 else have)&ndimage.binary_erosion(have,iterations=2)
# Poisson: laplaciano de la fuente dentro de la mascara, borde = destino
idx=-np.ones((H,W),int); ys,xs=np.where(mask); n=len(ys); idx[ys,xs]=np.arange(n)
A=sparse.lil_matrix((n,n)); 
rows=[];cols=[];vals=[]; b=np.zeros((n,3))
for k,(y,x) in enumerate(zip(ys,xs)):
    rows.append(k);cols.append(k);vals.append(4.0)
    lap=4*src[y,x]
    for dy,dx in ((-1,0),(1,0),(0,-1),(0,1)):
        yy,xx=y+dy,x+dx
        lap-=src[yy,xx]
        j=idx[yy,xx]
        if j>=0: rows.append(k);cols.append(j);vals.append(-1.0)
        else: b[k]+=E[yy,xx]
    b[k]+=lap
A=sparse.csr_matrix((vals,(rows,cols)),shape=(n,n))
out=E.copy()
for c in range(3):
    sol=spsolve(A,b[:,c]); out[ys,xs,c]=sol
out=np.clip(out,0,255)
Image.fromarray(out.astype(np.uint8)).save(S+('/m3_poisson.png' if BAND<900 else '/m3_poissonB.png'))
f0=Image.open('img/moneda3Alargada_original.jpg').convert('RGB'); f=Image.fromarray(out.astype(np.uint8))
for name,box in {'left':(20,540,260,720),'branch':(120,640,600,880),'tail':(440,400,687,660)}.items():
    w,h=box[2]-box[0],box[3]-box[1]
    c=Image.new('RGB',(w*2+10,h),'white'); c.paste(f0.crop(box),(0,0)); c.paste(f.crop(box),(w+10,0))
    c.resize((c.width*2,h*2),Image.LANCZOS).save(S+f'/m3_{name}_poi.png')
print('ok', n)

import sys, numpy as np
from PIL import Image, ImageFilter, ImageDraw
S=sys.argv[1]
base=Image.open(S+'/m3_poisson.png').convert('RGB')
out=np.asarray(base).astype(float); H,W,_=out.shape
def paste(box, dst, flip=False, scale=1.0, feather=5, ellipse=True):
    global out
    x0,y0,x1,y1=box; el=base.crop(box)
    if flip: el=el.transpose(Image.FLIP_LEFT_RIGHT)
    if scale!=1.0: el=el.resize((round(el.width*scale),round(el.height*scale)),Image.LANCZOS)
    w,h=el.size
    m=Image.new('L',(w,h),0); d=ImageDraw.Draw(m)
    if ellipse: d.ellipse((feather,feather,w-feather,h-feather),fill=255)
    else: d.rectangle((feather,feather,w-feather,h-feather),fill=255)
    m=np.asarray(m.filter(ImageFilter.GaussianBlur(feather))).astype(float)/255.0
    dx,dy=dst; ex0,ey0=max(0,dx),max(0,dy); ex1,ey1=min(W,dx+w),min(H,dy+h)
    a=np.asarray(el).astype(float)[ey0-dy:ey1-dy, ex0-dx:ex1-dx]; mm=m[ey0-dy:ey1-dy, ex0-dx:ex1-dx][...,None]
    out[ey0:ey1,ex0:ex1]=out[ey0:ey1,ex0:ex1]*(1-mm)+a*mm
# zona izquierda (mancha palida junto a la moneda): flor rosa nitida + par de hojas pequenas
paste((140,755,200,815),(118,588),flip=True,scale=0.95,feather=6)
paste((425,700,470,745),(160,622),flip=True,scale=0.8,feather=5)
# franja bajo la rama: sigue la diagonal del canto inferior de la rama (mas baja a la izquierda)
paste((345,735,405,815),(225,772),flip=True,scale=0.75,feather=6)
paste((425,700,470,745),(295,762),flip=True,scale=0.9,feather=5)
paste((425,700,470,745),(385,748),flip=False,scale=0.85,feather=5)
paste((345,735,405,815),(468,712),flip=False,scale=0.7,feather=6)
Image.fromarray(np.clip(out,0,255).astype(np.uint8)).save(S+'/m3_collage.png')
o=Image.open('img/moneda3Alargada_original.jpg').convert('RGB'); f=Image.fromarray(np.clip(out,0,255).astype(np.uint8))
for name,box in {'left':(20,520,280,720),'branch':(120,640,600,880)}.items():
    w,h=box[2]-box[0],box[3]-box[1]
    c=Image.new('RGB',(w*2+10,h),'white'); c.paste(o.crop(box),(0,0)); c.paste(f.crop(box),(w+10,0))
    c.resize((c.width*2,h*2),Image.LANCZOS).save(S+f'/m3_{name}_col.png')
print('ok')

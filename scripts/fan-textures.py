# Fan art for scripts/rig-fans.mjs: blur discs for the A320 (from its own
# atlas) and a procedural fan + blur disc for the Citation.
# Usage: python3 scripts/fan-textures.py <a320 atlas.webp> <outDir>
import os, sys
import numpy as np, math
from PIL import Image, ImageDraw, ImageFilter
S=256
def angular_blur(img, deg, n=24):
    acc=np.zeros((S,S,4),np.float64)
    for i in range(n):
        a=-deg/2+deg*i/(n-1)
        acc+=np.asarray(img.rotate(a,resample=Image.BILINEAR),np.float64)
    return Image.fromarray((acc/n).astype(np.uint8))
yy,xx=np.mgrid[0:S,0:S]; rr=np.hypot(xx-(S-1)/2,yy-(S-1)/2)/(S/2)
def blur_disc(sharp, hub, alpha, out):
    b=angular_blur(sharp.convert('RGBA'),30)
    a=np.asarray(b).copy()
    m=np.clip((0.97-rr)/0.03,0,1)*np.clip((rr-hub)/0.04,0,1)
    a[...,3]=(m*alpha*255).astype(np.uint8)
    Image.fromarray(a).save(out)
# A320: fan art from the model's own atlas
atlas=Image.open(sys.argv[1]).convert('RGB'); W=atlas.size[0]
cu,cv,ru=0.407,0.8765,0.0572
box=(int((cu-ru)*W),int((cv-ru)*W),int((cu+ru)*W),int((cv+ru)*W))
a320=atlas.crop(box).resize((S,S),Image.LANCZOS)
a320.save(os.path.join(sys.argv[2],'a320_fan_crop.png'))
blur_disc(a320,0.20,0.6,os.path.join(sys.argv[2],'a320_fan_blur.png'))
# Citation: procedural fan (no fan art in its baked texture)
im=Image.new('RGB',(S*4,S*4),(22,23,26)); d=ImageDraw.Draw(im); C=S*2; R=S*2*0.97
N=22
for i in range(N):
    a0=2*math.pi*i/N
    pts=[]
    for k in range(13):
        t=k/12; r=R*(0.24+0.76*t); a=a0+0.28*t
        pts.append((C+r*math.cos(a),C+r*math.sin(a)))
    for k in range(12,-1,-1):
        t=k/12; r=R*(0.24+0.76*t); a=a0+0.28*t+(2*math.pi/N)*(0.72-0.2*t)
        pts.append((C+r*math.cos(a),C+r*math.sin(a)))
    g=int(100+22*math.sin(a0*3))
    d.polygon(pts,fill=(g,g+3,g+8),outline=(60,62,66))
d.ellipse((C-R,C-R,C+R,C+R),outline=(185,188,192),width=int(S*0.06))
hr=R*0.24
d.ellipse((C-hr,C-hr,C+hr,C+hr),fill=(70,72,76),outline=(40,40,44),width=6)
# white spinner swirl so the spin reads even at low RPM
sw=[(C+hr*0.85*(k/40)*math.cos(2.6*math.pi*k/40),C+hr*0.85*(k/40)*math.sin(2.6*math.pi*k/40)) for k in range(41)]
d.line(sw,fill=(235,235,235),width=12)
cit=im.resize((S,S),Image.LANCZOS); cit.save(os.path.join(sys.argv[2],'cit_fan.png'))
blur_disc(cit,0.24,0.6,os.path.join(sys.argv[2],'cit_fan_blur.png'))
# A320 spinner: dark cone with the white "swirl" real engines carry, so the
# rotation reads at any RPM (planar-mapped onto the cone by rig-fans.mjs).
sp=Image.new('RGB',(S*2,S*2),(48,50,55)); d=ImageDraw.Draw(sp); C=S
for k in range(40,0,-1):
    g=48+int(40*(1-k/40)); d.ellipse((C-k*S/40,C-k*S/40,C+k*S/40,C+k*S/40),fill=(g,g+2,g+6))
sw=[(C+S*0.95*(k/60)*math.cos(1.6*math.pi*k/60),C+S*0.95*(k/60)*math.sin(1.6*math.pi*k/60)) for k in range(61)]
d.line(sw,fill=(240,240,240),width=int(S*0.13),joint='curve')
sp.resize((128,128),Image.LANCZOS).save(os.path.join(sys.argv[2],'a320_spinner.png'))

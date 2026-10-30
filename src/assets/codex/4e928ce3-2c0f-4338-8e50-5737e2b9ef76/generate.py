#!/usr/bin/env python3
"""Reproduce a five-frame blink locally using only Python and Pillow.

Source eyeballs remain stationary. Textured lids cover and uncover them.
Only RGB bytes inside two eye regions are written; alpha is never edited.
"""
from pathlib import Path
from statistics import median
import json
from shutil import copyfile
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
S = 8
src = Image.open(ROOT / 'source.png').convert('RGBA')
W,H = src.size
assert (W,H) == (191,161)
EYES = [
    dict(top=[(67.2,72.0),(73.0,70.0),(81.3,69.3),(87.0,77.7)],
         bottom=[(67.2,72.0),(72.7,81.3),(80.4,81.2),(87.0,77.7)],
         closed=[(67.2,72.0),(72.7,79.0),(80.4,80.5),(87.0,77.7)],
         rgb=(100,42,22), bounds=(65,68,90,83), texture_offset=15),
    dict(top=[(132.8,77.1),(135.6,73.2),(140.0,71.3),(144.8,73.9)],
         bottom=[(132.8,77.1),(134.1,81.9),(140.3,83.1),(144.8,73.9)],
         closed=[(132.8,77.1),(134.7,80.3),(140.3,81.5),(144.8,73.9)],
         rgb=(104,48,28), bounds=(131,70,148,84), texture_offset=14),
]

def curve(p):
    result=[]
    for i in range(180):
        t=i/179;u=1-t
        result.append(tuple(u**3*p[0][j]+3*u*u*t*p[1][j]+3*u*t*t*p[2][j]+t**3*p[3][j] for j in (0,1)))
    return result

def polygon_mask(points):
    im=Image.new('L',(W*S,H*S))
    ImageDraw.Draw(im).polygon([(round(x*S),round(y*S)) for x,y in points],fill=255)
    return im

def raster(im):
    return im.resize((W,H),Image.Resampling.LANCZOS)

def mix_points(p,q,t):
    return [tuple(v*(1-t)+w*t for v,w in zip(a,b)) for a,b in zip(p,q)]

def stroke(points,width):
    im=Image.new('L',(W*S,H*S))
    ImageDraw.Draw(im).line([(round(x*S),round(y*S)) for x,y in curve(points)],fill=255,width=round(width*S),joint='curve')
    return raster(im)

def clamp(v,lo,hi):
    return max(lo,min(hi,v))

def luminance(p):
    return sum(v*w for v,w in zip(p[:3],(.299,.587,.114)))

def blink(amount):
    out=src.copy();sp=src.load();op=out.load()
    for eye in EYES:
        top,bottom,closed=[eye[k] for k in ('top','bottom','closed')]
        # Cover the original antialiased lash without disturbing the brow.
        upper_margin=[(x,y-(1.1 if i in (1,2) else 0)) for i,(x,y) in enumerate(top)]
        lower_margin=[(x,y+(.85 if i in (1,2) else 0)) for i,(x,y) in enumerate(bottom)]
        patch=raster(polygon_mask(curve(upper_margin)+curve(lower_margin)[::-1])).load()
        upper=mix_points(top,closed,amount)
        lower=mix_points(bottom,closed,amount)
        visible=(raster(polygon_mask(curve(upper)+curve(lower)[::-1])) if amount<.999 else Image.new('L',(W,H))).load()
        lash=stroke(upper,1.35).load()
        lower_rim=stroke(lower,.65).load()
        x0,y0,x1,y1=eye['bounds'];offset=eye['texture_offset']
        tex_mid=median(luminance(sp[x,min(y+offset,H-1)]) for y in range(y0,y1) for x in range(x0,x1))
        ymid=sum(p[1] for p in top)/4
        for y in range(y0,y1):
            for x in range(x0,x1):
                p=patch[x,y]/255
                if not p:
                    continue
                # Locally sampled fur texture supplies small organic variations.
                noise=clamp(luminance(sp[x,min(y+offset,H-1)])-tex_mid,-18,18)*.24
                tone=clamp((y-ymid)*-1.15,-10,4)
                side=clamp((138-x)*2,-13,10) if x0>100 else 0
                skin=[base+(noise+tone+side)*weight for base,weight in zip(eye['rgb'],(1,.65,.4))]
                cover=p*(1-visible[x,y]/255)
                rgb=[v*(1-cover)+s*cover for v,s in zip(op[x,y][:3],skin)]
                m=lash[x,y]/255*p
                rgb=[v*(1-m)+s*m for v,s in zip(rgb,(30,12,7))]
                if amount<.999:
                    m=lower_rim[x,y]/255*p*.7
                    rgb=[v*(1-m)+s*m for v,s in zip(rgb,(61,26,15))]
                op[x,y]=tuple(round(clamp(v,0,255)) for v in rgb)+(sp[x,y][3],)
    return out

frames=[]
for i,amount in enumerate((0,.64,1,.30,0),1):
    frame=src.copy() if amount==0 else blink(amount)
    name=f'frame-{i:02d}.png'
    if amount == 0:
        copyfile(ROOT/'source.png', ROOT/name)
    else:
        frame.save(ROOT/name)
    frames.append(name)

sheet=Image.new('RGB',(5*W,H+28+104),(38,33,30))
d=ImageDraw.Draw(sheet)
for i,name in enumerate(frames):
    fr=Image.open(ROOT/name)
    sheet.paste(fr,(i*W,20),fr)
    d.text((i*W+6,5),f'{i+1} / {("rest","closing","closed","opening","rest")[i]}',fill=(235,225,210))
    detail=fr.crop((62,65,149,86)).resize((174,42),Image.Resampling.NEAREST)
    sheet.paste(detail,(i*W+8,H+38),detail)
sheet.save(ROOT/'contact-sheet.png')
result={
 'notes':'Přirozené mrknutí pomocí horních a dolních víček, bez deformace očí. Pět snímků v původním rozměru 191 × 161 px; první i poslední snímek jsou pixelově totožné se zdrojem. Veškerá alfa a všechny pixely mimo dvě malé oblasti očí jsou zachovány. Ostatní části obličeje se nemění. Bez dalších omezení.',
 'scripts':['generate.py'],
 'clips':[{'kind':'blink','label':'Přirozené mrknutí','fps':12,'frames':frames}]
}
(ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Verify the contract from the actual saved PNGs.
images=[Image.open(ROOT/f).convert('RGBA') for f in frames]
assert images[0].tobytes()==src.tobytes()==images[-1].tobytes()
assert (ROOT/frames[0]).read_bytes()==(ROOT/'source.png').read_bytes()==(ROOT/frames[-1]).read_bytes()
for name,im in zip(frames,images):
    assert im.size==src.size and im.getchannel('A').tobytes()==src.getchannel('A').tobytes()
    diffs=[]
    for y in range(H):
        for x in range(W):
            if im.getpixel((x,y))!=src.getpixel((x,y)):
                assert any(e['bounds'][0]<=x<e['bounds'][2] and e['bounds'][1]<=y<e['bounds'][3] for e in EYES)
                diffs.append((x,y))
    bounds=(min(x for x,y in diffs),min(y for x,y in diffs),max(x for x,y in diffs)+1,max(y for x,y in diffs)+1) if diffs else None
    print(name, 'changed pixels',len(diffs),'bounds',bounds)
assert len({im.tobytes() for im in images})==4
assert len(result['clips'])==1 and len(frames)==5
print('Verified: five frames, four distinct poses, 12 fps, exact endpoints, original alpha and all pixels outside eyes.')

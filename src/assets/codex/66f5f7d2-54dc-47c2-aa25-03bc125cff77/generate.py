from PIL import Image, ImageDraw, ImageFilter
import json, math, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
src = Image.open(ROOT/'source.png').convert('RGBA')
W,H=src.size
S=6

def bezier(a,b,c,d,n=32):
    return [((1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0], (1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1]) for t in [i/n for i in range(n+1)]]

def path(commands):
    pts=[]; p=None
    for c in commands:
        if c[0]=='M': p=c[1];pts.append(p)
        elif c[0]=='L': p=c[1];pts.append(p)
        elif c[0]=='C':
            pts+=bezier(p,c[1],c[2],c[3])[1:];p=c[3]
    return pts

def poly(draw, pts, fill): draw.polygon([(round(x*S),round(y*S)) for x,y in pts],fill=fill)
def line(draw,pts,fill,width): draw.line([(round(x*S),round(y*S)) for x,y in pts],fill=fill,width=round(width*S),joint='curve')
def mask_polygon(pts):
    m=Image.new('L',(W*S,H*S));poly(ImageDraw.Draw(m),pts,255);return m

def apply_layer(base, layer, mask=None):
    if mask: layer.putalpha(Image.composite(layer.getchannel('A'),Image.new('L',layer.size),mask))
    layer=layer.resize((W,H),Image.Resampling.LANCZOS)
    if mask:
        support=mask.resize((W,H),Image.Resampling.BOX).point(lambda v: 255 if v else 0)
        layer.putalpha(Image.composite(layer.getchannel('A'),Image.new('L',(W,H)),support))
    out=Image.alpha_composite(base,layer)
    out.putalpha(src.getchannel('A'))
    return out

eyes=[
 {'outline':path([('M',(143.0,44.7)),('C',(146.8,41.0),(151.5,42.7),(155.6,45.4)),('C',(159.0,47.1),(160.7,48.8),(162.1,50.7)),('C',(158.4,53.7),(150.5,53.4),(146.2,49.9)),('C',(144.3,48.4),(143.5,46.8),(143.0,44.7))]),
  'upper':[(143.2,44.6),(148.2,40.7),(157.8,45.8),(161.8,50.5)],
  'closed':[(143.2,46.0),(148.2,51.3),(156.4,53.0),(161.8,50.5)],
  'skin':(162,82,45)},
 {'outline':path([('M',(172.9,51.6)),('C',(175.3,48.2),(182.0,48.2),(185.0,50.8)),('C',(187.4,52.8),(185.9,55.8),(182.2,56.7)),('C',(178.7,57.6),(174.0,55.9),(172.9,51.6))]),
  'upper':[(173.0,51.6),(176.5,48.0),(182.4,48.8),(186.0,52.8)],
  'closed':[(173.0,53.0),(177.3,56.4),(183.1,57.1),(186.0,53.1)],
  'skin':(166,83,43)}
]

def blink(t):
    out=src.copy()
    for e in eyes:
        q=[(a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t) for a,b in zip(e['upper'],e['closed'])]
        lid=bezier(*q)
        # Anatomical upper lid occludes the original eye; the eyeball is never scaled.
        cover=[(139,38),(191,38),(191,q[-1][1])]+list(reversed(lid))+[(139,q[0][1])]
        mask=mask_polygon(e['outline'])
        covermask=mask_polygon(cover)
        from PIL import ImageChops
        if t<1:
            mask=ImageChops.multiply(mask,covermask)
        layer=Image.new('RGBA',(W*S,H*S))
        px=layer.load()
        bounds=mask.getbbox()
        for yy in range(bounds[1],bounds[3]):
            for xx in range(bounds[0],bounds[2]):
                x,y=xx/S,yy/S
                # Low-amplitude texture from the source cheek, with lid shadow.
                tex=src.getpixel((min(W-1,int(x)),min(H-1,int(y+16))))
                lum=(tex[0]-165)*.10
                shade=(y-46)*.65
                col=tuple(max(0,min(255,round(v+lum+shade))) for v in e['skin'])
                px[xx,yy]=(*col,255)
        d=ImageDraw.Draw(layer)
        line(d,lid,(85,39,21,255),.92)
        # A subdued warm rim avoids a vector-like black stripe.
        rim=[(x,y-.66) for x,y in lid[4:-4]]
        line(d,rim,(180,94,52,255),.38)
        out=apply_layer(out,layer,mask)
    return out

# The editable mouth contour follows the lower edge of the original moustache.
# Every pixel of the moustache and nose above this edge remains untouched.
mouth_area=path([('M',(148.9,80.4)),('C',(153.5,79.7),(157.5,80.8),(159.8,77.0)),('C',(161.4,75.1),(163.8,76.9),(165.4,79.5)),('C',(167.4,80.6),(169.0,80.5),(171.1,81.0)),('L',(170.2,90.4)),('C',(163.7,92.3),(154.6,91.6),(149.5,87.8)),('L',(148.9,80.4))])
mouth_mask=mask_polygon(mouth_area)

def mouth(pose):
    # Reconstruct only the old lower lip with locally sampled cheek/chin texture.
    clean=Image.new('RGBA',(W*S,H*S))
    cp=clean.load()
    for yy in range(79*S,91*S):
        for xx in range(149*S,172*S):
            x,y=xx/S,yy/S
            if 151.5<x<167.6 and 81.1<y<88.2:
                col=src.getpixel((int(x),int(y+8)))
                # Feathering retains the natural source shading at the edge.
                f=min(1,(x-151.5)/1.8,(167.6-x)/1.8,(y-81.1)/1.1,(88.2-y)/1.2)
                cp[xx,yy]=(*col[:3],round(255*max(0,f)))
    out=apply_layer(src,clean,mouth_mask)
    layer=Image.new('RGBA',(W*S,H*S));d=ImageDraw.Draw(layer)
    shapes={
     'parted': [('M',(152.8,80.4)),('C',(157.0,80.8),(163.1,79.7),(167.7,81.0)),('C',(167.0,84.6),(157.2,85.2),(152.8,80.4))],
     'open': [('M',(153.4,80.4)),('C',(156.5,80.5),(163.1,79.0),(167.4,81.1)),('C',(168.1,85.7),(165.3,89.0),(161.1,88.5)),('C',(157.0,88.4),(153.9,85.7),(153.4,80.4))],
     'wide': [('M',(150.6,80.6)),('C',(155.5,80.3),(162.7,79.8),(169.0,81.0)),('C',(167.6,85.9),(156.2,87.4),(150.6,80.6))],
     'round': [('M',(158.2,80.2)),('C',(160.6,78.4),(164.4,79.5),(165.2,81.4)),('C',(167.4,84.9),(165.0,88.2),(162.1,88.0)),('C',(158.4,88.2),(156.6,83.8),(158.2,80.2))]
    }
    shape=path(shapes[pose]);poly(d,shape,(48,21,15,255));line(d,shape+[shape[0]],(76,32,18,255),.75)
    if pose=='parted':
        tongue=path([('M',(157,83)),('C',(160,81.9),(164.1,82.3),(165.6,82.6)),('C',(163.7,84.1),(160,84.2),(157,83))]);poly(d,tongue,(148,61,37,255))
    if pose=='open':
        tongue=path([('M',(156.9,86.3)),('C',(159,84.7),(164,84.3),(165.9,86.0)),('C',(164.6,88.1),(160.1,88.1),(156.9,86.3))]);poly(d,tongue,(151,63,44,255))
        line(d,bezier((158.2,86.4),(160,85.6),(162.9,85.5),(164.2,86)),(178,78,51,255),.5)
    if pose=='wide':
        teeth=path([('M',(152.1,80.8)),('C',(157.2,81.1),(163,80.4),(167.6,81.2)),('L',(166.2,82.8)),('C',(161.5,83.5),(156.5,83.4),(153.4,82.5)),('L',(152.1,80.8))]);poly(d,teeth,(216,194,151,255))
        line(d,bezier((154,81.4),(158,81.9),(163.7,81.1),(166.2,81.6)),(239,217,174,255),.5)
    if pose=='round':
        tongue=path([('M',(159.8,86.6)),('C',(160.9,85.5),(163.9,85.1),(164.8,86.4)),('C',(163.3,87.5),(161.2,87.5),(159.8,86.6))]);poly(d,tongue,(136,54,35,255))
    # Soft lower lip, shaped independently for each phoneme.
    lips={'parted':((155.9,85.2),(159.2,86.2),(164.4,86.1),(166.3,84.8)),
          'open':((157.9,89.0),(160.3,90.4),(164.6,90),(166.2,88.1)),
          'wide':((155.7,86.0),(159.1,87.4),(164.5,87.2),(167.0,85.2)),
          'round':((159.6,88.6),(161.4,89.7),(164,89.6),(165.4,88))}
    line(d,bezier(*lips[pose]),(190,104,65,220),.65)
    return apply_layer(out,layer,mouth_mask)

blinks=[src.copy(),blink(.65),blink(1),blink(.40),src.copy()]
talks=[src.copy()]+[mouth(p) for p in ['parted','open','wide','round']]
clips=[]
for kind,frames,label in [('blink',blinks,'Přirozené mrknutí'),('talk',talks,'Mluvení – pět tvarů úst')]:
    names=[]
    for i,im in enumerate(frames,1):
        name=f'{kind}-{i:02}.png';im.save(ROOT/name);names.append(name)
    clips.append({'kind':kind,'label':label,'fps':12,'frames':names})

# Validation uses raw RGBA bytes, including pixels whose alpha is zero.
def diffbox(im):
    pts=[(x,y) for y in range(H) for x in range(W) if im.getpixel((x,y))!=src.getpixel((x,y))]
    return None if not pts else (min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts)+1,max(y for x,y in pts)+1)
def union(boxes):
    b=[b for b in boxes if b];return (min(v[0] for v in b),min(v[1] for v in b),max(v[2] for v in b),max(v[3] for v in b))
bb=union([diffbox(f) for f in blinks]);tb=union([diffbox(f) for f in talks])
assert bb[3]<=tb[1] or tb[3]<=bb[1] or bb[2]<=tb[0] or tb[2]<=bb[0]
assert blinks[0].tobytes()==src.tobytes()==blinks[-1].tobytes()
assert len(set(f.tobytes() for f in talks))==5
assert len(set(f.tobytes() for f in blinks))>=4
for f in blinks+talks: assert f.getchannel('A').tobytes()==src.getchannel('A').tobytes()
# Exact source-byte preservation outside the union of the editable contours.
blink_support=Image.new('L',(W,H))
for e in eyes:
    m=mask_polygon(e['outline']).resize((W,H),Image.Resampling.BOX)
    from PIL import ImageChops
    blink_support=ImageChops.lighter(blink_support,m)
talk_support=mouth_mask.resize((W,H),Image.Resampling.BOX)
for frames,support in [(blinks,blink_support),(talks,talk_support)]:
    for f in frames:
        for y in range(H):
            for x in range(W):
                if support.getpixel((x,y))==0: assert f.getpixel((x,y))==src.getpixel((x,y))

sheet=Image.new('RGB',(W*5,H*2+48),(35,29,25));sd=ImageDraw.Draw(sheet)
for row,frames in enumerate([blinks,talks]):
    for i,f in enumerate(frames):
        sheet.paste(f,(i*W,row*(H+24)+24));sd.text((i*W+8,row*(H+24)+7),f'{"blink" if row==0 else "talk"} {i+1}',fill=(245,225,195))
sheet.save(ROOT/'contact-sheet.png')
face=Image.new('RGB',(5*210,2*222),(35,29,25))
for row,frames in enumerate([blinks,talks]):
    for i,f in enumerate(frames):face.paste(f.crop((135,37,190,95)).resize((210,222),Image.Resampling.NEAREST),(i*210,row*222))
face.save(ROOT/'contact-sheet-detail.png')
result={'notes':'Pět snímků přirozeného mrknutí a pět odlišných tvarů úst: klid, pootevření, otevřená samohláska, zuby a zaokrouhlení. Víčka zakrývají oči bez deformace. Knír omezuje velikost úst; pohyb je záměrně jemný. Původní rozměry, poloha a alfa zůstávají zachovány. První a poslední snímek mrknutí jsou přesně shodné se zdrojem. Oblasti změn očí a úst se nepřekrývají; všechny ostatní RGBA pixely jsou beze změny.','scripts':['generate.py'],'clips':clips}
(ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'blink_changed_bounds':bb,'talk_changed_bounds':tb,'frames':10,'alpha':'identical','talk_poses':5},ensure_ascii=False))

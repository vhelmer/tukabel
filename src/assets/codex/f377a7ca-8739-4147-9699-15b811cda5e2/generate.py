#!/usr/bin/env python3
"""Reproduce aligned blink/talk sprites locally using Pillow and the Python stdlib."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pathlib import Path
import math, json
from repair_moustache import preserve_moustache

ROOT = Path(__file__).resolve().parent
SRC = Image.open(ROOT / 'source.png').convert('RGBA')
W,H = SRC.size
S = 6

def bez(points, n=28):
    a,b,c,d=points
    return [((1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0],
             (1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1]) for t in [i/n for i in range(n+1)]]
def path(start, segments):
    out=[start]
    for b,c,d in segments:
        out.extend(bez([out[-1],b,c,d])[1:])
    return out

def poly(draw, pts, fill):
    draw.polygon([(round(x*S),round(y*S)) for x,y in pts],fill=fill)
def stroke(draw, pts, color, width):
    draw.line([(round(x*S),round(y*S)) for x,y in pts],fill=color,width=round(width*S),joint='curve')
def canvas(): return Image.new('RGBA',(W*S,H*S))
def composite(im, layer, mask=None):
    layer=layer.resize((W,H),Image.Resampling.LANCZOS)
    if mask:
        alpha=Image.composite(layer.getchannel('A'),Image.new('L',(W,H)),mask)
        layer.putalpha(alpha)
    out=Image.alpha_composite(im,layer)
    out.putalpha(SRC.getchannel('A'))
    return out

def eye_frame(amount):
    im=SRC.copy()
    layer=canvas(); d=ImageDraw.Draw(layer)
    # Cubic contours follow each original eyeball; irises stay at their original coordinates.
    eyes=[((198.3,72.8),[(198.4,60.1),(221.4,60.5),(226.0,77.7)],
           [(223.4,82.8),(201.1,83.6),(198.3,72.8)],(177,108,65),1.25),
          ((245.0,83.9),[(248.1,75.0),(269.9,72.7),(271.0,85.7)],
           [(269.5,95.5),(247.4,95.0),(245.0,83.9)],(169,96,58),1.15)]
    for start, upper, lower, color, width in eyes:
        u=bez([start]+upper,80)
        # Reverse lower segment to correspond to the upper curve.
        l=list(reversed(bez([u[-1]]+lower,80)))
        # Closure meets in a shallow anatomical downward arc; the lower lid lifts a little.
        closed=[(a[0]*.30+b[0]*.70,a[1]*.30+b[1]*.70) for a,b in zip(u,l)]
        lash=[(a[0]+(b[0]-a[0])*amount,a[1]+(b[1]-a[1])*amount) for a,b in zip(u,closed)]
        low=[(a[0]+(b[0]-a[0])*amount,a[1]+(b[1]-a[1])*amount) for a,b in zip(l,closed)]
        poly(d,u+list(reversed(lash)),color+(255,))
        poly(d,l+list(reversed(low)),tuple(max(0,v-5) for v in color)+(255,))
        # A restrained skin gradient and source-derived grain keep the hand-painted texture.
        lp=layer.load(); sp=SRC.load()
        for yy in range(int(min(p[1] for p in u)*S),int(max(p[1] for p in l)*S)+1):
            for xx in range(int(min(p[0] for p in u)*S),int(max(p[0] for p in u)*S)+1):
                v=lp[xx,yy]
                if v[:3] not in (color,tuple(max(0,c-5) for c in color)):continue
                sx,sy=xx//S,yy//S
                a=sp[sx,max(30,sy-31)]; b=sp[min(W-1,sx+1),max(30,sy-31)]
                grain=max(-2,min(2,(sum(a[:3])-sum(b[:3]))/12))
                grad=3.5-(yy/S-start[1])*.5+grain
                lp[xx,yy]=tuple(max(0,min(255,round(c+grad))) for c in v[:3])+(255,)
        # Soft warm rim and dark lash line, with a thinner fold across the upper lid.
        stroke(d,[(x,y-.55) for x,y in lash],(209,137,83,255),.65)
        stroke(d,lash,(43,27,19,255),width)
        stroke(d,low,(65,35,22,255),.65)
        if amount>.8:
            fold=[(a[0],a[1]+(b[1]-a[1])*.35) for a,b in zip(u,closed)][12:-12]
            stroke(d,fold,(133,76,44,180),.55)
    eye_mask=Image.new("L",(W,H))
    ImageDraw.Draw(eye_mask).rectangle((195,60,274,92),fill=255)
    return composite(im,layer,eye_mask)

# The top edge follows the underside of the nose, so the nose is never repainted.
MOUTH_PATH=path((192.8,93.0),[
 ((198,98),(205,99.3),(213.8,95.5)),
 ((213.5,102),(220,112.0),(231.6,114.4)),
 ((239.0,117.0),(247.5,108.5),(249.0,104.3)),
 ((253.5,109.4),(261.2,110.0),(265.4,108.2)),
 ((264.2,116.9),(250,126.0),(238.0,127.7)),
 ((220,128.0),(203,116),(196.8,103.5)),
 ((194,98.9),(192,95.3),(192.8,93.0))])
mask_hi=Image.new('L',(W*S,H*S));poly(ImageDraw.Draw(mask_hi),MOUTH_PATH,255)
MOUTH_MASK=mask_hi.resize((W,H),Image.Resampling.LANCZOS)
# Hard support stops resampling from changing a pixel outside the specified mouth outline.
MOUTH_MASK=MOUTH_MASK.point(lambda p: p if p>=8 else 0)

def skin_base():
    """Harmonic fill of the old mouth, anchored to the surrounding original skin."""
    p=SRC.load(); mp=MOUTH_MASK.load()
    coords=[(x,y) for y in range(90,131) for x in range(189,269) if mp[x,y]>0]
    # Fill uses skin sampled directly below the mouth; the source drawing supplies grain.
    values={}
    for x,y in coords:
        a=p[x,133]; b=p[x,139]
        values[x,y]=tuple(.6*a[c]+.4*b[c] for c in range(3))
    target={}
    for x,y in coords:
        t=max(0,min(1,(x-198)/65))
        target[x,y]=(178-19*t,111-9*t,71-5*t)
    for _ in range(350):
        new={}
        for x,y in coords:
            ns=[values.get((xx,yy),p[xx,yy][:3]) for xx,yy in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]]
            new[x,y]=tuple((sum(q[c] for q in ns)*.25+.16*target[x,y][c])/1.16 for c in range(3))
        values=new
    out=SRC.copy(); op=out.load()
    for x,y in coords:
        # Tiny grain is sampled from the nearby beard/skin, without random generators.
        s=p[x, min(143,y+32)]; z=p[x, min(144,y+33)]
        grain=max(-4,min(4,(sum(s[:3])-sum(z[:3]))/9))
        a=mp[x,y]/255
        op[x,y]=tuple(round(p[x,y][c]*(1-a)+(values[x,y][c]+grain)*a) for c in range(3))+(p[x,y][3],)
    return out

BASE=skin_base()

def remapped_mouth(scale):
    # Deform only the mouth vertically around its curved upper lip; never rescale the face.
    out=BASE.copy(); op=out.load(); sp=SRC.load(); mp=MOUTH_MASK.load()
    for y in range(91,130):
        for x in range(191,268):
            if not mp[x,y]:continue
            # Upper edge follows the original asymmetric smile and nose contour.
            if x<214: top=94.5+(x-195)*.025
            elif x<233: top=98+(x-214)*.87
            elif x<249: top=114-(x-233)*.52
            else: top=106+(x-249)*.20
            sy=top+(y-top)/scale
            if sy<top or sy>125: continue
            iy=math.floor(sy); f=sy-iy
            if not(0<=iy<H-1):continue
            # Only carry original mouth material; keep filled skin beyond the new lip.
            if MOUTH_MASK.getpixel((x,iy))<100:continue
            c=tuple(round(sp[x,iy][k]*(1-f)+sp[x,iy+1][k]*f) for k in range(3))
            a=mp[x,y]/255
            op[x,y]=tuple(round(op[x,y][k]*(1-a)+c[k]*a) for k in range(3))+(sp[x,y][3],)
    out.putalpha(SRC.getchannel('A'))
    return out

def drawn_mouth(kind):
    layer=canvas(); d=ImageDraw.Draw(layer)
    if kind=='o':
        lip=path((226.2,115.1),[
            ((229.0,114.9),(232.0,116.0),(235.0,115.5)),
            ((240.5,113.6),(244.3,117.5),(243.1,122.0)),
            ((241.8,127.9),(232.3,129.3),(227.1,125.3)),
            ((223.1,122.8),(222.6,117.3),(226.2,115.1))])
        poly(d,lip,(130,75,44,255));stroke(d,lip,(54,32,21,255),1.0)
        hole=path((227.7,117.4),[
            ((231.5,118.1),(236.5,117.8),(239.2,117.2)),
            ((242.9,122.0),(237.9,125.9),(233.5,125.8)),
            ((227.6,125.5),(224.6,120.4),(227.7,117.4))])
        poly(d,hole,(30,23,17,255))
        tongue=path((229.6,123.5),[((232,122.0),(236.4,122.0),(239.0,123.4)),((236.5,125.6),(232,126.1),(229.6,123.5))])
        poly(d,tongue,(128,65,42,255))
        stroke(d,path((228.3,126.2),[((231.2,128.2),(238.4,127.7),(241.4,123.9))]),(199,130,80,255),.7)
    else:
        # Compressed lips for M/B/P: asymmetric line maintains the character's crooked grin.
        crease=path((199,103.0),[
            ((205.5,111),(217.5,117.0),(230.0,118.6)),
            ((242.7,120.2),(253.5,115.9),(260.7,111.8))])
        stroke(d,[(x,y+1.0) for x,y in crease],(125,73,43,255),2.6)
        stroke(d,crease,(50,32,22,255),1.35)
        stroke(d,[(x,y+2.2) for x,y in crease][15:-10],(197,134,84,255),.7)
        stroke(d,path((200,103.7),[((198.6,102.6),(198,101.1),(198.5,100.2))]),(77,44,27,255),.9)
    return preserve_moustache(composite(BASE,layer,MOUTH_MASK), SRC)

def save_clip(kind,frames):
    paths=[]
    for i,frame in enumerate(frames,1):
        name=f'{kind}-{i:02d}.png';frame.save(ROOT/name);paths.append(name)
    return paths

blink=[SRC.copy(),eye_frame(.54),eye_frame(1),eye_frame(.72),SRC.copy()]
talk=[SRC.copy(),remapped_mouth(1.21),remapped_mouth(.52),drawn_mouth('o'),drawn_mouth('m')]
clips=[{'kind':'blink','label':'Přirozené mrknutí','fps':12,'frames':save_clip('blink',blink)},
       {'kind':'talk','label':'Mluvení – klid, A, E, O, M','fps':12,'frames':save_clip('talk',talk)}]

# The contact sheet contains full-canvas registration previews and enlarged face details.
sheet=Image.new('RGB',(5*306,2*570),(231,225,211));d=ImageDraw.Draw(sheet)
font=ImageFont.load_default()
for row,frames in enumerate((blink,talk)):
    labels=['source','closing 54%','closed','opening 72%','source'] if row==0 else ['neutral','A','E','O','M / B / P']
    for col,frame in enumerate(frames):
        x=col*306; y=row*570
        d.text((x+10,y+8),f'{"blink" if row==0 else "talk"} {col+1}: {labels[col]}',fill=(40,35,28),font=font)
        crop=frame.crop((185,55,278,137)).resize((279,246),Image.Resampling.NEAREST)
        sheet.paste(crop,(x+12,y+29))
        preview=frame.resize((141,286),Image.Resampling.LANCZOS)
        sheet.paste(preview,(x+78,y+280))
sheet.save(ROOT/'contact-sheet.png')

# Verify exact RGBA preservation, spatial separation and actual pose diversity.
def changed_box(im):
    a=SRC.load();b=im.load();pts=[(x,y) for y in range(H) for x in range(W) if a[x,y]!=b[x,y]]
    if not pts:return None
    return [min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts)+1,max(p[1] for p in pts)+1]
boxes={k:[changed_box(f) for f in fs] for k,fs in [('blink',blink),('talk',talk)]}
assert blink[0].tobytes()==SRC.tobytes()==blink[-1].tobytes()
assert len({f.tobytes() for f in talk})==5
assert len({f.tobytes() for f in blink})==4
for frame in blink+talk:
    assert frame.size==(302,613)
    assert frame.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
for kind,frames in [('blink',blink),('talk',talk)]:
    for frame in frames:
        a=SRC.load(); b=frame.load()
        for y in range(H):
            for x in range(W):
                if a[x,y]==b[x,y]: continue
                if kind=='talk': assert MOUTH_MASK.getpixel((x,y))>0
                else: assert 195<=x<=274 and 60<=y<=92
for b in boxes['blink']:
    for t in boxes['talk']:
        if b and t:assert b[2]<=t[0] or t[2]<=b[0] or b[3]<=t[1] or t[3]<=b[1],(b,t)
(ROOT/'validation.json').write_text(json.dumps({'size':[W,H],'alpha_preserved':True,'changed_rectangles':boxes,'distinct_talk_frames':5,'blink_endpoints_exact':True},indent=2))
notes='Dva zarovnané klipy po pěti snímcích při 12 fps. Mrknutí zakrývá oči anatomickými víčky bez deformace zorniček; první a poslední snímek přesně odpovídají předloze. Řeč má pět různých poloh: původní klidový úsměv, A, E, O a sevřené M/B/P. Všechny pixely mimo oddělené oblasti očí a úst i původní alfa jsou zachovány. Omezení: z jediné kresby jsou skryté části víček a rtů lokálně dokreslené, původní klidový výraz je úsměv; nejde o synchronizaci s konkrétním zvukem.'
(ROOT/'result.json').write_text(json.dumps({'notes':notes,'scripts':['generate.py','repair_moustache.py'],'clips':clips},ensure_ascii=False,indent=2))
print(json.dumps(boxes,indent=2))

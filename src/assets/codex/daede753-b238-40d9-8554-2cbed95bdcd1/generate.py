"""Reproduce localized, alpha-preserving facial animation using Pillow only."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import math, json, hashlib

ROOT = Path(__file__).resolve().parent
SRC = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SRC.size
S = 4

def bezier(points):
    points = [pair for item in points for pair in ([item] if len(item) == 2 else list(zip(item[::2], item[1::2])))]
    out = [points[0]]
    for k in range(1, len(points), 3):
        a, b, c, d = out[-1], *points[k:k+3]
        for n in range(1, 25):
            t = n / 24; q = 1-t
            out.append((q*q*q*a[0]+3*q*q*t*b[0]+3*q*t*t*c[0]+t*t*t*d[0],
                        q*q*q*a[1]+3*q*q*t*b[1]+3*q*t*t*c[1]+t*t*t*d[1]))
    return out

def polygon_mask(points):
    m = Image.new('L', (W*S,H*S)); d=ImageDraw.Draw(m)
    d.polygon([(round(x*S),round(y*S)) for x,y in points],fill=255)
    return m.resize((W,H),Image.Resampling.LANCZOS)

def paste_rgb(im, layer, mask):
    # Explicitly retain even hidden source RGB bytes outside the edit mask.
    out = Image.composite(layer.convert('RGB'), im.convert('RGB'), mask).convert('RGBA')
    out.putalpha(SRC.getchannel('A'))
    return out

EYES = [
    dict(outline=[(216.5,71),(217,64,222,60.3,228.5,61),(236.2,60.5,240.7,66.4,240.3,73.7),(240.3,80,234.5,83,227.5,82),(219.5,81.7,216,77,216.5,71)],
         left=(216.8,71.5),right=(240,74.6),top=60.5,bottom=82.3),
    dict(outline=[(248.7,85),(249,80,253.5,77.5,257.9,78.3),(263.3,78.5,265.7,81.7,265.1,87.5),(264.7,94,260.2,96.4,255.4,95.7),(250,95.4,248.4,90.2,248.7,85)],
         left=(248.8,85.1),right=(265.2,87),top=77.9,bottom=96)
]

def blink(amount):
    if amount == 0: return SRC.copy()
    im=SRC.copy()
    for ei,e in enumerate(EYES):
        left,right=e['left'],e['right']; x0,y0=left; x1,y1=right
        eye_mask=polygon_mask(bezier(e['outline']))
        # Upper lid travels across the fixed eyeball; lower lid rises a little.
        lid_mid=e['top']+(e['bottom']-e['top'])*(.14+.66*amount)
        lower_mid=e['bottom']-1.8*amount
        if amount >= .999: lower_mid=lid_mid
        upper=bezier([left,(x0+4,lid_mid),(x1-5,lid_mid+1),right])
        lower=bezier([left,(x0+3,lower_mid),(x1-4,lower_mid+1),right])
        cover=Image.new('L',(W*S,H*S)); cd=ImageDraw.Draw(cover)
        cd.polygon([(x0*S,(e['top']-3)*S),(x1*S,(e['top']-3)*S)]+[(x*S,y*S) for x,y in reversed(upper)],fill=255)
        cd.polygon([(x0*S,(e['bottom']+3)*S),(x1*S,(e['bottom']+3)*S)]+[(x*S,y*S) for x,y in reversed(lower)],fill=255)
        cover=ImageChops.multiply(cover.resize((W,H),Image.Resampling.LANCZOS),eye_mask)
        skin=SRC.convert('RGB').copy(); sp=skin.load()
        for y in range(int(e['top'])-2,int(e['bottom'])+3):
            for x in range(int(x0)-1,int(x1)+2):
                # Tiny deterministic mottling keeps the coarse painted texture.
                noise=((x*37+y*23+x*y*3)%17)-8
                v=(y-e['top'])/(e['bottom']-e['top'])
                sp[x,y]=(int(196+16*v+noise),int(111+15*v+noise*.65),int(72+11*v+noise*.4))
        im=paste_rgb(im,skin,cover)
        lines=Image.new('RGBA',(W*S,H*S)); ld=ImageDraw.Draw(lines)
        def stroke(p,col,width):
            ld.line([(x*S,y*S) for x,y in p],fill=col,width=round(width*S),joint='curve')
        stroke([(x,y-.8) for x,y in upper],(240,155,102,180),.7)
        stroke(upper,(46,27,18,255),1.25)
        if amount < .999: stroke(lower,(75,36,22,240),.9)
        # Small lid fold gives anatomical volume rather than a flat eye wipe.
        fold=[(x,y-2.6) for x,y in upper[4:-4]]
        stroke(fold,(119,60,36,150),.65)
        lines=lines.resize((W,H),Image.Resampling.LANCZOS)
        lm=ImageChops.multiply(lines.getchannel('A'),eye_mask)
        im=paste_rgb(im,lines,lm)
    return im

# Local mouth coordinates follow the slanted original jaw and teeth.
CX,CY=213.3,113.5
C=math.cos(math.radians(25)); SN=math.sin(math.radians(25))

def bilinear(x,y):
    x=max(0,min(W-1.001,x));y=max(0,min(H-1.001,y))
    ix,iy=int(x),int(y);fx,fy=x-ix,y-iy
    q=[SRC.getpixel((ix,iy)),SRC.getpixel((ix+1,iy)),SRC.getpixel((ix,iy+1)),SRC.getpixel((ix+1,iy+1))]
    return tuple(round(q[0][k]*(1-fx)*(1-fy)+q[1][k]*fx*(1-fy)+q[2][k]*(1-fx)*fy+q[3][k]*fx*fy) for k in range(3))

def axis_inverse(t,scale,inner,outer):
    sign=1 if t>=0 else -1;t=abs(t)
    target=inner*scale
    if t<target: q=t/scale
    elif t<outer:q=inner+(t-target)*(outer-inner)/(outer-target)
    else:q=t
    return q*sign

# Edit region follows the original mouth, staying clear of the nose and beard.
MOUTH_PATH=[(192,112),(193,106,198,102,205,102),(213,102,221,108,227,111),(230,115,237,119,237,124),(237,129,234,133,230,133),(221,129,211,125,207,124),(200,124,192,121,192,112)]
MOUTH_MASK=polygon_mask(bezier(MOUTH_PATH))
# The cigarette and its edge pixels remain pinned to the original drawing.
mm=MOUTH_MASK.load()
for y in range(H):
    for x in range(W):
        if mm[x,y]:
            # Cigarette runs from the corner at (209,120) down-left.
            dx=x-207.5;dy=y-122
            along=dx*(-.64)+dy*.77
            across=abs(dx*.77+dy*.64)
            if along>=-2.3 and across<2.5: mm[x,y]=0
            elif along>=-2.8 and across<3.3: mm[x,y]=int(mm[x,y]*max(0,(across-2.5)/.8))


def talk(width,height):
    if width==height==1: return SRC.copy()
    layer=SRC.convert('RGB').copy(); p=layer.load()
    for y in range(100,135):
        for x in range(190,240):
            if not MOUTH_MASK.getpixel((x,y)):continue
            dx=x-CX;dy=y-CY;u=C*dx+SN*dy;v=-SN*dx+C*dy
            su=axis_inverse(u,width,17,25)
            sv=axis_inverse(v,height,10.0,17.0)
            p[x,y]=bilinear(CX+C*su-SN*sv,CY+SN*su+C*sv)
    return paste_rgb(SRC,layer,MOUTH_MASK)

blink_frames=[blink(t) for t in [0,.53,1,.35,0]]
talk_frames=[talk(w,h) for w,h in [(1,1),(1.02,1.30),(.65,1.05),(1.03,.48),(.90,.12)]]
clips=[]
for kind,label,frames in [('blink','Přirozené mrknutí',blink_frames),('talk','Mluvení – pět poloh úst',talk_frames)]:
    names=[]
    for n,im in enumerate(frames,1):
        name=f'{kind}-{n:02d}.png';im.save(ROOT/name);names.append(name)
    clips.append(dict(kind=kind,label=label,fps=12,frames=names))

# Contact sheet: all full canvases plus enlarged face details, on a neutral ground.
sheet=Image.new('RGB',(5*343,2*(523+240)),(57,58,55)); sd=ImageDraw.Draw(sheet)
for row,frames in enumerate([blink_frames,talk_frames]):
    for col,im in enumerate(frames):
        ox=col*343;oy=row*763
        sheet.paste(im,(ox,oy),im)
        crop=im.crop((188,55,270,139)).resize((234,240),Image.Resampling.NEAREST)
        sheet.paste(crop,(ox+55,oy+523),crop)
        sd.text((ox+8,oy+8),f'{"blink" if row==0 else "talk"} {col+1}',fill='white')
sheet.save(ROOT/'contact-sheet.png')

# Verify actual pixels, rather than assuming masked painting stayed localized.
def diff_bounds(im):
    coords=[]
    for y in range(H):
        for x in range(W):
            if im.getpixel((x,y))!=SRC.getpixel((x,y)):coords.append((x,y))
    if not coords:return None
    return [min(x for x,y in coords),min(y for x,y in coords),max(x for x,y in coords)+1,max(y for x,y in coords)+1]
def union_bbox(frames):
    b=[diff_bounds(f) for f in frames];b=[q for q in b if q]
    return [min(q[0] for q in b),min(q[1] for q in b),max(q[2] for q in b),max(q[3] for q in b)]
bb=union_bbox(blink_frames);tb=union_bbox(talk_frames)
assert bb[3]<=tb[1] or tb[3]<=bb[1] or bb[2]<=tb[0] or tb[2]<=bb[0],(bb,tb)
assert blink_frames[0].tobytes()==SRC.tobytes()==blink_frames[-1].tobytes()
assert len({f.tobytes() for f in talk_frames})==5
for frames in [blink_frames,talk_frames]:
    assert len(frames)==5
    for im in frames:
        assert im.size==(343,523)
        assert im.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
# Every changed pixel is inside the corresponding exact anatomical edit mask.
eye_union=ImageChops.lighter(polygon_mask(bezier(EYES[0]['outline'])),polygon_mask(bezier(EYES[1]['outline'])))
for frames,mask in [(blink_frames,eye_union),(talk_frames,MOUTH_MASK)]:
    for im in frames:
        for y in range(H):
            for x in range(W):
                if not mask.getpixel((x,y)):assert im.getpixel((x,y))==SRC.getpixel((x,y))

result=dict(notes='Dva zarovnané klipy po pěti snímcích při 12 fps. Mrknutí používá horní a dolní víčka bez zmenšování očí; první a poslední snímek jsou přesnou kopií zdroje. Mluvení obsahuje původní neutrální polohu, otevřenou, zaoblenou, úzkou a téměř zavřenou polohu úst. Zachována původní kresba zubů i cigareta. Alfa je ve všech snímcích beze změny a všechny pixely mimo lokální masky očí a úst jsou totožné se zdrojem. Oblasti změn se nepřekrývají. Omezení: drobné detaily úst jsou omezené původním rozlišením.',scripts=['generate.py'],clips=clips)
(ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(blink_bounds=bb,talk_bounds=tb,distinct_blink=len({f.tobytes() for f in blink_frames}),distinct_talk=5,alpha='identical',outside_masks='identical'),indent=2))

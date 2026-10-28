#!/usr/bin/env python3
"""Local, deterministic Pillow-only facial animation; no network or extra packages."""
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent
SRC = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SRC.size
S = 6
SZ = (W*S, H*S)

def bez(p, n=48):
    out = []
    for i in range(n+1):
        t=i/n; u=1-t
        out.append((u*u*u*p[0][0]+3*u*u*t*p[1][0]+3*u*t*t*p[2][0]+t*t*t*p[3][0],
                    u*u*u*p[0][1]+3*u*u*t*p[1][1]+3*u*t*t*p[2][1]+t*t*t*p[3][1]))
    return out

def path(*segments):
    return [q for seg in segments for q in bez(seg)]

def pts(p): return [(round(x*S),round(y*S)) for x,y in p]
def polygon(im,p,fill): ImageDraw.Draw(im).polygon(pts(p),fill=fill)
def stroke(im,p,fill,width):
    ImageDraw.Draw(im).line(pts(p),fill=fill,width=max(1,round(width*S)),joint='curve')
def down(im): return im.resize((W,H),Image.Resampling.LANCZOS)
def combine(rgb,mask):
    # Only selected RGB bytes can change. Source alpha is copied byte-for-byte.
    out=Image.composite(rgb.convert('RGB'),SRC.convert('RGB'),mask)
    out.putalpha(SRC.getchannel('A'))
    return out

def blink(amount):
    if amount==0: return SRC.copy()
    original=SRC.convert('RGB').resize(SZ,Image.Resampling.BICUBIC)
    paint=original.copy(); total=Image.new('L',SZ)
    eyes=[
        dict(left=(54.1,52.1),right=(71.9,53.6),top=((54.4,45.5),(65.5,43.9)),
             bottom=((56.0,57.5),(69.5,59.5)), skin=(190,110,72),
             roof=path(((53.0,52.1),(52.3,47.8),(56.2,43.8),(61.0,44.1)),
                       ((61.0,44.1),(65.8,44.0),(70.6,47.6),(72.2,51.7)))),
        dict(left=(85.5,60.7),right=(102.4,62.8),top=((85.6,53.4),(101.5,52.8)),
             bottom=((85.6,66.0),(101.1,67.8)), skin=(185,105,69),
             roof=path(((84.2,60.7),(84.0,56.5),(88.8,53.3),(94.0,53.8)),
                       ((94.0,53.8),(99.0,53.8),(103.3,57.1),(103.6,62.8))))]
    for e in eyes:
        a,b=e['left'],e['right']; top=e['top']; bot=e['bottom']
        # Lid rotates down over the eyeball; original eye pixels are never resized.
        c1=tuple(top[0][j]*(1-amount)+bot[0][j]*amount for j in range(2))
        c2=tuple(top[1][j]*(1-amount)+bot[1][j]*amount for j in range(2))
        lid=bez((a,c1,c2,b))
        roof=e['roof']
        cover=Image.new('L',SZ)
        polygon(cover,roof+list(reversed(lid)),255)
        if amount==1:
            # Closed lid must cover every last white/iris pixel along the lower arc.
            lower_controls = ((52.5,63.6),(74.0,64.0)) if a[0]<70 else ((83.0,72.8),(106.5,73.0))
            polygon(cover,roof+list(reversed(bez((a,lower_controls[0],lower_controls[1],b)))),255)
        skin=Image.new('RGB',SZ)
        # Subtle shading matches the painted skin and avoids flat solid eyelids.
        sd=ImageDraw.Draw(skin)
        for y in range(H*S):
            shade=0.22*(y/S-a[1])
            col=tuple(max(0,min(255,round(c+shade))) for c in e['skin'])
            sd.line((0,y,W*S,y),fill=col)
        paint.paste(skin,(0,0),cover)
        total=ImageChops.lighter(total,cover)
        line_layer=Image.new('RGB',SZ)
        line_mask=Image.new('L',SZ)
        stroke(line_layer,lid,(65,38,24),1.05)
        stroke(line_mask,lid,255,1.05)
        paint.paste(line_layer,(0,0),line_mask)
        total=ImageChops.lighter(total,line_mask)
    mask=down(total)
    return combine(down(paint),mask)

# Remove only the old lip and its central outline, keeping both mouth corners.
MOUTH_REGION=[(54.0,86.3),(62.0,84.8),(69.0,85.0),(75.0,87.1),
 (81.8,88.0),(86.0,91.8),(86.0,95.0),(81.0,97.0),(73.0,97.7),
 (65.0,95.3),(59.0,93.4),(54.0,90.4)]

def clean_mouth():
    mask_hi=Image.new('L',SZ); polygon(mask_hi,MOUTH_REGION,255)
    mask=down(mask_hi)
    # Harmonic interpolation from the surrounding original skin, local only.
    hard=mask.point(lambda v:255 if v>16 else 0)
    coords=[(x,y) for y in range(83,100) for x in range(52,88) if hard.getpixel((x,y))]
    data=[[list(SRC.getpixel((x,y))[:3]) for x in range(W)] for y in range(H)]
    for x,y in coords: data[y][x]=[192.0,111.0,72.0]
    for _ in range(500):
        for x,y in coords:
            data[y][x]=[sum((data[y-1][x][c],data[y+1][x][c],data[y][x-1][c],data[y][x+1][c]))/4 for c in range(3)]
    base=SRC.convert('RGB')
    for x,y in coords: base.putpixel((x,y),tuple(round(v) for v in data[y][x]))
    return base,mask

BASE,MOUTH_MASK=clean_mouth()
INK=(73,38,24); LIP=(169,76,55); LIP_LIGHT=(181,88,63); CAVITY=(68,29,23)

def talk(pose):
    if pose=='neutral': return SRC.copy()
    im=BASE.resize(SZ,Image.Resampling.BICUBIC)
    local=Image.new('L',SZ)
    def shape(p,color): polygon(im,p,color); polygon(local,p,255)
    def line(p,color,width): stroke(im,p,color,width); stroke(local,p,255,width)
    # Corners stay attached to the original frowning expression.
    if pose=='eh':
        upper=path(((54.5,88.1),(61,86.6),(65,86.4),(69.0,87.4)),((69,87.4),(75,89.8),(79,89.0),(85,92.7)))
        lower=bez(((85,92.7),(76,97.0),(62,94.5),(54.5,88.1)))
        shape(upper+lower,LIP)
        opening=path(((56.7,88.8),(65,87.1),(74,90.0),(82.7,92.4)),((82.7,92.4),(74,94.0),(63,92.0),(56.7,88.8)))
        shape(opening,CAVITY)
        teeth=path(((57.8,88.9),(65,87.6),(73,90.0),(81.5,92.1)),((81.5,92.1),(73,92.7),(64,90.6),(57.8,88.9)))
        shape(teeth,(218,196,155)); line(upper,INK,.85)
        line(lower,(120,61,40),.65)
    elif pose=='ah':
        upper=path(((54.5,88.2),(61,86.4),(66,86.5),(69,87.6)),((69,87.6),(75,90),(80,89.9),(85,92.7)))
        lower=bez(((85,92.7),(77,101.1),(61,97.8),(54.5,88.2)))
        shape(upper+lower,LIP)
        op=path(((57.3,88.9),(66,87.3),(75,90.1),(82.4,92.5)),((82.4,92.5),(75,98.0),(63,96.4),(57.3,88.9)))
        shape(op,CAVITY)
        tongue=path(((64,94.3),(69,93.2),(75,94.1),(78.4,95.0)),((78.4,95),(73,97.0),(67,95.9),(64,94.3)))
        shape(tongue,(158,76,64))
        line(upper,INK,.95);line(lower,(125,61,40),.7)
    elif pose=='oh':
        # Rounded lips, with short unchanged corner attachments.
        line(bez(((54.5,88.2),(58.5,87.7),(60,88),(62,88.5))),INK,.85)
        line(bez(((78,91.5),(80,91.3),(83,91.6),(85,92.7))),INK,.85)
        outer=path(((62,88.5),(65,85.6),(73,87.0),(77.4,90.2)),((77.4,90.2),(82,96.2),(73,99.9),(67,96.8)),((67,96.8),(62,95.2),(60,91.5),(62,88.5)))
        shape(outer,LIP)
        hole=path(((65,89.4),(68,87.7),(74,89.5),(75.7,91.5)),((75.7,91.5),(78,95.5),(72,97.3),(68.1,95.4)),((68.1,95.4),(65.2,94.1),(63.8,91.6),(65,89.4)))
        shape(hole,CAVITY);line(outer,(121,58,38),.8)
        line(bez(((68.6,97.0),(71,97.7),(74.8,98.0),(77,95.6))),(190,100,70),.65)
    elif pose=='mm':
        seam=path(((54.5,88.2),(60,87.7),(65,87.4),(69,88.4)),((69,88.4),(75,91.3),(80,89.6),(85,92.7)))
        lower=bez(((85,92.7),(78,95.5),(64,93.3),(57.0,89.1)))
        shape(seam+lower,LIP_LIGHT)
        line(seam,INK,1.0)
        line(bez(((62,91.1),(68,93.2),(75,94.3),(80,93.0))),(149,70,46),.65)
    else: raise ValueError(pose)
    mask=ImageChops.lighter(MOUTH_MASK,down(local))
    return combine(down(im),mask)

def changed_bounds(a,b):
    return ImageChops.difference(a,b).convert('RGB').getbbox()

def main():
    blink_frames=[blink(t) for t in (0,.55,1,.30,0)]
    talk_frames=[talk(p) for p in ('neutral','eh','ah','oh','mm')]
    clips=[]
    for kind,frames,label in [('blink',blink_frames,'Přirozené mrknutí'),('talk',talk_frames,'Mluvení – klid, E, A, O, M')]:
        names=[]
        for i,im in enumerate(frames,1):
            name=f'{kind}-{i:02d}.png';im.save(ROOT/name);names.append(name)
        clips.append(dict(kind=kind,label=label,fps=12,frames=names))
    result=dict(notes='Dvě zarovnané animace po pěti snímcích, 12 fps. Mrknutí překrývá bělmo anatomickými víčky; první a poslední snímek jsou přesnou kopií zdroje. Mluvení obsahuje původní neutrální ústa a čtyři odlišné tvary E, A, O a M. Mění se pouze oči, respektive ústa; oblasti změn se nepřekrývají. Rozměry 133 × 201 px, poloha i celý alfa kanál jsou zachovány. Při takto malém rozlišení jsou detaily víček a rtů omezené na několik pixelů.',scripts=['generate.py'],clips=clips)
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    # Contact sheet: the full unchanged canvas, nearest-neighbour enlargement.
    sheet=Image.new('RGB',(5*W*3,2*(H*3+26)),(35,35,39))
    dr=ImageDraw.Draw(sheet)
    for row,frames in enumerate((blink_frames,talk_frames)):
        for i,im in enumerate(frames):
            x=i*W*3;y=row*(H*3+26)
            tile=Image.new('RGBA',im.size,(62,63,67,255));tile.alpha_composite(im)
            sheet.paste(tile.convert('RGB').resize((W*3,H*3),Image.Resampling.NEAREST),(x,y+26))
            dr.text((x+8,y+7),f'{"BLINK" if row==0 else "TALK"} {i+1}',fill='white')
    sheet.save(ROOT/'contact-sheet.png')
    face=Image.new('RGB',(5*74*5,2*70*5),(40,40,43))
    for row,frames in enumerate((blink_frames,talk_frames)):
        for i,im in enumerate(frames):
            face.paste(im.crop((38,35,112,105)).convert('RGB').resize((370,350)),(i*370,row*350))
    face.save(ROOT/'face-contact-sheet.png')
    # Contract verification also records precise changed bounding rectangles.
    boxes={}
    for kind,frames in [('blink',blink_frames),('talk',talk_frames)]:
        union=Image.new('L',SRC.size)
        for im in frames:
            assert im.size==SRC.size and im.mode=='RGBA'
            assert im.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
            d=ImageChops.difference(im.convert('RGB'),SRC.convert('RGB'))
            r,g,b=d.split()
            exact=ImageChops.lighter(ImageChops.lighter(r,g),b).point(lambda v:255 if v else 0)
            union=ImageChops.lighter(union,exact)
        boxes[kind]=union.getbbox()
    assert blink_frames[0].tobytes()==SRC.tobytes()==blink_frames[-1].tobytes()
    assert len({im.tobytes() for im in talk_frames})==5
    assert len({im.tobytes() for im in blink_frames})>=3
    a,b=boxes['blink'],boxes['talk']
    assert a[3]<=b[1] or b[3]<=a[1] or a[2]<=b[0] or b[2]<=a[0]
    print(json.dumps({'verified':True,'changed_rectangles':boxes,'blink_unique':len({im.tobytes() for im in blink_frames}),'talk_unique':5}))

if __name__=='__main__': main()

"""Deterministic, local Pillow animation; all coordinates are source pixels.

The eyeballs are never rescaled: upper and lower lids occlude fixed source
pixels. Mouth art is restricted below both eyes so the clips compose safely.
Only RGB inside explicit edit masks is written; alpha is copied verbatim.
"""
from pathlib import Path
import json
import math
import shutil
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent
SOURCE = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SOURCE.size
S = 6
SIZE = (W*S, H*S)
INK = (36, 24, 17)

def bezier(p0, p1, p2, p3, n=50):
    return [tuple((1-t)**3*p0[j]+3*(1-t)**2*t*p1[j]+3*(1-t)*t*t*p2[j]+t**3*p3[j] for j in (0,1)) for t in [i/n for i in range(n+1)]]

def curve(*p):
    return bezier(*p)

def scale(points):
    return [(round(x*S),round(y*S)) for x,y in points]

def line(im, points, color, width):
    ImageDraw.Draw(im).line(scale(points), fill=color, width=max(1,round(width*S)), joint='curve')

def polygon(im, points, color):
    ImageDraw.Draw(im).polygon(scale(points),fill=color)

def mask_path(points):
    m=Image.new('L', SIZE)
    polygon(m,points,255)
    return m

def mixpt(a,b,t):
    return tuple(x*(1-t)+y*t for x,y in zip(a,b))

def finish(hi, mask):
    """Antialias artwork, preserve original pixels and the entire source alpha."""
    rgb=hi.resize((W,H),Image.Resampling.LANCZOS).convert('RGB')
    m=mask.resize((W,H),Image.Resampling.LANCZOS)
    out=SOURCE.copy()
    orig=SOURCE.load(); p=out.load(); q=rgb.load(); a=m.load()
    for y in range(H):
        for x in range(W):
            if a[x,y]:
                p[x,y]=q[x,y]+(orig[x,y][3],)
    return out

def skin_texture(kind):
    # Tiny deterministic variations retain the softly painted source texture.
    out=Image.new('RGB',(W,H)); p=out.load()
    for y in range(H):
        for x in range(W):
            grain=(SOURCE.getpixel((57+x%7,96+y%16))[0]-182)*.15
            if kind=='left':
                base=(177,114,74)
                shade=-3.6*math.exp(-((x-29)/7)**2)+.13*(y-118)
            elif kind=='right':
                base=(182,119,78)
                shade=-2*math.exp(-((x-69)/5)**2)+.05*(y-106)
            else:
                base=(182,119,78)
                shade=-.40*(y-135)+.08*(x-63)
            p[x,y]=tuple(max(0,min(255,round(c+shade+grain))) for c in base)
    return out.resize(SIZE,Image.Resampling.BICUBIC)

LEFT=[(28,114),(29,110),(34,107.5),(40,107.5),(46,110),(51,115),(54,121),(54,125),(49,129),(43,131),(36,130),(31,126),(28,120)]
RIGHT=[(67.5,105),(68,99),(72,94.5),(78,92.5),(86,93),(93,96),(96,101),(97,106),(95,112),(90,116),(83,120),(76,120.5),(71,116),(68,111)]

def eye(im, region, kind, t):
    m=mask_path(region)
    # Feather only at the perimeter of the painted eye socket.
    m=m.filter(ImageFilter.GaussianBlur(.32*S))
    im.paste(skin_texture(kind),(0,0),m)
    if kind=='left':
        a,b=(29.3,116),(52,122.4)
        top=[a,(30.2,103.5),(45.4,106),b]
        shut=[a,(34,124.4),(44.5,130.3),b]
        bottom=[b,(47.2,133.5),(32,130.4),a]
    else:
        a,b=(69.1,105.7),(94.1,103.6)
        top=[a,(68.1,92.1),(89.7,89.7),b]
        shut=[a,(75.5,116.2),(88.6,115.4),b]
        bottom=[b,(95.6,116.1),(72.9,125.7),a]
    upper=[mixpt(p,q,t) for p,q in zip(top,shut)]
    # Lower eyelid lifts gently while the upper lid does most of the motion.
    lower=[mixpt(p,q,t*.25) for p,q in zip(bottom,list(reversed(shut)))]
    if t<1:
        aperture=mask_path(curve(*upper)+curve(*lower))
        aperture=ImageChops.multiply(aperture,m)
        im.paste(SOURCE.convert('RGB').resize(SIZE,Image.Resampling.BICUBIC),(0,0),aperture)
        # New lid rim, not a deformation of the eyeball.
        line(im,curve(*lower),(98,56,34),.65)
    else:
        lower=list(reversed(shut))
    crease=[(x,y-2.1) for x,y in curve(*upper)]
    line(im,crease,(151,90,53),.55)
    line(im,curve(*upper),(51,32,21),1.12)
    # Brief tapered lashes follow the existing outer corners.
    if kind=='left':
        line(im,[(29.5,116.5),(28.1,115.4)],INK,.8)
    else:
        line(im,[(93.5,104.1),(95.2,103.3)],INK,.85)
    return m

def blink(t):
    if t==0: return SOURCE.copy()
    hi=SOURCE.convert('RGB').resize(SIZE,Image.Resampling.BICUBIC)
    m1=eye(hi,LEFT,'left',t)
    m2=eye(hi,RIGHT,'right',t)
    mask=ImageChops.lighter(m1,m2)
    # Explicit hard edit bounds ensure the talk rectangle starts below blink.
    allowed=Image.new('L',SIZE); ImageDraw.Draw(allowed).rectangle((26*S,91*S,99*S,132*S-1),fill=255)
    mask=ImageChops.multiply(mask,allowed)
    # Avoid any LANCZOS support leaking below original y=131.
    result=finish(hi,mask)
    bounded=SOURCE.copy()
    bounded.paste(result.crop((26,91,100,132)),(26,91))
    return bounded

# Mouth cleanup follows the curved lips. The nose, freckles, chin outline,
# smile's raised right corner, and all eye pixels remain source pixels.
MOUTH=[(48.3,134.8),(52,134.5),(57,135),(62,134.7),(67,133.4),(72,132),(79,132),(78,136),(74,140),(69,142.8),(61,143.8),(54,141),(49,138.6)]

def mouth(pose):
    if pose=='neutral': return SOURCE.copy()
    hi=SOURCE.convert('RGB').resize(SIZE,Image.Resampling.BICUBIC)
    mask=mask_path(MOUTH).filter(ImageFilter.GaussianBlur(.32*S))
    hi.paste(skin_texture('mouth'),(0,0),mask)
    if pose=='closed':
        lip=curve((49.4,136.8),(57,140),(69,136.3),(78.7,131.8))
        line(hi,lip,(53,29,17),1.0)
        line(hi,curve((59,140),(64,141.1),(68,139.7),(70.5,138.5)),(147,82,50),.65)
    elif pose=='ee':
        upper=curve((49.4,136.7),(59,138.7),(68.8,135),(78.6,131.7))
        lower=curve((78.6,131.7),(72.6,138.3),(59.3,142.3),(49.4,136.7))
        polygon(hi,upper+lower,(40,23,17))
        teeth=curve((53.1,137.6),(60.9,138.1),(69.8,134.7),(75.2,133.3))+curve((75.2,133.3),(68.6,137.7),(60,140),(53.1,137.6))
        polygon(hi,teeth,(215,199,165))
        line(hi,upper+lower,(48,26,17),.8)
        line(hi,curve((62,141.5),(67,141.2),(70.8,139),(73,137.9)),(141,76,45),.65)
    elif pose=='aa':
        upper=curve((49.4,136.7),(57.9,138.1),(70,135.5),(78.6,131.7))
        lower=curve((78.6,131.7),(72.7,145.6),(57.2,146),(49.4,136.7))
        polygon(hi,upper+lower,(48,25,20))
        tongue=curve((58.3,142),(62,139.4),(67.9,140.3),(70.5,142))+curve((70.5,142),(66.1,145.2),(61,145),(58.3,142))
        polygon(hi,tongue,(158,82,64))
        teeth=curve((52.8,137.4),(59,138.1),(67.6,136.1),(74.8,133.7))+curve((74.8,133.7),(70.7,136.6),(59.2,140.6),(52.8,137.4))
        polygon(hi,teeth,(218,200,166))
        line(hi,upper+lower,(46,26,18),.9)
    elif pose=='oh':
        # Rounded vowel, with a gentle smile fold leading into its right side.
        line(hi,curve((49.4,136.8),(53,138.2),(56.5,137.9),(58.6,137.2)),(66,36,21),.7)
        line(hi,curve((70,135.6),(73,134.3),(76,133.1),(78.7,131.8)),(65,34,21),.85)
        oval=curve((58.1,137.5),(59,133),(68,132.3),(70.1,135.9))+curve((70.1,135.9),(73,141.6),(62,147.3),(58.1,140))+curve((58.1,140),(57.5,139.1),(57.5,138.3),(58.1,137.5))
        polygon(hi,oval,(48,26,20))
        line(hi,curve((61,142),(63.8,140.1),(67.2,140.1),(68.5,140.8)),(145,74,58),1.2)
        line(hi,oval,(64,34,21),.9)
    # The complete talk changed bounding rectangle must start below blink.
    allowed=Image.new('L',SIZE); ImageDraw.Draw(allowed).rectangle((46*S,132*S,81*S,145*S-1),fill=255)
    mask=ImageChops.multiply(mask,allowed)
    out=finish(hi,mask)
    bounded=SOURCE.copy()
    bounded.paste(out.crop((46,132,82,145)),(46,132))
    return bounded

def changed_bbox(im):
    return ImageChops.difference(SOURCE.convert('RGB'), im.convert('RGB')).getbbox()

def union(boxes):
    boxes=[b for b in boxes if b]
    return (min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes))

def main():
    blink_frames=[blink(t) for t in (0,.58,1,.28,0)]
    talk_frames=[mouth(p) for p in ('neutral','closed','ee','aa','oh')]
    clips=[]
    for kind,label,frames in [('blink','Přirozené mrknutí',blink_frames),('talk','Mluvení – klid, M, E, A, O',talk_frames)]:
        names=[]
        for i,im in enumerate(frames,1):
            name=f'{kind}-{i:02d}.png'
            if im.tobytes()==SOURCE.tobytes():
                shutil.copyfile(ROOT/'source.png',ROOT/name)
            else:
                im.save(ROOT/name)
            names.append(name)
            assert im.size==SOURCE.size
            assert im.getchannel('A').tobytes()==SOURCE.getchannel('A').tobytes()
        clips.append(dict(kind=kind,label=label,fps=12,frames=names))
    assert blink_frames[0].tobytes()==SOURCE.tobytes()==blink_frames[-1].tobytes()
    assert len({f.tobytes() for f in blink_frames})==4
    assert len({f.tobytes() for f in talk_frames})==5
    bb=union([changed_bbox(f) for f in blink_frames]); tb=union([changed_bbox(f) for f in talk_frames])
    assert bb[3]<=tb[1],(bb,tb)
    # Prove every pixel outside the permitted facial edits is identical.
    for frames,regions in [(blink_frames,[(26,91,100,132)]),(talk_frames,[(46,132,82,145)])]:
        for im in frames:
            for y in range(H):
                for x in range(W):
                    if not any(a<=x<c and b<=y<d for a,b,c,d in regions):
                        assert im.getpixel((x,y))==SOURCE.getpixel((x,y))
    notes=('Vytvořeno lokálně pomocí Pillow. Mrknutí: otevřeno, přivření, zavřeno, znovuotevření, původní snímek. '
           'Víčka překrývají původní oči bez jejich deformace. Mluvení obsahuje pět různých tvarů: původní klidový úsměv, sevřené rty M, E, A a O. '
           'Kvůli blízkosti očí a stoupajícímu úsměvu se mění jen spodní část úst; pravý koutek zůstává původní. '
           'Rozměry 177 × 243, poloha a všechny hodnoty alfa jsou zachovány. První i poslední snímek mrknutí jsou přesně původní. '
           f'Obdélníky změn [x0,y0,x1,y1): oči {bb}, ústa {tb}; nepřekrývají se. '
           'Všechny RGBA pixely mimo upravené oblasti zůstávají přesně zachovány.')
    (ROOT/'result.json').write_text(json.dumps(dict(notes=notes,scripts=['generate.py'],clips=clips),ensure_ascii=False,indent=2)+'\n')
    # Full canvas and close-up views for manual quality review.
    sheet=Image.new('RGB',(5*354,2*580),(226,211,184)); d=ImageDraw.Draw(sheet)
    for row,frames in enumerate([blink_frames,talk_frames]):
        for i,im in enumerate(frames):
            x=i*354; y=row*580
            bg=Image.new('RGBA',im.size,(226,211,184,255)); bg.alpha_composite(im)
            sheet.paste(bg.convert('RGB').resize((354,486),Image.Resampling.NEAREST),(x,y+24))
            d.text((x+12,y+6),f'{"BLINK" if row==0 else "TALK"} {i+1}',fill=(45,30,20))
            face=bg.crop((25,91,99,146)).convert('RGB').resize((148,110),Image.Resampling.NEAREST)
            sheet.paste(face,(x+195,y+455))
    sheet.save(ROOT/'contact-sheet.png')
    print(json.dumps({'blink_bounds':bb,'talk_bounds':tb,'unique_blink':4,'unique_talk':5,'alpha':'identical','outside_pixels':'identical'}))

if __name__=='__main__': main()

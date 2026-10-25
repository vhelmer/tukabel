"""Reproduce aligned sprite clips using only Python's stdlib and Pillow.
All compositing is local; the original alpha channel is copied byte for byte.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = Image.open(ROOT / 'source.png').convert('RGBA')
W,H = SRC.size
S = 6
SIZE = (W*S,H*S)
RESAMPLE = Image.Resampling.LANCZOS

def path(points):
    """Cubic paths: first point, followed by triples of control/end points."""
    out=[points[0]]
    p=points[0]
    for i in range(1,len(points),3):
        a,b,c=points[i:i+3]
        for j in range(1,25):
            t=j/24; u=1-t
            out.append((u**3*p[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t**3*c[0],
                        u**3*p[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*c[1]))
        p=c
    return out

def polygon(draw, pts, fill):
    draw.polygon([(round(x*S),round(y*S)) for x,y in pts],fill=fill)

def stroke(draw, pts, color, width):
    draw.line([(round(x*S),round(y*S)) for x,y in pts],fill=color,width=round(width*S),joint='curve')

def composite(rgb, mask):
    # Restrict changes exactly to the finite mask. Alpha never participates in editing.
    out=Image.composite(rgb.convert('RGBA'),SRC,mask)
    out.putalpha(SRC.getchannel('A'))
    return out

def blink(amount):
    if amount==0:
        return SRC.copy()
    art=SRC.convert('RGB').resize(SIZE,Image.Resampling.BICUBIC)
    pixels=art.load()
    mask=Image.new('L',SIZE)
    mp=mask.load()
    eyes=[(61.1,52.3,9.5,8.0,.12),(92.5,60.0,9.7,7.1,.02)]
    for cx,cy,rx,ry,tilt in eyes:
        upper=[]; lower=[]; crease=[]
        # Upper lid travels farther than lower lid, revealing unchanged source pupils.
        for ix in range(math.floor((cx-rx)*S),math.ceil((cx+rx)*S)+1):
            x=ix/S
            q=(x-cx)/rx
            if abs(q)>=1: continue
            h=math.sqrt(1-q*q)
            top=cy+tilt*(x-cx)-ry*h
            bottom=cy+tilt*(x-cx)+ry*h
            seam=cy+tilt*(x-cx)+ry*.38*h
            ut=top+amount*(seam-top)
            lb=bottom+amount*(seam-bottom)
            upper.append((x,ut)); lower.append((x,lb))
            crease.append((x,ut-1.6*h))
            for iy in range(max(0,int((top-.5)*S)),min(H*S,int((bottom+.5)*S)+1)):
                y=iy/S
                if y<top-.35 or y>bottom+.35: continue
                if y<=ut or y>=lb:
                    # Warm skin shading and low-amplitude texture taken from the cheek.
                    sample=SRC.getpixel((int(34+x%10),int(72+y%6)))
                    texture=(sample[0]-172)*.055
                    shade=-15*(1-h)+2*math.sin((y-top)/(bottom-top+.01)*math.pi)
                    base=(173,105,72) if y<=ut else (166,96,65)
                    pixels[ix,iy]=tuple(max(0,min(255,round(v+shade+texture))) for v in base)
                    mp[ix,iy]=255
        d=ImageDraw.Draw(art)
        # Lid contours retain the original drawing's soft dark brown ink.
        stroke(d,upper,(76,43,29),1.05)
        if amount<.99: stroke(d,lower,(97,53,35),.65)
        stroke(d,crease,(140,79,51),.55)
        md=ImageDraw.Draw(mask)
        stroke(md,upper,255,1.5)
        if amount<.99: stroke(md,lower,255,1.0)
        stroke(md,crease,255,.9)
    art=art.filter(ImageFilter.GaussianBlur(.20*S)).resize((W,H),RESAMPLE)
    mask=mask.resize((W,H),RESAMPLE)
    # Remove filter ringing outside the eye rectangles.
    bound=Image.new('L',(W,H)); bd=ImageDraw.Draw(bound)
    bd.rectangle((50,42,72,62),fill=255); bd.rectangle((81,51,104,69),fill=255)
    mask=ImageChops.multiply(mask,bound)
    return composite(art,mask)

# Shared lip-only mask clears the old frown while preserving nose and face outlines.
MOUTH_PATH=[(48.5,86.4),(54.0,82.8),(62.7,82.2),(69.9,84.5),
            (76.0,85.2),(83.3,89.0),(85.0,95.5),
            (79.0,96.7),(70.0,98.2),(63.5,95.6),
            (57.0,93.7),(51.0,90.0),(48.5,86.4)]
mask_hi=Image.new('L',SIZE); polygon(ImageDraw.Draw(mask_hi),path(MOUTH_PATH),255)
MOUTH_MASK=mask_hi.resize((W,H),RESAMPLE)
# Finite support ensures strict and disjoint changed rectangles.
limit=Image.new('L',(W,H)); ImageDraw.Draw(limit).rectangle((47,82,86,99),fill=255)
MOUTH_MASK=ImageChops.multiply(MOUTH_MASK,limit)

def mouth(pose):
    if pose=='neutral': return SRC.copy()
    base=SRC.convert('RGB').copy(); pix=base.load()
    for y in range(82,100):
        for x in range(47,87):
            # Nearby unmarked skin supplies texture without copying facial contours.
            sample=SRC.getpixel((x,100+(y%3)))
            grain=(sample[0]-181)*.16
            tone=-2.0+(y-90)*.15
            pix[x,y]=tuple(round(v+grain+tone) for v in (179,107,73))
    art=base.resize(SIZE,Image.Resampling.BICUBIC); d=ImageDraw.Draw(art)
    if pose=='parted':
        outline=[(50,87.3),(57,84.3),(64,84.6),(69,86.9),(75,86.2),(80,88.2),(82,91.5),
                 (73,94.0),(62,92.7),(56,90.4),(53,89.1),(51,88.4),(50,87.3)]
        cavity=[(52.2,87.5),(59,85.9),(65,86.2),(69,87.9),(74,87.8),(78,88.7),(80.4,90.2),
                (72,91.2),(62,90.4),(57,89),(55,88.5),(53,88),(52.2,87.5)]
        tongue=[(60,90),(66,89.1),(73,90),(77,90.5)]
    elif pose=='ah':
        outline=[(50,87.5),(57,84.1),(64,84.3),(69,86.4),(77,85.9),(82,88.7),(82,92.4),
                 (78,98.0),(65,98.5),(58,93.6),(54,91.5),(51.7,89.4),(50,87.5)]
        cavity=[(52.6,87.9),(59,86.3),(64,86.0),(69,87.9),(75,87.6),(79.8,89.1),(80.2,92.1),
                (76.0,96.0),(65.8,96.2),(59.8,92.3),(56.5,90.9),(54,89.2),(52.6,87.9)]
        tongue=[(62.7,94),(68,92.5),(74,93.3),(77.5,94.1)]
    elif pose=='oo':
        outline=[(59.4,87.7),(61.3,84.2),(66.6,84.2),(69.7,86.8),(75.6,86.3),(78.9,90.7),(76.5,94.5),
                 (73.4,98.0),(65.0,96.7),(62.7,93.8),(60.6,91.6),(59.8,89.5),(59.4,87.7)]
        cavity=[(63.1,88.7),(64.7,86.8),(67.2,87.2),(69.4,88.4),(73.0,88.2),(75.4,90.6),(73.9,93),
                (71.5,95.4),(67.6,94.9),(65.9,92.6),(64.0,91.3),(63.3,89.8),(63.1,88.7)]
        tongue=[(67,93.4),(69,92.5),(71.5,93),(73,93.6)]
    else:  # ee, wide opening with an upper tooth plate and a narrow dark gap.
        outline=[(49.6,87.4),(56.1,84.6),(63.7,84.9),(69.1,87.0),(75.2,86.9),(82.4,89.4),(83,92.5),
                 (74.0,96.2),(63.7,94.7),(56.4,91.8),(53.2,90.2),(51,88.7),(49.6,87.4)]
        cavity=[(52,87.8),(59.0,86.4),(64.4,86.5),(69.2,88.1),(74.5,88.3),(79.9,89.6),(81.0,91.4),
                (72.6,93.7),(63.3,92.5),(57.5,90.7),(54.9,89.5),(53.1,88.6),(52,87.8)]
        tongue=None
    polygon(d,path(outline),(148,73,52))
    stroke(d,path(outline),(91,48,31),.8)
    polygon(d,path(cavity),(57,31,25))
    if tongue:
        curve=path(tongue)
        polygon(d,curve+[(curve[-1][0]-1,curve[-1][1]+1),(curve[0][0]+1,curve[0][1]+1)],(156,76,64))
        stroke(d,curve,(178,90,73),.45)
    if pose=='ee':
        teeth=path([(53.7,88),(60,86.9),(64.5,87.2),(69.2,88.8),(74,88.9),(77.5,89.5),(79.6,90.6),
                    (72.5,91.4),(64.5,90.5),(59,89.8),(56.8,89.1),(54.9,88.6),(53.7,88)])
        polygon(d,teeth,(211,186,149))
        stroke(d,path([(55,88.1),(63,87.6),(73,89),(78.4,90.2)]),(229,206,169),.45)
    # A small irregular lower-lip highlight matches the source's painted finish.
    if pose=='oo': highlight=[(65,94.7),(68,96),(72,96),(74,94.8)]
    elif pose=='ah': highlight=[(63,95.8),(67,97.1),(74,97.3),(77.8,95.3)]
    elif pose=='ee': highlight=[(60,92.2),(66,94.2),(74,94.9),(79,93.1)]
    else: highlight=[(60,91.2),(65,92.5),(72,93.2),(77.8,92)]
    stroke(d,path(highlight),(179,91,65),.75)
    art=art.filter(ImageFilter.GaussianBlur(.27*S)).resize((W,H),RESAMPLE)
    return composite(art,MOUTH_MASK)

def difference_bbox(im):
    return ImageChops.difference(im.convert('RGB'),SRC.convert('RGB')).getbbox()

clips=[]
blink_frames=[blink(v) for v in (0,.55,1,.78,0)]
talk_frames=[mouth(v) for v in ('neutral','parted','ah','oo','ee')]
for kind,label,frames in [('blink','Přirozené mrknutí',blink_frames),('talk','Mluvení – pět tvarů úst',talk_frames)]:
    folder=ROOT/kind; folder.mkdir(exist_ok=True)
    names=[]
    for i,im in enumerate(frames,1):
        name=f'{kind}/frame-{i:02}.png'; im.save(ROOT/name); names.append(name)
        assert im.size==SRC.size
        assert im.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
        bbox=difference_bbox(im)
        if bbox:
            if kind=='blink': assert bbox[1]>=42 and bbox[3]<=70
            else: assert bbox[1]>=82 and bbox[3]<=100
    clips.append(dict(kind=kind,label=label,fps=12,frames=names))
assert blink_frames[0].tobytes()==SRC.tobytes()==blink_frames[-1].tobytes()
assert len({im.tobytes() for im in talk_frames})==5
assert len({im.tobytes() for im in blink_frames})==4
# Every changed pixel must belong to the intended feature mask.
for group,allowed in [(blink_frames,None),(talk_frames,MOUTH_MASK)]:
    for im in group:
        for y in range(H):
            for x in range(W):
                if im.getpixel((x,y))!=SRC.getpixel((x,y)):
                    if allowed is not None: assert allowed.getpixel((x,y))>0
                    else: assert (50<=x<=72 and 42<=y<=62) or (81<=x<=104 and 51<=y<=69)
notes=('Lokální animace z původní kresby: mrknutí překrývá oči anatomickými víčky bez deformace zorniček; '
       'první i poslední snímek jsou přesnou kopií předlohy. Mluvení obsahuje původní neutrální ústa a čtyři '
       'odlišné tvary: pootevření, A, O/U a E/I se zuby. Oba klipy mají pět snímků při 12 fps. '
       'Rozměr 131 × 195, poloha, celé alfa a pixely mimo oční či ústní masky jsou zachovány. '
       'Obdélníky změn očí a úst se nepřekrývají. Omezení: skrytou kůži víček a vnitřek úst bylo nutné '
       'ručně dokreslit; nízké rozlišení omezuje jemnost detailů a řeč není synchronizovaná s konkrétním zvukem.')
(ROOT/'result.json').write_text(json.dumps(dict(notes=notes,scripts=['generate.py'],clips=clips),ensure_ascii=False,indent=2)+'\n')
# Review sheet: aligned sprites at 3x and face details at 5x.
ROW_H=H*3+345
sheet=Image.new('RGB',(5*W*3,2*ROW_H),(46,45,42)); dr=ImageDraw.Draw(sheet)
for row,frames in enumerate((blink_frames,talk_frames)):
    for i,im in enumerate(frames):
        x=i*W*3; y=row*ROW_H
        bg=Image.new('RGBA',im.size,(68,65,59,255)); bg.alpha_composite(im)
        sheet.paste(bg.convert('RGB').resize((W*3,H*3),Image.Resampling.NEAREST),(x,y+20))
        face=bg.crop((45,40,108,101)).resize((315,305),Image.Resampling.NEAREST)
        sheet.paste(face,(x+35,y+H*3+30))
        dr.text((x+8,y+5),f'{"BLINK" if row==0 else "TALK"} {i+1}',fill=(245,234,211))
sheet.save(ROOT/'contact-sheet.png')
print(json.dumps({k:[difference_bbox(im) for im in v] for k,v in [('blink',blink_frames),('talk',talk_frames)]}))
print('Verified: dimensions, alpha bytes, distinct poses, unchanged exterior pixels, disjoint feature rectangles.')

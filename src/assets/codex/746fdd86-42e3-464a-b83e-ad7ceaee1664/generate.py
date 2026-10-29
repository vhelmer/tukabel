"""Reproduce the two local, pixel-aligned sprite clips using Pillow only."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import json, math, hashlib

ROOT = Path(__file__).resolve().parent
SRC = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SRC.size
S = 6

def curve(start, *segments):
    pts = [start]
    a = start
    for b, c, d in segments:
        for i in range(1, 41):
            t = i / 40; u = 1 - t
            pts.append((u**3*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t**3*d[0],
                        u**3*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t**3*d[1]))
        a = d
    return pts

def polygon_mask(points):
    im=Image.new('L',(W*S,H*S))
    ImageDraw.Draw(im).polygon([(round(x*S),round(y*S)) for x,y in points],fill=255)
    return im.resize((W,H), Image.Resampling.LANCZOS)

def stroke(canvas, points, color, width):
    ImageDraw.Draw(canvas).line([(round(x*S),round(y*S)) for x,y in points],fill=color,width=round(width*S),joint='curve')

def fill(canvas, pts, color):
    ImageDraw.Draw(canvas).polygon([(round(x*S),round(y*S)) for x,y in pts],fill=color)

def composite_rgb(base, overlay, mask):
    out=Image.composite(overlay.convert('RGB'),base.convert('RGB'),mask).convert('RGBA')
    out.putalpha(SRC.getchannel('A'))
    return out

# Each aperture follows its actual outline, rather than scaling an eye rectangle.
EYES = [
    (((55.7,65.8),(63,59.0),(76.5,55.5),(83.6,56.9)),
     ((55.7,65.8),(55.8,80.0),(91.0,75.8),(83.6,56.9))),
    (((110.0,53.5),(115.0,46.1),(126,43.5),(132.8,43.8)),
     ((110.0,53.5),(110.0,64.2),(141.0,63.0),(132.8,43.8)))
]

def blink(amount):
    out=SRC.copy()
    for index, (upper, lower) in enumerate(EYES):
        up=curve(upper[0],upper[1:])
        lo=curve(lower[0],lower[1:])
        moving=[(a[0]*(1-amount)+b[0]*amount,a[1]*(1-amount)+b[1]*amount) for a,b in zip(up,lo)]
        # Slightly extend above the old ink edge to avoid a second upper contour.
        top=[(x,y-1.0*math.sin(math.pi*i/(len(up)-1))) for i,(x,y) in enumerate(up)]
        mask=polygon_mask(top+moving[::-1])
        # Warm lid skin retains fine grain sampled from the character's forehead.
        skin=Image.new('RGB',(W,H))
        p=skin.load(); src=SRC.load(); low=SRC.filter(ImageFilter.GaussianBlur(1.2)).load()
        for y in range(40,76):
            for x in range(51,138):
                sample=src[91+(x%9),36+(y%12)]
                blurred=low[91+(x%9),36+(y%12)]
                grain=max(-1.4,min(1.4,(sample[0]-blurred[0])*.10))
                depth=max(0,min(1,(y-(54 if index==0 else 43))/20))
                p[x,y]=(int(180+grain-3*depth),int(119+grain-3*depth),int(68+grain-2*depth))
        # Clip masks to a strict eye-only support; mouth begins below y=76.
        limit=Image.new('L',(W,H)); ImageDraw.Draw(limit).rectangle((53,42,137,74),fill=255)
        mask=ImageChops.multiply(mask,limit)
        out=composite_rgb(out,skin,mask)
        layer=out.convert('RGB').resize((W*S,H*S),Image.Resampling.BICUBIC)
        stroke(layer,moving,(43,32,20),1.25 if amount<.9 else 1.45)
        # Restrict antialiasing to a thin tube around the new lid margin.
        line_mask=Image.new('L',(W*S,H*S))
        ImageDraw.Draw(line_mask).line([(round(x*S),round(y*S)) for x,y in moving],fill=255,width=round(2.5*S),joint='curve')
        line_mask=ImageChops.multiply(line_mask.resize((W,H),Image.Resampling.LANCZOS),limit)
        out=composite_rgb(out,layer.resize((W,H),Image.Resampling.LANCZOS),line_mask)
    return out

# The upper-right corner is deliberately retained to separate the edit rectangles.
# Both original ink and replacement poses lie within this mouth-shaped support.
mouth_boundary=curve((64.5,83.0),
    ((66.0,79.2),(70.0,78.7),(74.0,80.0)),
    ((91,83.5),(115.0,76.6),(123.5,75.8)),
    ((132,75.0),(130,80),(123,84)),
    ((110,93.0),(83,96.0),(65,86.5)),
    ((64.5,85.5),(64.0,84.5),(64.5,83.0)))
MOUTH_MASK=polygon_mask(mouth_boundary)
# Explicit y=76 boundary with a 2-pixel blend into the retained corner.
for y in range(H):
    for x in range(W):
        v=MOUTH_MASK.getpixel((x,y))
        if y<76: v=0
        elif y==76: v=round(v*.18)
        elif y==77: v=round(v*.65)
        MOUTH_MASK.putpixel((x,y),v)

# Harmonic inpainting using only surrounding source skin; no external assets.
def skin_plate():
    area=(61,74,133,97)
    original=SRC.convert('RGB').crop(area)
    mask=MOUTH_MASK.crop(area)
    # Remove remaining dark ink by extending the fill mask over antialiased edges.
    binary=mask.point(lambda v:255 if v>0 else 0)
    patch=Image.composite(Image.new('RGB',original.size,(177,117,67)),original,binary)
    for _ in range(700):
        patch=Image.composite(patch.filter(ImageFilter.BoxBlur(1)),original,binary)
    # Restore subtle source-derived skin grain to the interpolated area.
    tex=SRC.convert('RGB').crop((77,93,94,102))
    smooth=tex.filter(ImageFilter.GaussianBlur(1.1))
    p=patch.load()
    for y in range(patch.height):
        for x in range(patch.width):
            if binary.getpixel((x,y)):
                a=tex.getpixel((x%tex.width,y%tex.height)); b=smooth.getpixel((x%tex.width,y%tex.height))
                c=p[x,y]; p[x,y]=tuple(max(0,min(255,round(c[k]+(a[k]-b[k])*.48))) for k in range(3))
    out=SRC.convert('RGB');out.paste(patch,area)
    return out
PLATE=skin_plate()

# Original asymmetric upper lip: retain the child's characteristic tilted smile.
TOP=curve((67.5,83.25),((87.0,87.0),(116.0,78.8),(134.3,67.0)))

def mouth_pose(kind):
    canvas=PLATE.resize((W*S,H*S),Image.Resampling.BICUBIC)
    if kind=='closed':
        bottom=curve((134.3,67),((118,81),(88,87.8),(67.5,83.25)))
    elif kind=='ee':
        bottom=curve((134.3,67),((122,82),(91,92),(67.5,83.25)))
    elif kind=='ah':
        bottom=curve((134.3,67),((127,85),(98,104),(67.5,83.25)))
    elif kind=='oh':
        # Rounded articulation concentrated in the central mouth; smile corner remains.
        bottom=curve((134.3,67),((130,72),(121,78),(113.7,82)),
                     ((116,89),(111,94),(104,94)),
                     ((97,94),(94,88),(97,83)),
                     ((88,86),(77,86),(67.5,83.25)))
    top=TOP
    if kind=='oh':
        top=curve((67.5,83.25),((80,85),(90,84.2),(96,82.6)),
                  ((99,78),(110,77.7),(113,81)),
                  ((121,77),(130,71),(134.3,67)))
    shape=top+bottom
    fill(canvas,shape,(27,19,14))
    # Mouth cavity shading avoids a flat black cutout.
    cavity=Image.new('RGB',(W,H))
    p=cavity.load()
    for y in range(75,97):
        for x in range(64,133):
            f=max(0,(y-81)/15)
            p[x,y]=(round(24+17*f),round(17+6*f),round(13+5*f))
    cavity_hi=cavity.resize((W*S,H*S),Image.Resampling.BICUBIC)
    sm=polygon_mask(shape).resize((W*S,H*S),Image.Resampling.BICUBIC)
    canvas=Image.composite(cavity_hi,canvas,sm)
    # Teeth are copied from the source, retaining their irregular hand-painted edges.
    if kind in ('ee','ah'):
        for box in [(79,83,88,90),(97,81,107,88),(115,76,123,83)]:
            tooth=SRC.crop(box).convert('RGB')
            # Only actual tooth-colored pixels are copied; skin/ink are excluded.
            tm=Image.new('L',tooth.size)
            for yy in range(tooth.height):
                for xx in range(tooth.width):
                    r,g,b=tooth.getpixel((xx,yy))
                    tm.putpixel((xx,yy),max(0,min(255,int(min(r-126,g-119,b-94)*13))))
            if kind=='ee':
                # A broad front-tooth exposure, without regularizing the broken teeth.
                tooth=tooth.resize((tooth.width,max(3,round(tooth.height*.68))),Image.Resampling.LANCZOS)
                tm=tm.resize(tooth.size,Image.Resampling.LANCZOS)
            canvas.paste(tooth.resize((tooth.width*S,tooth.height*S),Image.Resampling.BICUBIC),(box[0]*S,box[1]*S),tm.resize((tooth.width*S,tooth.height*S),Image.Resampling.BICUBIC))
    if kind=='ah':
        tongue=curve((94,91.2),((98,87.6),(108,88),(114,89.7)),((110,93.1),(101,95.0),(94,91.2)))
        fill(canvas,tongue,(126,59,44))
        stroke(canvas,curve((98,91.3),((102,89.9),(108,89.8),(111,90.2))),(157,78,55),.65)
    if kind=='oh':
        fill(canvas,curve((97.5,91.5),((102,89),(108,89.1),(111,90.9)),((108,93.5),(102,94.1),(97.5,91.5))),(119,56,41))
    stroke(canvas,top,(35,25,16),1.0)
    stroke(canvas,bottom,(47,31,19),1.0)
    # A restrained warm lower-lip edge follows each articulation.
    if kind in ('ah','oh'):
        lip=curve((88,92.3),((96,97.2),(109,94.8),(115,90.7))) if kind=='ah' else curve((96,94.1),((101,96.0),(109,94.8),(112,92.5)))
        stroke(canvas,lip,(140,86,46),.65)
    return composite_rgb(SRC,canvas.resize((W,H),Image.Resampling.LANCZOS),MOUTH_MASK)

def main():
    blink_frames=[SRC.copy(),blink(.52),blink(1.0),blink(.32),SRC.copy()]
    talk_frames=[SRC.copy(),mouth_pose('closed'),mouth_pose('ee'),mouth_pose('ah'),mouth_pose('oh')]
    clips=[]
    all_frames=[]
    for kind,label,frames in [('blink','Přirozené mrknutí',blink_frames),('talk','Řeč – klid, sevření, široké E, A, O',talk_frames)]:
        paths=[]
        for i,im in enumerate(frames,1):
            name=f'{kind}-{i:02d}.png';im.save(ROOT/name); paths.append(name)
        clips.append(dict(kind=kind,label=label,fps=12,frames=paths))
        all_frames.append(frames)
    notes=('Dva zarovnané klipy po pěti snímcích, 12 fps. Mrknutí má původní první i poslední snímek; víčka překrývají oči bez deformace hlavy. '
           'Řeč obsahuje původní neutrální úsměv a čtyři různé artikulace. Kvůli vzájemně odděleným obdélníkům změn zůstává vysoko zvednutý pravý koutek původní; '
           'artikulace probíhá ve střední a dolní části úst. Alfa i všechny pixely mimo vymezené oči a ústa zůstávají přesně zachovány. '
           'Použit pouze lokální Pillow a původní kresba; chybějící pokožka pod ústy je lokálně interpolována.')
    (ROOT/'result.json').write_text(json.dumps(dict(notes=notes,scripts=['generate.py'],clips=clips),ensure_ascii=False,indent=2)+'\n')
    # Contact sheet: full-canvas alignment above, enlarged face details below.
    sheet=Image.new('RGB',(5*W,2*(H+28)+2*180),(229,220,200))
    draw=ImageDraw.Draw(sheet)
    for row,frames in enumerate(all_frames):
        for i,im in enumerate(frames):
            x=i*W; y=row*(H+28)
            sheet.paste(im.convert('RGB'),(x,y+24))
            draw.text((x+7,y+5),f'{"BLINK" if row==0 else "TALK"} {i+1}',fill=(36,31,25))
            face=im.crop((49,38,143,98)).convert('RGB').resize((W,130),Image.Resampling.NEAREST)
            sheet.paste(face,(x,2*(H+28)+row*180+22))
    sheet.save(ROOT/'contact-sheet.png')
    # Byte-level invariants and actual changed rectangles, including antialiasing.
    source_bytes=SRC.tobytes()
    report={}
    for clip,frames in zip(clips,all_frames):
        union=Image.new('L',(W,H)); bounds=[]
        for im in frames:
            assert im.size==(204,316) and im.mode=='RGBA'
            assert im.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
            dif=ImageChops.difference(im.convert('RGB'),SRC.convert('RGB'))
            channels=dif.split(); changed=ImageChops.lighter(ImageChops.lighter(channels[0],channels[1]),channels[2]).point(lambda x:255 if x else 0)
            bounds.append(changed.getbbox());union=ImageChops.lighter(union,changed)
        report[clip['kind']]=dict(changed_bbox=union.getbbox(),frame_bounds=bounds,unique_frames=len({im.tobytes() for im in frames}))
    assert blink_frames[0].tobytes()==source_bytes==blink_frames[-1].tobytes()
    assert report['blink']['unique_frames']==4
    assert report['talk']['unique_frames']==5
    a=report['blink']['changed_bbox'];b=report['talk']['changed_bbox']
    assert a[2]<=b[0] or b[2]<=a[0] or a[3]<=b[1] or b[3]<=a[1],(a,b)
    report['checks']='PASS: dimensions, RGBA alpha, source blink endpoints, unique poses, disjoint changed rectangles'
    (ROOT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()

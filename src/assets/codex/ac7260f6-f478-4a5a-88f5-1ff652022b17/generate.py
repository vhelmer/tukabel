#!/usr/bin/env python3
"""Local, deterministic sprite retouching. Requires only Pillow.

Source pixels are never resampled. Supersampling is confined to painted masks;
source alpha is restored verbatim after each composite.
"""
from pathlib import Path
import json, hashlib, math
from PIL import Image, ImageDraw, ImageChops, ImageFont

ROOT = Path(__file__).resolve().parent
SRC = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SRC.size
S = 8


def curve(start, *segments):
    out = [start]
    p = start
    for c1, c2, end in segments:
        for i in range(1, 33):
            t = i / 32
            u = 1 - t
            out.append((u*u*u*p[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*end[0],
                        u*u*u*p[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*end[1]))
        p = end
    return out


def poly(draw, points, color):
    draw.polygon([(round(x*S), round(y*S)) for x,y in points], fill=color)


def stroke(draw, points, color, width):
    draw.line([(round(x*S), round(y*S)) for x,y in points], fill=color,
              width=round(width*S), joint='curve')


def composite(overlay, allowed):
    layer = overlay.resize((W,H), Image.Resampling.LANCZOS)
    alpha = layer.getchannel('A')
    alpha = ImageChops.multiply(alpha, allowed)
    layer.putalpha(alpha)
    out = Image.alpha_composite(SRC, layer)
    out.putalpha(SRC.getchannel('A'))
    return out


def blink(amount):
    if amount == 0:
        return SRC.copy()
    # Left and right canthi stay fixed. Each upper eyelid rotates over the
    # eyeball; the pupil/white is occluded, never scaled or translated.
    eyes = [
        ((122.4,56.2), (137.6,51.7), (126.6,52.7), (133.4,50.6),
         (126.6,60.0), (134.9,59.5), (145,85,53)),
        ((150.0,49.4), (163.4,50.5), (153.8,48.3), (160.0,48.5),
         (153.8,53.7), (160.4,56.5), (144,83,49)),
    ]
    overlay = Image.new('RGBA', (W*S,H*S))
    allowed = Image.new('L', (W,H))
    ad = ImageDraw.Draw(allowed)
    d = ImageDraw.Draw(overlay)
    for index, (a,b,c1,c2,z1,z2,skin) in enumerate(eyes):
        lerp = lambda u,v: (u[0]+(v[0]-u[0])*amount, u[1]+(v[1]-u[1])*amount)
        moving = curve(a,(lerp(c1,z1),lerp(c2,z2),b))
        # This higher contour includes the old upper lash, avoiding a second
        # stationary lash line when the lid closes.
        top = curve((a[0]-.7,a[1]-.8),
                    ((c1[0],c1[1]-1.35),(c2[0],c2[1]-1.35),(b[0]+.5,b[1]-.55)))
        patch = Image.new('L',(W*S,H*S))
        pd = ImageDraw.Draw(patch)
        poly(pd, top + list(reversed(moving)), 255)
        patch = patch.resize((W,H),Image.Resampling.LANCZOS)
        # Lids borrow fine color variation from nearby original lid skin.
        texture = Image.new('RGBA',(W,H))
        for y in range(45,63):
            for x in range(120,166):
                if patch.getpixel((x,y)):
                    sx = min(max(x,123 if index == 0 else 150),136 if index == 0 else 161)
                    sy = 47 if index == 0 else 45
                    r,g,bl,_ = SRC.getpixel((sx,sy))
                    shade = .65 + .35*min(1,max(0,(y-47)/12))
                    col = tuple(round(skin[k]*.84+[r,g,bl][k]*.16-2*shade) for k in range(3))
                    texture.putpixel((x,y),col+(patch.getpixel((x,y)),))
        # Paste at high resolution without touching the source canvas itself.
        overlay.alpha_composite(texture.resize((W*S,H*S),Image.Resampling.NEAREST))
        d = ImageDraw.Draw(overlay)
        stroke(d,moving,(55,31,22,255),.82)
        if amount > .9:
            # A soft warm crease and a short outer lash match the ink drawing.
            crease=[(x,y+.8) for x,y in moving[7:25]]
            stroke(d,crease,(109,60,36,140),.45)
        if index == 0:
            ad.rectangle((120,49,140,62),fill=255)
        else:
            ad.rectangle((148,47,165,57),fill=255)
    return composite(overlay,allowed)


# Mouth perimeter follows the underside of the moustache. The maximum mask
# stops above the goatee and never approaches either eye region.
MOUTH = curve((139.2,82.8),
              ((142.1,80.6),(146.0,78.5),(150.2,78.1)),
              ((151.2,78.2),(152.4,77.1),(154.6,76.5)),
              ((157.1,78.1),(162.7,76.8),(165.9,78.0)),
              ((168.0,79.6),(165.1,83.5),(160.6,84.3)),
              ((152.6,85.1),(144.0,87.1),(139.2,82.8)))
mask_hi=Image.new('L',(W*S,H*S))
poly(ImageDraw.Draw(mask_hi),MOUTH,255)
MOUTH_MASK=mask_hi.resize((W,H),Image.Resampling.LANCZOS)
# Trim resampling's distant fringes to the anatomical editable region.
for yy in range(H):
    for xx in range(W):
        if not (138 <= xx <= 168 and 75 <= yy <= 86):
            MOUTH_MASK.putpixel((xx,yy),0)


def talk(pose):
    if pose == 'neutral':
        return SRC.copy()
    over=Image.new('RGBA',(W*S,H*S))
    d=ImageDraw.Draw(over)
    # Local warm lip/skin plate, shaded to blend into the existing lower lip.
    # Keep original skin and lip texture wherever it is already suitable.
    # Only old dark mouth/bright tooth pixels need a reconstructed skin plate.
    plate=Image.new('RGBA',(W,H))
    for yy in range(75,87):
        for xx in range(138,169):
            a=MOUTH_MASK.getpixel((xx,yy))
            if not a:
                continue
            r,g,b,_=SRC.getpixel((xx,yy))
            if 82 < r < 182 and g < 112 and r > 1.48*g and b < 88:
                col=(r,g,b)
            else:
                cr,cg,cb,_=SRC.getpixel((128+(xx-138)%9,75+(yy-75)%10))
                col=tuple(round(base*.86+c*.14) for base,c in zip((133,73,46),(cr,cg,cb)))
            plate.putpixel((xx,yy),col+(a,))
    over.alpha_composite(plate.resize((W*S,H*S),Image.Resampling.NEAREST))
    d=ImageDraw.Draw(over)
    skin_shadow=curve((139.3,83.2),((146,83),(156,80),(165.8,78.4)))
    stroke(d,skin_shadow,(148,82,49,150),1.2)
    if pose in ('E','A'):
        top=curve((139.8,82.7),
                  ((144,80.0),(148.1,78.9),(151.6,78.4)),
                  ((153.0,77.5),(154.2,77.0),(155.1,77.2)),
                  ((157.4,78.5),(163.0,77.7),(165.4,78.5)))
        if pose == 'E':
            bottom=curve(top[-1],((163,81.0),(150.8,84.3),(139.8,82.7)))
        else:
            bottom=curve(top[-1],((166.7,82.2),(157.5,85.8),(149.6,85.4)),
                         ((145.1,86),(141.7,84.0),(139.8,82.7)))
        poly(d,top+bottom,(44,23,20,255))
        stroke(d,top+bottom,(55,28,21,255),.7)
        # Upper teeth are one shaded ivory strip, following the tilted mouth.
        teeth_top=curve((141.2,82.1),((146.4,79.5),(151.0,78.7),(154.6,77.5)),
                        ((157.4,78.6),(162,78.2),(164.4,78.7)))
        depth=1.35 if pose == 'E' else .95
        teeth_bottom=[(x,y+depth*(math.sin(math.pi*i/(len(teeth_top)-1))**.55))
                      for i,(x,y) in enumerate(teeth_top)]
        poly(d,teeth_top+list(reversed(teeth_bottom)),(205,171,129,255))
        stroke(d,teeth_top,(227,192,147,255),.48)
        if pose == 'A':
            tongue=curve((148.1,84.2),((152.2,82.7),(157.5,82.7),(161,83.2)))
            stroke(d,tongue,(119,57,44,255),1.1)
        lower=bottom[8:-4]
        stroke(d,[(x,y+.58) for x,y in lower],(164,92,55,255),.85)
    elif pose == 'O':
        # Rounded opening sits below the moustache; asymmetric perspective.
        opening=curve((153.3,78.7),((156.0,77.6),(160.4,77.6),(161.4,79.1)),
                      ((163.4,81.1),(159.4,84.5),(156.3,84.6)),
                      ((152.4,85.0),(150.4,81.4),(153.3,78.7)))
        stroke(d,opening,(174,101,60,255),1.65)
        poly(d,opening,(45,24,21,255))
        stroke(d,opening,(76,38,27,255),.55)
        tongue=curve((154.1,83.0),((155.8,82.0),(158.4,81.9),(159.5,82.6)))
        stroke(d,tongue,(116,58,43,255),.8)
        lower=curve((153.8,85.1),((156.8,85.5),(160.5,83.8),(161.4,82.5)))
        stroke(d,lower,(167,94,56,255),.8)
    elif pose == 'M':
        # Pressed lips: no teeth, a soft continuous seam beneath the moustache.
        seam=curve((140.2,82.9),((145.1,80.8),(149.4,81.5),(153.2,80.0)),
                   ((157.3,80.1),(161.8,78.5),(165.6,79.0)))
        stroke(d,seam,(68,34,24,255),.95)
        lip=curve((142.9,83.3),((151.0,83.5),(160.8,80.1),(164,80.2)))
        stroke(d,lip,(166,95,58,255),.95)
    return composite(over,MOUTH_MASK)


def changed_box(im):
    diff=ImageChops.difference(im,SRC)
    return ImageChops.lighter(ImageChops.lighter(diff.getchannel('R'),diff.getchannel('G')),diff.getchannel('B')).getbbox()


def save_clip(kind, frames):
    names=[]
    for i,im in enumerate(frames,1):
        name=f'{kind}-{i:02d}.png'
        im.save(ROOT/name)
        names.append(name)
    return {'kind':kind,'label':'Přirozené mrknutí' if kind=='blink' else 'Mluvení – pět tvarů úst','fps':12,'frames':names}


def main():
    assert SRC.size == (409,405)
    blink_frames=[blink(t) for t in (0,.52,1,.72,0)]
    talk_frames=[talk(p) for p in ('neutral','E','A','O','M')]
    clips=[save_clip('blink',blink_frames),save_clip('talk',talk_frames)]
    # Fresh byte comparisons for all delivered frames, not visual assumptions.
    assert blink_frames[0].tobytes()==SRC.tobytes()==blink_frames[-1].tobytes()
    assert len({im.tobytes() for im in blink_frames})==4
    assert len({im.tobytes() for im in talk_frames})==5
    boxes=[]
    for frames in (blink_frames,talk_frames):
        union=None
        for im in frames:
            assert im.size==SRC.size and im.mode=='RGBA'
            assert im.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
            box=changed_box(im)
            if box:
                union=box if union is None else (min(union[0],box[0]),min(union[1],box[1]),max(union[2],box[2]),max(union[3],box[3]))
        boxes.append(union)
    assert boxes[0][3] <= boxes[1][1], boxes
    for kind,frames,box in zip(('blink','talk'),(blink_frames,talk_frames),boxes):
        for im in frames:
            for y in range(H):
                for x in range(W):
                    if not (box[0]<=x<box[2] and box[1]<=y<box[3]):
                        assert im.getpixel((x,y))==SRC.getpixel((x,y))
        print(kind,'changed rectangle',box,'unique poses',len({f.tobytes() for f in frames}))
    # Both original-scale full-canvas views and enlarged face views for review.
    sheet=Image.new('RGB',(5*330,2*370),(33,29,26))
    sd=ImageDraw.Draw(sheet)
    for row,frames in enumerate((blink_frames,talk_frames)):
        for col,im in enumerate(frames):
            x,y=col*330,row*370
            thumb=im.resize((245,243),Image.Resampling.LANCZOS)
            sheet.paste(thumb,(x+42,y+22),thumb)
            face=im.crop((116,43,172,94)).resize((112,102),Image.Resampling.NEAREST)
            sheet.paste(face,(x+109,y+267),face)
            sd.text((x+8,y+5),f'{"blink" if row==0 else "talk"} {col+1}',fill=(235,220,192))
    sheet.save(ROOT/'contact-sheet.png')
    notes=('Dva zarovnané klipy po pěti snímcích při 12 fps. Mrknutí používá anatomická víčka bez deformace očí; první a poslední snímek jsou pixelově shodné se zdrojem. Mluvení obsahuje původní neutrální ústa a čtyři odlišné tvary E, A, O a sevřené M. Knír a malá velikost kresby omezují rozsah otevření úst. Oči a ústa mají nepřekrývající se oblasti změn. Všechny původní hodnoty alfa a všechny RGBA pixely mimo upravené oblasti jsou zachovány. Přiložen kontaktní přehled; vše reprodukuje lokální skript generate.py z source.png.')
    (ROOT/'result.json').write_text(json.dumps({'notes':notes,'scripts':['generate.py'],'clips':clips},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Validated: dimensions, RGBA, alpha, exact blink endpoints, distinct poses, disjoint regions, unchanged exterior.')

if __name__=='__main__':
    main()

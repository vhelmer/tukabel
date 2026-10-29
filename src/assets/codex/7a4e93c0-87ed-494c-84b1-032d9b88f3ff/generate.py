"""Rebuild the two local, aligned animation clips from source.png (Pillow only)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import json
import math

ROOT = Path(__file__).resolve().parent
SOURCE = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SOURCE.size
S = 8


def bezier(points, steps=48):
    a, b, c, d = points
    return [tuple((1-t)**3*a[j] + 3*(1-t)**2*t*b[j] +
                  3*(1-t)*t*t*c[j] + t**3*d[j] for j in (0, 1))
            for t in (i/steps for i in range(steps+1))]


def path(start, *curves):
    out = [start]
    for b, c, end in curves:
        out.extend(bezier((out[-1], b, c, end))[1:])
    return out


def poly_mask(points):
    im = Image.new('L', (W*S, H*S))
    ImageDraw.Draw(im).polygon([(round(x*S), round(y*S)) for x, y in points], fill=255)
    return im.resize((W, H), Image.Resampling.LANCZOS)


def bounded(mask, rect):
    limit = Image.new('L', (W, H))
    ImageDraw.Draw(limit).rectangle((rect[0], rect[1], rect[2]-1, rect[3]-1), fill=255)
    return ImageChops.multiply(mask, limit)


def harmonic_plate(mask):
    """Interpolate local skin through ink/teeth, retaining boundary skin colors.

    Work only in the tiny selected feature; no dependencies or external input.
    Original source grain is sampled from adjacent unmarked cheek skin.
    """
    box = mask.getbbox()
    x0, y0, x1, y1 = box
    # Include antialiased edge pixels in the interpolation domain.
    active = {(x, y) for y in range(y0, y1) for x in range(x0, x1)
              if mask.getpixel((x, y)) > 3}
    rgb = SOURCE.convert('RGB')
    boundary = []
    for x, y in active:
        for p in ((x-1,y), (x+1,y), (x,y-1), (x,y+1)):
            if p not in active:
                boundary.append(rgb.getpixel(p))
    mean = tuple(sum(p[c] for p in boundary)/len(boundary) for c in range(3))
    values = {p: list(mean) for p in active}
    ordered = sorted(active, key=lambda p: (p[1], p[0]))
    neighbors = {p: [(p[0]-1,p[1]), (p[0]+1,p[1]),
                     (p[0],p[1]-1), (p[0],p[1]+1)] for p in active}
    fixed = {p: tuple(float(c) for c in rgb.getpixel(p))
             for ns in neighbors.values() for p in ns if p not in active}
    for iteration in range(650):
        delta = 0.0
        for p in ordered:
            ns = [values[q] if q in active else fixed[q] for q in neighbors[p]]
            new = [sum(q[c] for q in ns)*0.25 for c in range(3)]
            delta = max(delta, max(abs(new[c]-values[p][c]) for c in range(3)))
            values[p] = new
        if delta < 0.008:
            break
    result = rgb.copy()
    donor = SOURCE.convert('RGB').filter(ImageFilter.GaussianBlur(0.7))
    for (x,y), col in values.items():
        # Small, deterministic paper grain from the clean cheek, not white noise.
        dx, dy = 54+(x % 13), 86+(y % 4)
        original, smooth = rgb.getpixel((dx,dy)), donor.getpixel((dx,dy))
        grain = max(-2.5, min(2.5, sum(original[c]-smooth[c] for c in range(3))/3))*0.45
        result.putpixel((x,y), tuple(max(0,min(255,round(v+grain))) for v in col))
    return result


def draw_line(draw, points, color, width):
    pts = [(round(x*S), round(y*S)) for x, y in points]
    draw.line(pts, fill=color, width=round(width*S), joint='curve')
    radius = width*S/2
    for x,y in (pts[0], pts[-1]):
        draw.ellipse((x-radius,y-radius,x+radius,y+radius), fill=color)


LEFT_MASK = bounded(poly_mask(path((41.1,49.0),
    ((47.5,47.8),(64.5,48.2),(71.5,50.6)),
    ((74.3,54.1),(71.1,62.0),(66.3,63.7)),
    ((58.8,67.3),(43.0,63.7),(40.8,56.0)),
    ((40.0,53.8),(40.0,51.3),(41.1,49.0)))), (39,48,74,66))
RIGHT_MASK = bounded(poly_mask(path((85.3,53.0),
    ((91.7,51.3),(103.5,51.3),(108.9,52.1)),
    ((111.7,58.2),(108.8,65.0),(103.5,67.0)),
    ((96.2,69.4),(86.4,65.6),(84.1,60.0)),
    ((82.4,56.8),(83.4,54.5),(85.3,53.0)))), (82,51,111,68))
EYE_MASK = ImageChops.lighter(LEFT_MASK, RIGHT_MASK)
EYE_SKIN = harmonic_plate(EYE_MASK)


def blink(amount):
    if amount == 0:
        return SOURCE.copy()
    hi = EYE_SKIN.resize((W*S,H*S), Image.Resampling.BICUBIC).convert('RGBA')
    original = SOURCE.resize((W*S,H*S), Image.Resampling.BICUBIC)
    d = ImageDraw.Draw(hi)
    eyes = [
        # Each lid is a cubic. The upper lid travels over a stationary eyeball.
        ([(42.0,51.0),(49.0,49.2),(64.0,49.3),(70.7,52.1)],
         [(42.0,52.0),(42.8,64.5),(65.2,67.0),(70.7,53.0)],
         [(42.1,56.5),(48.1,62.5),(63.9,64.6),(70.7,56.7)]),
        ([(85.4,55.4),(91.0,53.4),(102.1,53.0),(108.4,54.5)],
         [(85.4,56.0),(85.4,67.6),(104.1,71.3),(108.4,55.5)],
         [(85.4,60.0),(91.0,66.5),(103.2,67.2),(108.4,59.4)]),
    ]
    for upper0, lower0, closed in eyes:
        upper = [tuple(a[j]*(1-amount)+b[j]*amount for j in (0,1))
                 for a,b in zip(upper0, closed)]
        lower = [tuple(a[j]*(1-amount)+b[j]*amount for j in (0,1))
                 for a,b in zip(lower0, closed)]
        up, low = bezier(upper), bezier(lower)
        if amount < 0.999:
            aperture = Image.new('L',hi.size)
            ImageDraw.Draw(aperture).polygon([(round(x*S),round(y*S)) for x,y in up+low[::-1]],fill=255)
            hi.paste(original,(0,0),aperture)
            d=ImageDraw.Draw(hi)
            draw_line(d,low,(51,30,19,255),0.85)
        # Soft warm under-edge and an irregular, original-weight ink eyelid.
        draw_line(d,[(x,y+0.45) for x,y in up],(108,63,36,255),1.8)
        draw_line(d,up,(30,21,14,255),1.25)
    painted = hi.resize((W,H),Image.Resampling.LANCZOS).convert('RGB')
    out = Image.composite(painted,SOURCE.convert('RGB'),EYE_MASK).convert('RGBA')
    out.putalpha(SOURCE.getchannel('A'))
    return out


MOUTH_MASK = bounded(poly_mask(path((44.8,67.9),
    ((49.9,65.9),(53.9,73.5),(62.0,73.4)),
    ((71.2,70.7),(87.2,72.0),(97.3,76.5)),
    ((101.0,78.4),(94.6,82.0),(85.6,83.1)),
    ((77.4,84.3),(61.9,82.0),(54.0,77.3)),
    ((48.2,73.9),(44.2,71.7),(44.8,67.9)))), (43,68,101,84))
# The nose ends just above the upper lip: protect it even from interpolation.
ImageDraw.Draw(MOUTH_MASK).rectangle((72,63,91,72),fill=0)
MOUTH_SKIN = harmonic_plate(MOUTH_MASK)


def talk(pose):
    if pose == 'neutral':
        return SOURCE.copy()
    hi = MOUTH_SKIN.resize((W*S,H*S),Image.Resampling.BICUBIC).convert('RGBA')
    d=ImageDraw.Draw(hi)
    if pose == 'ee':
        upper=path((48.5,71.3),((59.3,77.6),(80.5,81.4),(94.8,78.9)))
        lower=path((48.5,71.3),((59.0,82.7),(79.4,86.1),(94.8,78.9)))
    elif pose == 'ah':
        upper=path((50.4,72.7),((63.0,75.2),(80.6,76.3),(92.8,78.0)))
        lower=path((50.4,72.7),((62.9,83.8),(79.2,87.0),(92.8,78.0)))
    elif pose == 'oh':
        upper=path((68.8,77.1),((70.0,72.2),(81.0,73.8),(82.9,78.4)))
        lower=path((68.8,77.1),((65.9,83.9),(80.9,87.0),(82.9,78.4)))
    else:
        upper=path((50.0,72.7),((59.7,78.9),(77.8,82.3),(92.3,79.3)))
        # Pressed lips are a distinct, closed consonant pose.
        draw_line(d,[(x,y+0.7) for x,y in upper],(131,73,43,255),1.7)
        draw_line(d,upper,(46,29,19,255),0.95)
        draw_line(d,path((68.7,81.6),((73.2,82.5),(77.7,82.7),(81.3,82.2))),
                  (168,101,62,255),0.6)
    if pose != 'mm':
        contour=upper+lower[::-1]
        d.polygon([(round(x*S),round(y*S)) for x,y in contour],fill=(49,28,21,255))
        # Everything inside the mouth is clipped to its own aperture.
        inside=Image.new('L',hi.size)
        ImageDraw.Draw(inside).polygon([(round(x*S),round(y*S)) for x,y in contour],fill=255)
        details=hi.copy();dd=ImageDraw.Draw(details)
        if pose in ('ee','ah'):
            teeth_bottom=[(x,y+(1.15 if pose=='ee' else 1.45)) for x,y in upper]
            dd.polygon([(round(x*S),round(y*S)) for x,y in upper+teeth_bottom[::-1]],
                       fill=(208,197,166,255))
            draw_line(dd,[(x,y+0.35) for x,y in upper],(233,220,188,255),0.6)
            for x in (59.0,65.8,72.5,78.7,84.0):
                # Fine uneven tooth separators follow the smile slope.
                pt=min(upper,key=lambda p:abs(p[0]-x))
                draw_line(dd,[(pt[0],pt[1]+0.25),(pt[0]-0.05,pt[1]+1.4)],
                          (113,89,61,255),0.32)
            tongue=path((62.8,81.8 if pose=='ah' else 80.1),
                        ((68.5,80.1),(78.5,82.0),(83.1,83.1)))
            draw_line(dd,tongue,(149,80,64,255),2.6 if pose=='ah' else 1.2)
        else:
            draw_line(dd,path((70.2,82.1),((73.0,81.1),(78.5,82.7),(79.8,83.3))),
                      (143,74,58,255),2.0)
        hi.paste(details,(0,0),inside)
        d=ImageDraw.Draw(hi)
        draw_line(d,lower,(48,28,18,255),0.85)
        draw_line(d,upper,(34,23,15,255),1.0)
        if pose=='oh':
            draw_line(d,path((69.7,82.5),((73.4,84.4),(79.0,84.2),(81.7,81.3))),
                      (144,82,48,255),0.55)
    if pose != 'oh':
        # Small smile-corner creases retain the character's asymmetry.
        x,y=upper[0]
        draw_line(d,path((x-0.9,y+0.7),((x-0.4,y-1.0),(x+0.6,y-1.1),(x+1.2,y-0.8))),
                  (64,36,22,255),0.65)
    painted=hi.resize((W,H),Image.Resampling.LANCZOS).convert('RGB')
    out=Image.composite(painted,SOURCE.convert('RGB'),MOUTH_MASK).convert('RGBA')
    out.putalpha(SOURCE.getchannel('A'))
    return out


def difference_box(im):
    return ImageChops.difference(im.convert('RGB'),SOURCE.convert('RGB')).getbbox()


def validate(clips):
    assert SOURCE.size == (133,353)
    changed={}
    for kind,frames in clips.items():
        assert len(frames)==5
        assert len({im.tobytes() for im in frames}) == (3 if kind=='blink' else 5)
        mask = EYE_MASK if kind=='blink' else MOUTH_MASK
        union=Image.new('L',(W,H))
        for im in frames:
            assert im.size == SOURCE.size and im.mode=='RGBA'
            assert im.getchannel('A').tobytes()==SOURCE.getchannel('A').tobytes()
            if kind=='talk':
                assert im.crop((72,63,92,73)).tobytes()==SOURCE.crop((72,63,92,73)).tobytes()
            diff=ImageChops.difference(im.convert('RGB'),SOURCE.convert('RGB'))
            pixels=diff.load()
            for y in range(H):
                for x in range(W):
                    if mask.getpixel((x,y))==0:
                        assert im.getpixel((x,y))==SOURCE.getpixel((x,y))
                    if pixels[x,y] != (0,0,0):
                        union.putpixel((x,y),255)
        changed[kind]=union.getbbox()
    assert clips['blink'][0].tobytes()==SOURCE.tobytes()
    assert clips['blink'][-1].tobytes()==SOURCE.tobytes()
    a,b=changed['blink'],changed['talk']
    assert a[3] <= b[1] or b[3] <= a[1] or a[2]<=b[0] or b[2]<=a[0]
    print('Verified: 10 full-canvas RGBA PNGs; alpha unchanged; exact source endpoints;')
    print('blink has 3 unique poses and talk has 5; changed rectangles:',changed)


def contact_sheet(clips):
    # Both full-canvas alignment and a magnified face are available for review.
    sheet=Image.new('RGB',(5*266,2*550),(226,217,198))
    d=ImageDraw.Draw(sheet)
    for row,(kind,frames) in enumerate(clips.items()):
        for i,im in enumerate(frames):
            x,y=i*266,row*550
            d.text((x+8,y+5),f'{kind} {i+1}',fill=(34,28,22))
            base=Image.new('RGBA',im.size,(226,217,198,255))
            base.alpha_composite(im)
            sheet.paste(base.convert('RGB'),(x+5,y+27))
            crop=base.crop((37,43,112,89)).resize((225,138),Image.Resampling.NEAREST)
            sheet.paste(crop,(x+20,y+399))
    sheet.save(ROOT/'contact-sheet.png')


def main():
    clips={'blink':[blink(t) for t in (0,0.58,1.0,0.58,0)],
           'talk':[talk(p) for p in ('neutral','ee','ah','oh','mm')]}
    validate(clips)
    entries=[]
    for kind,frames in clips.items():
        folder=ROOT/kind
        folder.mkdir(exist_ok=True)
        names=[]
        for i,im in enumerate(frames,1):
            name=f'{kind}/frame-{i:02d}.png'
            if im.tobytes()==SOURCE.tobytes():
                (ROOT/name).write_bytes((ROOT/'source.png').read_bytes())
            else:
                im.save(ROOT/name)
            names.append(name)
        entries.append({'kind':kind,'label':'Přirozené mrknutí' if kind=='blink' else 'Mluvení – pět tvarů úst',
                        'fps':12,'frames':names})
    contact_sheet(clips)
    result={'notes':'Dva zarovnané klipy po pěti snímcích, 12 fps, původní rozměr 133 × 353. '
             'Mrknutí tvoří původní pohled, přivření, zavření, otevření a původní pohled. '
             'Mluvení obsahuje původní úsměv a odlišné tvary E, A, O a sevřených rtů M. '
             'Úpravy očí a úst mají nepřekrývající se obdélníky; všechny pixely mimo masky '
             'a celý původní alfa kanál jsou zachovány. Kresba vznikla pouze lokálně pomocí Pillow. '
             'Při malém rozlišení předlohy jsou detaily rtů a víček omezeny jednotlivými pixely.',
            'scripts':['generate.py'],'clips':entries}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    main()

#!/usr/bin/env python3
"""Local, deterministic sprite editing. Requires only Python and Pillow.

All final RGBA pixels start from source.png. Supersampled paint is composited
only through separate anatomical eye and mouth masks; alpha is always restored
from the source. No external files or services are used.
"""
from pathlib import Path
import hashlib
import json
import math
from PIL import Image, ImageDraw, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent
S = 6
SRC = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SRC.size
assert (W, H) == (375, 382)
ALPHA = SRC.getchannel('A')


def bezier(a, b, c, d, n=40):
    return [((1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0],
             (1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1])
            for t in [i/n for i in range(n+1)]]


def polygon_mask(points):
    m = Image.new('L', (W*S, H*S))
    ImageDraw.Draw(m).polygon([(round(x*S), round(y*S)) for x,y in points], fill=255)
    return m.resize((W,H), Image.Resampling.LANCZOS)


def line_overlay(points, color, width):
    p = Image.new('RGBA', (W*S,H*S))
    d = ImageDraw.Draw(p)
    d.line([(round(x*S), round(y*S)) for x,y in points], fill=color,
           width=round(width*S), joint='curve')
    return p.resize((W,H), Image.Resampling.LANCZOS)


def apply(im, layer, mask=None):
    """Paint RGB, leaving every source alpha byte unconditionally intact."""
    a = layer.getchannel('A')
    if mask is not None:
        a = ImageChops.multiply(a, mask)
    out = Image.composite(layer, im, a)
    out.putalpha(ALPHA)
    return out


def texture_mask(im, mask, color_at):
    layer = Image.new('RGBA', (W,H))
    p = layer.load()
    bb = mask.getbbox()
    if bb:
        for y in range(bb[1],bb[3]):
            for x in range(bb[0],bb[2]):
                noise = (((x*43+y*79+x*y*7)%29)-14)*0.19
                c = color_at(x,y)
                p[x,y] = tuple(max(0,min(255,round(v+noise))) for v in c)+(255,)
    return apply(im, layer, mask)


# Eye apertures track the original individual contours, below the eyebrows.
EYES = [(133.35,148.55,65.15,60.0,70.15,0),
        (159.5,173.0,66.25,59.6,71.55,1)]
EYE_MASK = Image.new('L',(W,H))
for a,b,y,top,bottom,side in EYES:
    top_curve = bezier((a,y),(a+2.0,top-0.5),(b-3.0,top-1.0),(b,y))
    low_curve = bezier((b,y),(b-1,bottom+0.6),(a+2,bottom+0.1),(a,y))
    EYE_MASK = ImageChops.lighter(EYE_MASK,polygon_mask(top_curve+low_curve))
# Cut off tiny resampling tails to give the edit region an exact support.
EYE_MASK = EYE_MASK.point(lambda a: 0 if a<3 else a)


def blink(amount):
    out = SRC.copy()
    for a,b,y,top,bottom,side in EYES:
        upper = bezier((a,y),(a+2,top-0.5),(b-3,top-1),(b,y))
        lower = list(reversed(bezier((b,y),(b-1,bottom+0.6),(a+2,bottom+0.1),(a,y))))
        seam = bezier((a,y),(a+3,y+3.1),(b-3,y+3.0),(b,y))
        u = [(p[0],p[1]*(1-amount)+q[1]*amount) for p,q in zip(upper,seam)]
        l = [(p[0],p[1]*(1-amount)+q[1]*amount) for p,q in zip(lower,seam)]
        um = ImageChops.multiply(polygon_mask(upper+list(reversed(u))),EYE_MASK)
        lm = ImageChops.multiply(polygon_mask(lower+list(reversed(l))),EYE_MASK)
        def lid_color(x,yy):
            shade = -abs(x-(a+b)/2)*1.3 + (yy-top)*0.8
            base = (152,91,59) if side==0 else (139,85,59)
            return tuple(v+shade for v in base)
        out=texture_mask(out,um,lid_color)
        out=texture_mask(out,lm,lambda x,yy: (151-2.1*(x-a),88-1.1*(x-a),56-.55*(x-a)))
        # A moving upper eyelid, rather than scaling the eyeball or iris.
        out=apply(out,line_overlay(u,(38,23,17,255),1.0),EYE_MASK)
        if amount<0.99:
            out=apply(out,line_overlay(l,(69,39,25,240),0.65),EYE_MASK)
        # Fine warm crease follows the lid, under the stationary brow.
        crease=[(x,yy-1.2) for x,yy in u[5:-5]]
        out=apply(out,line_overlay(crease,(107,62,39,115),0.45),um)
    return out


# The upper edge follows the lip below the nose. The mask includes the old
# cavity and lower lip, but excludes the nose, cheek contours and chin.
MOUTH_POINTS = (bezier((135.8,87.6),(144,90.2),(159,89.6),(171.2,87.1))+
                bezier((171.2,87.1),(170,93.3),(165.4,100.2),(155,101.4))+
                bezier((155,101.4),(145,102),(137.5,98.3),(135.8,87.6)))
MOUTH_MASK = polygon_mask(MOUTH_POINTS).point(lambda a:0 if a<3 else a)


def mouth_skin():
    def color(x,y):
        # Match the original warm light on the left and cooler shadow at right.
        u=max(0,min(1,(x-137)/35))
        bump=3*math.sin((y-88)*.55)
        return (158-37*u+bump,90-21*u+bump*.6,58-13*u+bump*.4)
    return texture_mask(SRC,MOUTH_MASK,color)


def cavity_paths(left,right,top,bottom,corner):
    upper=bezier((left,corner),(left+3,top-0.5),(right-4,top-0.8),(right,corner-.5))
    lower=bezier((right,corner-.5),(right-3,bottom+1),(left+3,bottom),(left,corner))
    return upper,lower


def mouth(pose):
    out=mouth_skin()
    if pose=='A':
        left,right,top,bottom,corner=138.4,169.2,90.3,100.0,91.0
    elif pose=='E':
        left,right,top,bottom,corner=137.6,170.1,91.1,96.5,91.6
    elif pose=='O':
        left,right,top,bottom,corner=147.1,163.2,89.4,100.7,94.0
    elif pose=='M':
        # Closed bilabial consonant, still retaining his asymmetric smile.
        seam=bezier((138.6,92.3),(147.0,95.0),(158.5,95.0),(168.8,90.8))
        low=[(x,y+1.5*math.sin(math.pi*i/(len(seam)-1))) for i,(x,y) in enumerate(seam)]
        out=apply(out,line_overlay(low,(176,103,66,255),1.3),MOUTH_MASK)
        out=apply(out,line_overlay(seam,(51,28,18,255),1.15),MOUTH_MASK)
        highlight=[(x,y+1) for x,y in low[9:32]]
        return apply(out,line_overlay(highlight,(187,111,69,170),.6),MOUTH_MASK)
    upper,lower=cavity_paths(left,right,top,bottom,corner)
    cavity=ImageChops.multiply(polygon_mask(upper+lower),MOUTH_MASK)
    out=texture_mask(out,cavity,lambda x,y:(24+(y-top)*.85,13+(y-top)*.22,10+(y-top)*.23))
    # The source's crooked gold teeth are sampled unchanged in color. A change
    # in lip opening reveals/occludes teeth instead of inventing white dentures.
    if pose in ('A','E'):
        teeth=SRC.crop((143,91,165,95))
        layer=Image.new('RGBA',(W,H))
        ty=91 if pose=='A' else 92
        layer.paste(teeth,(143,ty))
        out=apply(out,layer,cavity)
        if pose=='A':
            tongue=bezier((148,98.6),(151,97.0),(158,97.6),(161.7,99.4))
            tongue+=bezier((161.7,99.4),(157,100.5),(151,100.3),(148,98.6))
            tm=ImageChops.multiply(polygon_mask(tongue),cavity)
            out=texture_mask(out,tm,lambda x,y:(101,43,30))
            teeth_low=SRC.crop((146,96,161,98))
            layer=Image.new('RGBA',(W,H)); layer.paste(teeth_low,(146,99))
            out=apply(out,layer,cavity)
    else:
        # A narrow opening reveals the same two upper gold incisors.
        layer=Image.new('RGBA',(W,H))
        layer.paste(SRC.crop((152,91,159,94)),(151,90))
        out=apply(out,layer,cavity)
    # Dark ink on the inner upper lip and a warm lower lip in the source style.
    out=apply(out,line_overlay(upper,(44,24,16,255),.85),MOUTH_MASK)
    out=apply(out,line_overlay(lower,(79,39,24,255),.75),MOUTH_MASK)
    lip=[(x,y+.9) for x,y in lower[4:-4]]
    out=apply(out,line_overlay(lip,(177,99,62,230),.8),MOUTH_MASK)
    return out


def diff_bbox(im):
    channels=ImageChops.difference(SRC,im).split()
    m=ImageChops.lighter(channels[0],ImageChops.lighter(channels[1],channels[2]))
    m=ImageChops.lighter(m,channels[3])
    return m.getbbox(),m


def main():
    blink_frames=[SRC.copy(),blink(.48),blink(1.0),blink(.70),SRC.copy()]
    talk_frames=[SRC.copy()]+[mouth(p) for p in ('A','E','O','M')]
    clips=[]
    report={}
    masks={'blink':EYE_MASK,'talk':MOUTH_MASK}
    for kind,frames,label in [('blink',blink_frames,'Přirozené mrknutí'),
                              ('talk',talk_frames,'Mluvení – klid, A, E, O, M')]:
        paths=[]; boxes=[]; counts=[]
        for i,im in enumerate(frames,1):
            assert im.size==SRC.size
            assert im.getchannel('A').tobytes()==ALPHA.tobytes(), 'Source alpha changed'
            bbox,diff=diff_bbox(im)
            outside=ImageChops.multiply(diff,masks[kind].point(lambda v:0 if v else 255))
            assert outside.getbbox() is None, 'Pixel changed outside anatomical edit mask'
            # Alpha-aware RGBA equality is checked directly, not with getbbox().
            name=f'{kind}-{i:02}.png'
            im.save(ROOT/name)
            assert Image.open(ROOT/name).convert('RGBA').tobytes()==im.tobytes()
            paths.append(name); boxes.append(bbox)
            counts.append(sum(v!=0 for v in diff.getdata()))
        unique=len({im.tobytes() for im in frames})
        assert unique==(4 if kind=='blink' else 5)
        clips.append(dict(kind=kind,label=label,fps=12,frames=paths))
        report[kind]=dict(changed_bounds=boxes,changed_pixels=counts,distinct_frames=unique)
    assert blink_frames[0].tobytes()==SRC.tobytes()==blink_frames[-1].tobytes()
    eye_bounds=EYE_MASK.getbbox(); mouth_bounds=MOUTH_MASK.getbbox()
    assert eye_bounds[3]<=mouth_bounds[1], 'Overlapping facial edit rectangles'
    request=json.loads((ROOT/'request.json').read_text())
    for region in request.get('protectedRegions',[]):
        if isinstance(region,dict):
            box=(int(region['x']),int(region['y']),int(region['x']+region['width']),int(region['y']+region['height']))
            for frame in blink_frames+talk_frames:
                assert frame.crop(box).tobytes()==SRC.crop(box).tobytes()
    result={'notes':'Dvě animace po pěti snímcích při 12 fps. Mrknutí pohybuje horními a dolními víčky; první a poslední snímek jsou přesně původní. Mluvení obsahuje pět odlišných poloh: původní klidový úšklebek, A, E, O a zavřené M. Zachovány zlaté zuby, plátno 375 × 382, poloha i všechny původní hodnoty alfa. Změny očí a úst mají oddělené nepřekrývající se obdélníky; všechny RGBA bajty mimo příslušné masky jsou zachovány. Náhled: contact-sheet.png. Omezení: při původním rozlišení jsou jemné pohyby víček a rtů omezené velikostí několika pixelů.',
            'scripts':['generate.py'],'clips':clips}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    report['edit_rectangles']={'blink':eye_bounds,'talk':mouth_bounds}
    report['alpha_preserved']=True
    report['outside_pixels_preserved']=True
    (ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    # Full sprites at native size, followed by enlarged face crops, in order.
    sheet=Image.new('RGB',(5*W,2*(H+220)),(37,39,44))
    draw=ImageDraw.Draw(sheet)
    names=[['Rest','Closing','Closed','Opening','Rest'],['Neutral','A','E','O','M']]
    for row,frames in enumerate([blink_frames,talk_frames]):
        yy=row*(H+220)
        for i,im in enumerate(frames):
            bg=Image.new('RGBA',im.size,(37,39,44,255)); bg.alpha_composite(im)
            sheet.paste(bg.convert('RGB'),(i*W,yy+20))
            face=bg.crop((126,53,178,106)).resize((208,212),Image.Resampling.NEAREST)
            sheet.paste(face,(i*W+84,yy+H+6))
            draw.text((i*W+8,yy+5),f'{"BLINK" if row==0 else "TALK"} {i+1}: {names[row][i]}',fill='white')
    sheet.save(ROOT/'contact-sheet.png')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    main()

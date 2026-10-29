#!/usr/bin/env python3
"""Reproducible, local Pillow animation retouching of source.png.

Only the eyelids or the lips are touched. All compositing is performed against
an immutable RGBA source and its alpha channel is restored byte for byte.
No network, external assets, font downloads, or non-Pillow dependencies.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math
import json
import hashlib
import shutil

ROOT = Path(__file__).resolve().parent
SOURCE = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SOURCE.size
assert (W, H) == (443, 542)
ALPHA = SOURCE.getchannel('A')
RGB = SOURCE.convert('RGB')
SCALE = 6

def sample(x, y):
    """Bilinear sampling in the original drawing, in original coordinates."""
    x = min(W-1.001, max(0.0, x))
    y = min(H-1.001, max(0.0, y))
    ix, iy = int(x), int(y)
    fx, fy = x-ix, y-iy
    a, b = RGB.getpixel((ix, iy)), RGB.getpixel((ix+1, iy))
    c, d = RGB.getpixel((ix, iy+1)), RGB.getpixel((ix+1, iy+1))
    return tuple(round((a[k]*(1-fx)+b[k]*fx)*(1-fy) +
                       (c[k]*(1-fx)+d[k]*fx)*fy) for k in range(3))

def interp(points, x):
    """Monotone cubic interpolation avoids angular native-pixel contours."""
    if x <= points[0][0]: return points[0][1]
    if x >= points[-1][0]: return points[-1][1]
    for i in range(len(points)-1):
        x0, y0 = points[i]
        x1, y1 = points[i+1]
        if x0 <= x <= x1:
            t = (x-x0)/(x1-x0)
            m0 = ((y1-points[i-1][1])/(x1-points[i-1][0])
                  if i else (y1-y0)/(x1-x0))
            m1 = ((points[i+2][1]-y0)/(points[i+2][0]-x0)
                  if i+2<len(points) else (y1-y0)/(x1-x0))
            # Clamp tangents so that eyelids don't overshoot near a canthus.
            if y1 == y0:
                m0=m1=0
            else:
                sec = (y1-y0)/(x1-x0)
                m0 = 0 if m0*sec < 0 else math.copysign(min(abs(m0),3*abs(sec)),sec)
                m1 = 0 if m1*sec < 0 else math.copysign(min(abs(m1),3*abs(sec)),sec)
            return ((2*t**3-3*t*t+1)*y0 + (t**3-2*t*t+t)*m0*(x1-x0)
                    +(-2*t**3+3*t*t)*y1+(t**3-t*t)*m1*(x1-x0))

def smooth(a,b,t):
    t = max(0., min(1., (t-a)/(b-a)))
    return t*t*(3-2*t)


def paste_rgb(frame, patch, mask, box):
    """Outside a nonzero mask no RGBA byte is changed."""
    frame.paste(patch, box[:2], mask)
    frame.putalpha(ALPHA)


def eyelid(frame, eye, closure):
    top, bottom, donor_y = eye
    left, right = top[0][0], top[-1][0]
    box = (math.floor(left)-2, math.floor(min(y for _,y in top))-2,
           math.ceil(right)+2, math.ceil(max(y for _,y in bottom))+3)
    bx, by, ex, ey = box
    sw, sh = (ex-bx)*SCALE, (ey-by)*SCALE
    patch = Image.new('RGB', (sw, sh))
    pixels = patch.load()
    for j in range(sh):
        y=by+(j+.5)/SCALE
        for i in range(sw):
            x=bx+(i+.5)/SCALE
            t=interp(top,x); b=interp(bottom,x)
            # Skin sampled above the original eye, never a scaled eyeball.
            depth=max(0., min(1., (y-t)/max(.1,b-t)))
            col=sample(x,donor_y + .8*depth)
            # The upper eyelid is rounded and receives a warm, modest shadow.
            shade=1.025-.055*depth
            grain=1 + .007*math.sin(x*7.91+y*4.63)
            pixels[i,j]=tuple(max(0,min(255,round(v*shade*grain))) for v in col)
    mask=Image.new('L',(sw,sh),0)
    dm=ImageDraw.Draw(mask)
    xs=[left+(right-left)*i/100 for i in range(101)]
    def edge(x):
        t,b=interp(top,x),interp(bottom,x)
        return t+(b-t)*closure
    points=[((x-bx)*SCALE,(interp(top,x)-by-.52)*SCALE) for x in xs]
    points += [((x-bx)*SCALE,(edge(x)-by)*SCALE) for x in reversed(xs)]
    dm.polygon(points,fill=255)
    # Original upper lash edge is covered by skin. The moving edge keeps the
    # same brown/black ink, thickness and curved outer corners as the source.
    ink=ImageDraw.Draw(patch)
    line=[((x-bx)*SCALE,(edge(x)-by)*SCALE) for x in xs]
    ink.line(line,fill=(57,31,19),width=round(.95*SCALE),joint='curve')
    dm.line(line,fill=255,width=round(1.05*SCALE),joint='curve')
    # Preserve lateral canthi instead of smearing their outlines.
    feather=mask.filter(ImageFilter.GaussianBlur(.18*SCALE))
    patch=patch.resize((ex-bx,ey-by),Image.Resampling.LANCZOS)
    feather=feather.resize(patch.size,Image.Resampling.LANCZOS)
    paste_rgb(frame,patch,feather,box)


NEAR_EYE=(
    [(165.9,89.5),(171,88.8),(179,88.85),(186,89.3),(190.6,90.1)],
    [(165.9,89.5),(169,94.5),(176,97.1),(183,97.3),(188,95.0),(190.6,90.1)],
    86.1)
FAR_EYE=(
    [(207.15,92.0),(211.1,91.25),(216.9,91.2),(221.6,92.2)],
    [(207.15,92.0),(209.8,96.2),(215.3,98.15),(219.2,96.8),(221.6,92.2)],
    88.45)


def blink(closure):
    frame=SOURCE.copy()
    if closure:
        eyelid(frame,NEAR_EYE,closure)
        eyelid(frame,FAR_EYE,closure)
    return frame


SEAM=[(174.8,139.6),(180.4,135.5),(185.6,133.65),(191.5,132.5),
      (197.6,132.45),(203,133.4),(208.2,132.1),(212.0,134.0)]
MOUTH_BOX=(173,128,215,153)


def mouth(pose):
    if pose == 'neutral': return SOURCE.copy()
    frame=SOURCE.copy()
    bx,by,ex,ey=MOUTH_BOX
    sw,sh=(ex-bx)*SCALE,(ey-by)*SCALE
    patch=Image.new('RGB',(sw,sh))
    pixels=patch.load()
    mask=Image.new('L',(sw,sh),0)
    mp=mask.load()
    # Left mouth corner and the cigarette corner stay fixed. Lip opening is
    # a change of articulation and does not move the chin, nose or jaw.
    if pose=='ee': left,right,height=176.0,211.4,2.65
    elif pose=='ah': left,right,height=175.5,211.4,6.25
    elif pose=='oh': left,right,height=188.0,208.4,7.0
    else: left,right,height=175.0,211.4,0.0
    def aperture(x):
        if not left<x<right: return 0.
        return height*math.sin(math.pi*(x-left)/(right-left))**.85
    def top_at(x):
        # Only the centre of the lip lifts; its ends remain pinned.
        a=aperture(x)
        return interp(SEAM,x)-.075*a
    def low_at(x): return top_at(x)+aperture(x)
    for j in range(sh):
        y=by+(j+.5)/SCALE-.5
        for i in range(sw):
            x=bx+(i+.5)/SCALE-.5
            seam=interp(SEAM,x)
            a=aperture(x)
            top,bottom=top_at(x),low_at(x)
            sy=y
            sx=x
            if pose=='mm':
                # Gentle compression of the two lips for a closed M/B/P pose.
                wx=math.exp(-((x-196.5)/13.)**4)
                local=math.exp(-((y-136.0)/6.8)**4)
                sx=x+(x-197)*.12*wx*local
                delta=(1.35*math.exp(-((y-132.7)/2.4)**2)
                       -1.20*math.exp(-((y-141.0)/2.9)**2))*wx
                sy=y-delta
            elif y<top:
                # Upper lip movement fades to zero before the base of the nose.
                sy=y + .075*a*smooth(128.,seam,y)
            elif y>=bottom:
                # Transport the source lower lip and its painted texture.
                # A smooth inverse map returns to the source before the chin.
                anchor=152.
                if y<anchor:
                    u=(y-bottom)/max(1.,anchor-bottom)
                    sy=seam+(anchor-seam)*u
            else:
                sy=seam
            col=sample(sx,sy)
            if a>.05 and top<=y<bottom and pose!='mm':
                depth=(y-top)/a
                # Warm shadow inside the mouth matches the drawing's ink.
                noise=1.5*math.sin(x*8.1+y*9.7)
                col=(round(48+17*depth+noise),round(24+5*depth+noise/2),round(17+3*depth))
            pixels[i,j]=col
            # Feather only around the outer retouch boundary. Zero elsewhere
            # means exact preservation rather than recompression of a crop.
            fx=smooth(173.4,175.4,x)*(1-smooth(211.5,213.5,x))
            fy=smooth(seam-2.7,seam-.7,y)*(1-smooth(149.0,151.8,y))
            strength=fx*fy
            if pose!='mm' and a==0: strength=0.
            # Cigarette is a hard protected island, including its dark outline.
            if x>=209.4 and y<=138.9: strength=0.
            mp[i,j]=round(255*strength)
    draw=ImageDraw.Draw(patch)
    def path_xy(coords): return [((x-bx+.5)*SCALE-.5,(y-by+.5)*SCALE-.5) for x,y in coords]
    xs=[left+(right-left)*k/120 for k in range(121)]
    if pose!='mm':
        # Thin irregular upper teeth, shaded ivory instead of paper white.
        if pose in ('ee','ah'):
            toothleft=181.4 if pose=='ee' else 184.0
            toothright=207.5 if pose=='ee' else 205.5
            txs=[toothleft+(toothright-toothleft)*k/100 for k in range(101)]
            band=1.60 if pose=='ee' else 1.85
            tooth_top=[(x,top_at(x)+.50) for x in txs]
            tooth_bottom=[(x,top_at(x)+min(aperture(x)*.70,band+(.06*math.sin(x*1.6)))) for x in reversed(txs)]
            draw.polygon(path_xy(tooth_top+tooth_bottom),fill=(188,163,120))
            shine=[(x,top_at(x)+.65) for x in txs[5:-6]]
            draw.line(path_xy(shine),fill=(210,186,145),width=round(.35*SCALE))
        if pose=='ah':
            # A subdued tongue is visible behind the lower lip, not on top.
            txs=[183.2+(205.5-183.2)*k/70 for k in range(71)]
            tongue=[(x,low_at(x)-.55-1.0*math.sin(math.pi*(x-183.2)/(205.5-183.2))) for x in txs]
            tongue += [(x,low_at(x)-.23) for x in reversed(txs)]
            draw.polygon(path_xy(tongue),fill=(116,57,39))
        # Delicate bottom edge; the original lower lip is transported below it.
        lower=[(x,low_at(x)) for x in xs]
        draw.line(path_xy(lower),fill=(56,29,19),width=round(.65*SCALE),joint='curve')
        # Preserve the asymmetrical upper lip, echoing its original ink colour.
        upper=[(x,top_at(x)) for x in xs]
        draw.line(path_xy(upper),fill=(43,25,16),width=round(.55*SCALE),joint='curve')
    patch=patch.resize((ex-bx,ey-by),Image.Resampling.LANCZOS)
    mask=mask.resize(patch.size,Image.Resampling.LANCZOS)
    # Keep all pixels of the cigarette, including antialiased contact edges.
    hard=ImageDraw.Draw(mask)
    hard.rectangle((210-bx,0,ex-bx,139-by),fill=0)
    hard.rectangle((212-bx,0,ex-bx,142-by),fill=0)
    paste_rgb(frame,patch,mask,MOUTH_BOX)
    return frame


def diff_bbox(im):
    # ImageChops.getbbox on RGBA can ignore RGB-only deltas when alpha is equal.
    # Compare all four channels explicitly instead.
    changed=[]
    for y in range(H):
        for x in range(W):
            if im.getpixel((x,y)) != SOURCE.getpixel((x,y)):
                changed.append((x,y))
    if not changed: return None,0
    return (min(x for x,y in changed),min(y for x,y in changed),
            max(x for x,y in changed)+1,max(y for x,y in changed)+1),len(changed)


def verify(clips):
    record={}
    ranges={}
    for clip in clips:
        kind=clip['kind']; boxes=[]; hashes=[]; pixels=[]
        for file in clip['frames']:
            im=Image.open(ROOT/file).convert('RGBA')
            assert im.size==SOURCE.size
            assert im.getchannel('A').tobytes()==ALPHA.tobytes(),file+' alpha changed'
            box,count=diff_bbox(im)
            hashes.append(hashlib.sha256(im.tobytes()).hexdigest())
            boxes.append(box);pixels.append(count)
            # Explicit per-kind permitted rectangles; includes only eyelids/lips.
            allowed=([(163,87,194,101),(205,89,225,102)] if kind=='blink'
                     else [MOUTH_BOX])
            if box:
                for y in range(H):
                    for x in range(W):
                        if im.getpixel((x,y))!=SOURCE.getpixel((x,y)):
                            assert any(a<=x<c and b<=y<d for a,b,c,d in allowed), (file,x,y)
        assert clip['fps']==12 and len(clip['frames'])==5
        assert len(set(hashes))==(4 if kind=='blink' else 5)
        assert Image.open(ROOT/clip['frames'][0]).tobytes()==SOURCE.tobytes()
        if kind=='blink':
            assert Image.open(ROOT/clip['frames'][-1]).tobytes()==SOURCE.tobytes()
        nonempty=[b for b in boxes if b]
        ranges[kind]=(min(b[0] for b in nonempty),min(b[1] for b in nonempty),
                      max(b[2] for b in nonempty),max(b[3] for b in nonempty))
        record[kind]={'changed_bounds':boxes,'changed_pixels':pixels,'distinct_frames':len(set(hashes))}
    a,b=ranges['blink'],ranges['talk']
    assert a[2]<=b[0] or b[2]<=a[0] or a[3]<=b[1] or b[3]<=a[1], 'Overlapping face clips'
    request=json.loads((ROOT/'request.json').read_text())
    for rect in request.get('protectedRegions',[]):
        if isinstance(rect,dict):
            region=(rect['x'],rect['y'],rect['x']+rect['width'],rect['y']+rect['height'])
        else: region=tuple(rect)
        for clip in clips:
            for file in clip['frames']:
                assert Image.open(ROOT/file).crop(region).tobytes()==SOURCE.crop(region).tobytes()
    record['union_bounds']=ranges
    record['alpha_preserved']=True
    record['bounds_disjoint']=True
    record['size']=[W,H]
    (ROOT/'verification.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record,indent=2))


def contact_sheet(clips):
    # Inspectable native canvas strip plus an enlarged face contact sheet.
    cellw,cellh=240,290
    sheet=Image.new('RGB',(cellw*5,cellh*2),(35,30,27))
    d=ImageDraw.Draw(sheet)
    for row,clip in enumerate(clips):
        for i,file in enumerate(clip['frames']):
            im=Image.open(ROOT/file).convert('RGBA')
            crop=im.crop((155,77,230,159)).resize((225,246),Image.Resampling.NEAREST)
            sheet.paste(crop,(i*cellw+7,row*cellh+25),crop)
            d.text((i*cellw+10,row*cellh+7),f"{clip['kind']} {i+1:02d}",fill=(235,221,200))
    sheet.save(ROOT/'contact-sheet.png')
    full=Image.new('RGB',(W*5,H*2+42),(35,30,27))
    for row,clip in enumerate(clips):
        for i,file in enumerate(clip['frames']):
            im=Image.open(ROOT/file)
            full.paste(im,(W*i,(H+21)*row+21),im)
    full.save(ROOT/'contact-sheet-full.png')


def main():
    clips=[]
    for kind,label,images in [
        ('blink','Přirozené mrknutí',[blink(t) for t in (0,.58,1.,.32,0)]),
        ('talk','Mluvení – klid, E, A, O, M',[mouth(p) for p in ('neutral','ee','ah','oh','mm')])
    ]:
        files=[]
        for i,im in enumerate(images,1):
            file=f'{kind}-{i:02d}.png'
            if im.tobytes()==SOURCE.tobytes():
                shutil.copyfile(ROOT/'source.png',ROOT/file)
            else:
                im.save(ROOT/file)
            files.append(file)
        clips.append({'kind':kind,'label':label,'fps':12,'frames':files})
    result={
        'notes':'Dva zarovnané klipy po pěti snímcích při 12 fps. Mrknutí postupně překrývá oči anatomickými víčky; první a poslední snímek přesně odpovídají zdroji. Mluvení obsahuje pět různých poloh: klid, E, A, O a sevřené M. Koutek s cigaretou zůstává ukotvený, proto jsou pohyby rtů mírně asymetrické a otevření omezené. Rozlišení 443 × 542, původní alfa i veškeré pixely mimo lokální oblasti očí a úst jsou zachovány. Obdélníky změn obou klipů se nepřekrývají. Vytvořeno lokálně pomocí Pillow.',
        'scripts':['generate.py'],'clips':clips}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    contact_sheet(clips)
    verify(clips)

if __name__=='__main__': main()

#!/usr/bin/env python3
"""Local, deterministic articulated scratch animation; Pillow + stdlib only."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import json
import math
import shutil

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source.png'
W, H = 386, 613

# The raised arm is separated along the existing transparent gap. The last
# edge lies across the shoulder, where displacement is tapered exactly to zero.
ARM = [(235,13),(241,5),(251,0),(271,0),(284,4),(296,18),
       (308,35),(327,47),(348,61),(367,79),(380,99),(385,115),
       (382,129),(369,144),(349,164),(328,182),(301,199),
       (295,176),(286,152),(283,139),(286,121),(310,109),
       (302,95),(294,76),(283,62),(270,61),(260,54),
       (254,45),(251,38),(245,32),(239,27),(235,22)]

# Stationary scalp contact, independently articulated finger joints, palm,
# wrist, elbow, and fixed shoulder. Displacements are in original pixels.
# tuple: x, y, main_dx, main_dy, finger_dx, finger_dy
HANDLES = [
 (234,12,0,0,0,0),(237,20,0,0,0,0),
 (242,28,0,0,0,0),(249,37,0,0,0,0),
 (254,45,0,0,0,0),
 (249,8,.4,2.2,-.2,.8),(262,5,1.2,3.4,.1,.5),
 (277,9,1.8,4.0,.4,.4),(289,23,2.5,3.8,.3,.5),
 (250,18,.1,1.7,-.8,1.3),(257,28,.7,2.5,-.9,1.8),
 (265,37,1.2,2.7,-.8,1.3),(274,47,1.6,2.7,-.3,.6),
 (289,56,2.8,3.2,0,0),(308,54,2.8,3.0,0,0),
 (332,74,1.8,2.1,0,0),(352,92,.5,1.4,0,0),
 (375,114,-1.3,1.0,0,0),(315,110,.6,1.2,0,0),
 (348,151,-.6,.7,0,0),(298,153,0,0,0,0),
 (323,177,0,0,0,0),(300,195,0,0,0,0),
]


def phi(x,y):
    r2 = (x*x+y*y)/10000.0
    return r2*math.log(r2) if r2 > 1e-15 else 0.0


def solve(a,b):
    """Small pivoted dense linear solve, without numpy or installed packages."""
    rows=[list(row)+[value] for row,value in zip(a,b)]
    n=len(rows)
    for col in range(n):
        pivot=max(range(col,n),key=lambda r:abs(rows[r][col]))
        rows[col],rows[pivot]=rows[pivot],rows[col]
        value=rows[col][col]
        if abs(value)<1e-13:
            raise ValueError('Degenerate joint controls')
        rows[col]=[v/value for v in rows[col]]
        for row in range(n):
            if row==col: continue
            scale=rows[row][col]
            if scale:
                rows[row]=[v-scale*u for v,u in zip(rows[row],rows[col])]
    return [row[-1] for row in rows]


def inverse_field(amount,curl):
    pts=[]; bx=[]; by=[]
    for x,y,dx,dy,fx,fy in HANDLES:
        vx=amount*dx+curl*fx; vy=amount*dy+curl*fy
        pts.append((x+vx,y+vy)); bx.append(-vx); by.append(-vy)
    n=len(pts)
    matrix=[]
    for x,y in pts:
        matrix.append([phi(x-u,y-v) for u,v in pts]+[1,x/100,y/100])
    matrix += [[1]*n+[0,0,0], [x/100 for x,y in pts]+[0,0,0],
               [y/100 for x,y in pts]+[0,0,0]]
    cx=solve(matrix,bx+[0,0,0]); cy=solve(matrix,by+[0,0,0])
    return pts,cx,cy


def main():
    im=Image.open(SOURCE).convert('RGBA')
    assert im.size==(W,H)
    request=json.loads((ROOT/'request.json').read_text())
    regions=request.get('protectedRegions',request.get('context',{}).get('protectedRegions',[]))
    arm=Image.new('L',im.size); ImageDraw.Draw(arm).polygon(ARM,fill=255)
    # Exact source-byte protection for the head and both independently animated
    # facial areas. These are also used in validation below.
    head=Image.new('L',im.size)
    ImageDraw.Draw(head).polygon([(0,0),(232,0),(232,14),(237,22),
        (243,29),(249,37),(252,44),(254,49),(255,61),(270,65),
        (281,74),(284,91),(284,106),(290,121),(287,144),
        (276,163),(259,184),(0,206)],fill=255)
    protect=ImageDraw.Draw(head)
    for region in regions:
        if isinstance(region,dict):
            x=region.get('x',0); y=region.get('y',0)
            rw=region.get('width',region.get('w',0)); rh=region.get('height',region.get('h',0))
            protect.rectangle((x,y,x+rw-1,y+rh-1),fill=255)
    ip=im.load(); ap=arm.load(); hp=head.load()
    interior=im.getchannel('A').filter(ImageFilter.MinFilter(17)).load()
    # Strip only the moving limb; keep every original RGB byte under alpha zero.
    base=im.copy(); bp=base.load()
    for y in range(128):
        for x in range(232,W):
            if ap[x,y] and not hp[x,y] and ip[x,y][3]:
                r,g,b,a=ip[x,y]; bp[x,y]=(r,g,b,0)

    # One action with preparation, two finger strokes, relaxation, exact rest.
    timeline=[(0,0),(.20,.08),(.57,.35),(.94,.92),(.68,.18),
              (.39,-.12),(.78,.66),(1.0,1.0),(.73,.25),
              (.43,.03),(.14,0),(0,0)]
    frames=[]
    edited_union=Image.new('L',im.size)
    ep=edited_union.load()
    for index,(amount,curl) in enumerate(timeline,1):
        name=f'frame-{index:02d}.png'; path=ROOT/name
        if index in (1,12):
            shutil.copyfile(SOURCE,path)
            frame=im.copy()
        else:
            points,cx,cy=inverse_field(amount,curl)
            frame=base.copy(); fp=frame.load()
            for y in range(199):
                taper=1.0
                if y>108:
                    t=min(1.,(y-108)/20.)
                    taper=1-t*t*(3-2*t)
                for x in range(232,W):
                    if hp[x,y]: continue
                    if taper==0:
                        fp[x,y]=ip[x,y]; continue
                    vals=[phi(x-u,y-v) for u,v in points]+[1,x/100,y/100]
                    dx=sum(a*b for a,b in zip(cx,vals))*taper
                    dy=sum(a*b for a,b in zip(cy,vals))*taper
                    sx=x+dx; sy=y+dy
                    ix=math.floor(sx); iy=math.floor(sy)
                    tx=sx-ix; ty=sy-iy
                    alpha=0.; full_alpha=0.; rsum=0.; gsum=0.; bsum=0.
                    for xx,yy,weight in [(ix,iy,(1-tx)*(1-ty)),(ix+1,iy,tx*(1-ty)),
                                         (ix,iy+1,(1-tx)*ty),(ix+1,iy+1,tx*ty)]:
                        if 0<=xx<W and 0<=yy<H:
                            full_alpha+=ip[xx,yy][3]*weight
                        if 0<=xx<W and 0<=yy<199 and ap[xx,yy] and not hp[xx,yy]:
                            r,g,b,a=ip[xx,yy]
                            aw=a*weight; alpha+=aw
                            rsum+=r*aw; gsum+=g*aw; bsum+=b*aw
                    ai=round(alpha)
                    if interior[x,y]==255 and full_alpha>254.999:
                        # At an internal layer cut, composite over the original
                        # opaque tissue instead of manufacturing an alpha seam.
                        r,g,b,a=ip[x,y]
                        remain=1-alpha/255.
                        fp[x,y]=(round(rsum/255.+r*remain),
                                 round(gsum/255.+g*remain),
                                 round(bsum/255.+b*remain),255)
                    elif ai:
                        # New silhouette pixels have no old limb underneath.
                        fp[x,y]=(round(rsum/alpha),round(gsum/alpha),round(bsum/alpha),ai)
                    elif ap[x,y] and ip[x,y][3] and not hp[x,y]:
                        r,g,b,a=ip[x,y]; fp[x,y]=(r,g,b,0)
                    else:
                        fp[x,y]=ip[x,y]
            frame.save(path)
        frames.append(name)
        # Immediate byte-level contract checks, including the unchanged torso.
        assert frame.size==im.size
        for y in range(H):
            for x in range(W):
                p=frame.getpixel((x,y)); orig=ip[x,y]
                if hp[x,y] or y>=128 or x<232:
                    assert p==orig,('protected pixel',index,x,y)
                if p[3]==orig[3]==0:
                    assert p==orig,('transparent RGB',index,x,y)
                if interior[x,y]==255:
                    assert p[3]==255,('interior alpha',index,x,y)
                if p!=orig: ep[x,y]=255
        print(f'{name}: pose={amount:.2f}, fingers={curl:.2f}',flush=True)

    notes=('Jednorázové poškrábání hlavy dvěma krátkými pohyby prstů a návrat do klidu. '
           'Ruka je již v originálu na hlavě; pohyb je proto jemný, omezený na prsty, '
           'zápěstí a zdviženou paži. Hlava, oči, ústa, trup a chodidla zůstávají '
           'pixelově shodné. Rozsah pohybu respektuje těsný horní a pravý okraj plátna. '
           'První i poslední PNG jsou přesné kopie source.png. Bez externích služeb.')
    result={'notes':notes,'scripts':['generate.py'],'clips':[{
        'kind':'expression','label':'Poškrábání na hlavě','fps':10,'frames':frames}]}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')

    # Transparent pixels are composited only in this review artifact.
    thumbw,thumbh=290,460
    sheet=Image.new('RGB',(4*thumbw,3*(thumbh+25)),(230,232,234))
    draw=ImageDraw.Draw(sheet)
    for i,name in enumerate(frames):
        bg=Image.new('RGBA',(W,H),(119,133,144,255))
        bg.alpha_composite(Image.open(ROOT/name).convert('RGBA'))
        tile=bg.convert('RGB').resize((thumbw,thumbh),Image.Resampling.LANCZOS)
        x=(i%4)*thumbw; y=(i//4)*(thumbh+25)
        sheet.paste(tile,(x,y)); draw.text((x+8,y+thumbh+5),f'{i+1:02d} / {i/10:.1f}s',fill=(20,20,20))
    sheet.save(ROOT/'contact-sheet.png')
    # Enlarged joint review, making individual finger poses easy to inspect.
    detail=Image.new('RGB',(4*342,3*410),(119,133,144))
    for i,name in enumerate(frames):
        bg=Image.new('RGBA',(W,H),(119,133,144,255)); bg.alpha_composite(Image.open(ROOT/name))
        tile=bg.crop((215,0,386,205)).resize((342,410),Image.Resampling.NEAREST).convert('RGB')
        detail.paste(tile,((i%4)*342,(i//4)*410))
    detail.save(ROOT/'joint-contact-sheet.png')
    # Verify distinct intermediate poses and byte-identical first/last files.
    assert (ROOT/frames[0]).read_bytes()==SOURCE.read_bytes()==(ROOT/frames[-1]).read_bytes()
    assert len({Image.open(ROOT/f).tobytes() for f in frames})==11
    print('Verified: 12 frames, 11 unique poses, 386x613 RGBA; exact endpoints; fixed head/body.')
    print('Changed union bounding rectangle:',edited_union.getbbox())


if __name__=='__main__':
    main()

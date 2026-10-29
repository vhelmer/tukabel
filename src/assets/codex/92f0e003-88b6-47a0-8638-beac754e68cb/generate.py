from PIL import Image, ImageDraw, ImageFilter
import json, hashlib, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = Image.open(ROOT / 'source.png').convert('RGBA')
W, H = SOURCE.size
S = 4

def bez(points, steps=50):
    out=[]
    for i in range(steps+1):
        t=i/steps; u=1-t
        if len(points)==4:
            x=u**3*points[0][0]+3*u*u*t*points[1][0]+3*u*t*t*points[2][0]+t**3*points[3][0]
            y=u**3*points[0][1]+3*u*u*t*points[1][1]+3*u*t*t*points[2][1]+t**3*points[3][1]
        else:
            x=u*u*points[0][0]+2*u*t*points[1][0]+t*t*points[2][0]
            y=u*u*points[0][1]+2*u*t*points[1][1]+t*t*points[2][1]
        out.append((x,y))
    return out

def poly(draw, points, fill):
    draw.polygon([(round(x*S),round(y*S)) for x,y in points], fill=fill)

def line(draw, points, color, width):
    draw.line([(round(x*S),round(y*S)) for x,y in points], fill=color, width=max(1,round(width*S)), joint='curve')

def composite_exact(base, painted, mask):
    out=Image.composite(painted,base,mask)
    out.putalpha(SOURCE.getchannel('A'))
    return out

EYES = [
    ([(141.6,45.0),(146.1,41.8),(154.5,43.6),(158.8,49.7)],
     [(141.6,45.0),(143.5,51.6),(153.9,53.7),(158.8,49.7)], (151,54)),
    ([(169.9,51.6),(173.3,48.6),(181.8,49.2),(184.1,53.9)],
     [(169.9,51.6),(171.3,56.7),(180.5,58.0),(184.1,53.9)], (178,59))
]

def blink(amount):
    if amount==0: return SOURCE.copy()
    hi=SOURCE.resize((W*S,H*S), Image.Resampling.BICUBIC)
    mask=Image.new('L',hi.size); md=ImageDraw.Draw(mask)
    ink=Image.new('RGBA',hi.size,(0,0,0,0)); d=ImageDraw.Draw(ink)
    # Lids slide over an unmoved eyeball. Neither eye nor its surrounding face is scaled.
    for upper,lower,sample in EYES:
        a,b=bez(upper),bez(lower)
        moving=[(p[0]*(1-amount)+q[0]*amount,p[1]*(1-amount)+q[1]*amount) for p,q in zip(a,b)]
        region=a+list(reversed(moving))
        poly(md,region,255)
        # Locally sampled, slightly warm skin with the source's shading and fine grain.
        xs=[p[0] for p in region]; ys=[p[1] for p in region]
        for yy in range(max(0,int(min(ys)*S)-2),min(H*S,int(max(ys)*S)+3)):
            for xx in range(max(0,int(min(xs)*S)-2),min(W*S,int(max(xs)*S)+3)):
                x,y=xx/S,yy/S
                v=min(1,max(0,(x-upper[0][0])/(upper[-1][0]-upper[0][0])))
                if sample[0]<160:
                    c0=(167,91,52); c1=(136,65,34)
                else:
                    c0=(143,70,36); c1=(182,103,59)
                noise=(SOURCE.getpixel((min(W-1,int(x)),int(sample[1]+(yy%8)/4)))[0]-158)*.035
                color=tuple(round(c0[k]*(1-v)+c1[k]*v+noise+(1-amount)*1.5) for k in range(3))
                hi.putpixel((xx,yy),(*color,255))
        # Thin painted lid margin follows the eye's existing tilted perspective.
        line(d,moving,(61,30,18,255),.9)
        line(md,moving,255,1.15)
        if amount>.9:
            crease=[(x,y-1.6) for x,y in moving[7:-7]]
            line(d,crease,(111,55,30,120),.38)
            line(md,crease,180,.55)
    hi=Image.alpha_composite(hi,ink)
    painted=hi.resize(SOURCE.size,Image.Resampling.LANCZOS)
    mask=mask.resize(SOURCE.size,Image.Resampling.LANCZOS)
    # Explicit bounds avoid filter tails outside the eye-only regions.
    bounds=Image.new('L',SOURCE.size); bd=ImageDraw.Draw(bounds)
    bd.rectangle((140,42,160,54),fill=255);bd.rectangle((168,48,185,59),fill=255)
    from PIL import ImageChops
    mask=ImageChops.multiply(mask,bounds)
    return composite_exact(SOURCE,painted,mask)


def mouth(pose):
    if pose=='neutral': return SOURCE.copy()
    hi=SOURCE.resize((W*S,H*S),Image.Resampling.BICUBIC)
    # Remove only the original small lower-lip stroke, sampling skin on either side.
    clean=Image.new('L',hi.size);cd=ImageDraw.Draw(clean)
    poly(cd,bez([(151.0,82),(155,80.9),(164,82.2),(166,85.8)])+bez([(166,85.8),(160,87),(154,85.4),(151,82)]),255)
    skin=hi.copy()
    for yy in range(80*S,88*S):
        y=yy/S
        for xx in range(150*S,168*S):
            x=xx/S;t=(x-150)/18
            l=SOURCE.getpixel((149,int(y)));r=SOURCE.getpixel((168,int(y)))
            c=tuple(round(l[k]*(1-t)+r[k]*t) for k in range(3))
            skin.putpixel((xx,yy),(*c,255))
    hi=Image.composite(skin,hi,clean.filter(ImageFilter.GaussianBlur(.4*S)))
    d=ImageDraw.Draw(hi)
    # Five visemes include the unedited neutral frame. All moving shapes stay below the moustache.
    shapes={
      'ee': ([(151.5,79.7),(156,79.7),(163.5,79),(168,80.3)],[(168,80.3),(165.2,85.6),(155,85.6),(151.5,79.7)]),
      'ah': ([(153.5,79.5),(158,78.4),(164.5,78.7),(168,80.1)],[(168,80.1),(168.8,91.0),(154.1,91.7),(153.5,79.5)]),
      'oh': ([(157,79.5),(159,77.9),(164,78.5),(165.5,80.4)],[(165.5,80.4),(169,91.3),(154,90.2),(157,79.5)]),
      'fv': ([(152.8,79.7),(157,79.9),(163.4,79.6),(167,80.4)],[(167,80.4),(166,84.5),(156,85.5),(152.8,79.7)])
    }
    top,bottom=shapes[pose]
    contour=bez(top)+bez(bottom)
    poly(d,contour,(48,23,17,255))
    line(d,bez(bottom),(83,36,24,255),.8)
    if pose in ('ee','fv'):
        if pose=='ee':
            teeth=bez([(153.4,80.1),(158,80.3),(163.5,80),(166.1,80.7)])+bez([(166.1,80.7),(162,82.9),(156,82.7),(153.4,80.1)])
        else:
            teeth=bez([(154.2,80.2),(158,80.2),(163,80),(165.9,80.7)])+bez([(165.9,80.7),(162.4,83.4),(157.2,83.5),(154.2,80.2)])
        poly(d,teeth,(204,177,133,255))
        if pose=='fv':
            line(d,bez([(156,84.2),(160,83.1),(163,83.2),(165,83.8)]),(156,73,44,255),1.0)
    if pose=='ah':
        poly(d,bez([(156.5,87.2),(159,85.8),(163.1,86.0),(165.7,87.3)])+bez([(165.7,87.3),(162.8,89.3),(158.7,89.5),(156.5,87.2)]),(133,57,39,255))
        line(d,bez([(156,89.1),(159,90.5),(163.5,90),(165.5,88.8)]),(167,81,47,255),.65)
    if pose=='oh':
        line(d,bez([(157.8,87.4),(159.8,89.2),(163.7,89.3),(165,87.3)]),(159,76,43,255),1.0)
    if pose=='ee':
        line(d,bez([(154.5,84),(158,85.6),(163.6,85),(166.4,83.5)]),(157,74,44,255),.65)
    painted=hi.resize(SOURCE.size,Image.Resampling.LANCZOS)
    # Single anatomical mouth mask. Dark moustache pixels and all surrounding skin stay original.
    mhi=clean.filter(ImageFilter.GaussianBlur(.4*S));md=ImageDraw.Draw(mhi)
    poly(md,contour,255)
    line(md,bez(bottom),255,1.2)
    if pose=='ah':
        line(md,bez([(156,89.1),(159,90.5),(163.5,90),(165.5,88.8)]),255,1.0)
    if pose=='oh':
        line(md,bez([(157.8,87.4),(159.8,89.2),(163.7,89.3),(165,87.3)]),255,1.3)
    if pose=='ee':
        line(md,bez([(154.5,84),(158,85.6),(163.6,85),(166.4,83.5)]),255,1.0)
    mask=mhi.resize(SOURCE.size,Image.Resampling.LANCZOS)
    for y in range(H):
        for x in range(W):
            if not (149<=x<=171 and 77<=y<=92): mask.putpixel((x,y),0);continue
            r,g,b,a=SOURCE.getpixel((x,y))
            if (y<=81 or (x>=168 and y<=86)) and r<55 and g<36: mask.putpixel((x,y),0)
    return composite_exact(SOURCE,painted,mask)

clips=[]
for kind,label,frames in [
    ('blink','Přirozené mrknutí',[blink(t) for t in (0,.52,1,.31,0)]),
    ('talk','Mluvení – klid, E, A, O, F',[mouth(p) for p in ('neutral','ee','ah','oh','fv')])
]:
    names=[]
    for i,im in enumerate(frames,1):
        name=f'{kind}-{i:02}.png'
        if im.tobytes()==SOURCE.tobytes():
            shutil.copyfile(ROOT/'source.png',ROOT/name)
        else:
            im.save(ROOT/name)
        names.append(name)
    clips.append({'kind':kind,'label':label,'fps':12,'frames':names})

# Verify all source alpha, dimensions, unique poses, endpoint identity and disjoint difference bounds.
bounds={}
for clip in clips:
    changes=[];digests=[]
    for name in clip['frames']:
        im=Image.open(ROOT/name).convert('RGBA')
        assert im.size==SOURCE.size and im.getchannel('A').tobytes()==SOURCE.getchannel('A').tobytes()
        digests.append(hashlib.sha256(im.tobytes()).hexdigest())
        changes += [(i%W,i//W) for i,(a,b) in enumerate(zip(SOURCE.getdata(),im.getdata())) if a!=b]
    bounds[clip['kind']]=(min(x for x,y in changes),min(y for x,y in changes),max(x for x,y in changes)+1,max(y for x,y in changes)+1)
    assert len(set(digests))==(4 if clip['kind']=='blink' else 5)
for n in (clips[0]['frames'][0],clips[0]['frames'][-1]):
    assert Image.open(ROOT/n).convert('RGBA').tobytes()==SOURCE.tobytes()
a,b=bounds['blink'],bounds['talk']
assert a[3]<=b[1] or b[3]<=a[1] or a[2]<=b[0] or b[2]<=a[0]
result={'notes':'Pět snímků anatomického mrknutí a pět odlišných poloh úst včetně původního klidu. Víčka překrývají pevné oči; hlava a knír zůstávají ukotvené. Knír přirozeně omezuje viditelnost horního rtu. První i poslední snímek mrknutí jsou pixelově shodné se zdrojem. Rozměry 249 × 235, původní alfa i všechny pixely mimo oči a ústa zachovány; obdélníky změn se nepřekrývají. Mluvení obsahuje klid a hlásky E, A, O, F.','scripts':['generate.py'],'clips':clips}
(ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
# Review sheet: exact-size full sprites and enlarged face crops in temporal order.
sheet=Image.new('RGB',(5*249,2*(235+210+24)),(46,42,38));draw=ImageDraw.Draw(sheet)
for row,clip in enumerate(clips):
    y=row*(235+210+24)
    for col,name in enumerate(clip['frames']):
        im=Image.open(ROOT/name)
        sheet.paste(im.convert('RGB'),(col*249,y+24))
        face=im.crop((134,37,189,96)).resize((196,210),Image.Resampling.NEAREST)
        sheet.paste(face.convert('RGB'),(col*249+26,y+259))
        draw.text((col*249+8,y+6),name,fill=(238,228,205))
sheet.save(ROOT/'contact-sheet.png')
print(json.dumps({'changed_bounds':bounds,'verification':'passed'},ensure_ascii=False))

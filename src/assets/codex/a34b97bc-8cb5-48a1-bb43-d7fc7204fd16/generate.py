from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import json, shutil

ROOT = Path(__file__).resolve().parent
SOURCE = Image.open(ROOT / 'source.png').convert('RGBA')
W,H = SOURCE.size
S = 6

def curve(points, steps=28):
    # First point, followed by cubic Bezier segments.
    out=[points[0]]; p=points[0]
    for i in range(1,len(points),3):
        a,b,c=points[i:i+3]
        for n in range(1,steps+1):
            t=n/steps;u=1-t
            out.append((u**3*p[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t**3*c[0],u**3*p[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*c[1]))
        p=c
    return out

def path(points): return curve(points)
def mask_poly(points):
    m=Image.new('L',(W*S,H*S));ImageDraw.Draw(m).polygon([(round(x*S),round(y*S)) for x,y in points],fill=255)
    return m.resize((W,H),Image.Resampling.LANCZOS)

def paint(im, points, color):
    mask=mask_poly(points)
    layer=Image.new('RGBA',im.size,color)
    im.paste(layer,(0,0),mask)

def stroke(im, points, color, width):
    layer=Image.new('RGBA',(W*S,H*S));d=ImageDraw.Draw(layer)
    d.line([(round(x*S),round(y*S)) for x,y in points],fill=color,width=round(width*S),joint='curve')
    im.alpha_composite(layer.resize((W,H),Image.Resampling.LANCZOS))

# Apertures follow the existing eye sockets, beneath the fixed eyebrows.
EYES=[dict(top=[(142.0,45.5),(148.0,41.5),(156.5,43.9),(158.3,50.5)],
           bottom=[(157.3,49.9),(154.1,53.3),(146.0,52.2),(142.0,45.5)],
           closed=[(142.0,46.3),(146.5,51.4),(154.0,53.0),(158.3,50.5)],
           color=(161,86,48)),
      dict(top=[(170.9,51.3),(174.4,47.5),(181.0,48.4),(183.5,52.8)],
           bottom=[(183.0,52.2),(182.5,57.8),(173.8,57.2),(170.9,51.3)],
           closed=[(170.9,52.0),(174.1,56.4),(180.7,57.2),(183.5,53.7)],
           color=(155,80,44))]

def blink(amount):
    if amount==0:return SOURCE.copy()
    out=SOURCE.copy()
    for eye in EYES:
        top=curve(eye['top']); bottom=curve(eye['bottom'])
        end=curve(eye['closed'])
        moving=[(a[0]*(1-amount)+b[0]*amount,a[1]*(1-amount)+b[1]*amount) for a,b in zip(top,end)]
        # A lid is painted over the stationary eyeball, never scaled.
        region=top+list(reversed(moving))
        mask=mask_poly(region)
        col=eye['color'];skin=Image.new('RGBA',SOURCE.size)
        pix=skin.load()
        for y in range(H):
            for x in range(W):
                # Soft painted lid modelling, with subtle original skin texture.
                v=max(-1,min(1,(y-top[0][1])/8))
                noise=(SOURCE.getpixel((max(0,min(W-1,x-4)),min(H-1,y+12)))[0]%7-3)*.18
                pix[x,y]=(int(col[0]+v*9+noise),int(col[1]+v*7+noise),int(col[2]+v*4+noise),255)
        out.paste(skin,(0,0),mask)
        stroke(out,moving,(52,29,19,255),.85)
    # Keep the fixed eyebrows and nearby skin exact, including filter fringes.
    for y in range(H):
        for x in range(W):
            if not ((141<=x<161 and 44<=y<56) or (170<=x<186 and 50<=y<60)):
                out.putpixel((x,y), SOURCE.getpixel((x,y)))
    out.putalpha(SOURCE.getchannel('A'))
    return out

# Clean only the old lower lip. The upper lip and moustache silhouette stay
# available as the fixed upper edge of each newly articulated mouth.
MOUTH_AREA=path([(153.5,79.7),(157,80),(159,80.1),(162,80.3),
                 (166,80.3),(169,80.4),(171.1,81.2),
                 (171.9,83.6),(170.7,87.4),(166.2,88.0),
                 (161,88.0),(154,86.9),(152.1,84.1),
                 (151.4,82.5),(152.1,80.7),(153.5,79.7)])

def clean_mouth():
    # Harmonic fill of the old lower-lip shadow using its local skin boundary.
    out=SOURCE.copy()
    m=mask_poly(path([(150.0,82.4),(153.0,79.8),(162.0,80.7),(165.7,83.0),
                      (169.0,85.1),(166.0,88.6),(162.2,88.6),
                      (156.0,88.0),(151.0,87.0),(150.0,82.4)]))
    pts=[(x,y) for y in range(79,91) for x in range(148,172) if m.getpixel((x,y))>127]
    values={(x,y):tuple(float(v) for v in SOURCE.getpixel((x,y))[:3]) for y in range(77,94) for x in range(146,175)}
    for x,y in pts:
        values[x,y]=tuple(float(v) for v in SOURCE.getpixel((x,y+8))[:3])
    for _ in range(220):
        for x,y in pts:
            ns=[values[x-1,y],values[x+1,y],values[x,y-1],values[x,y+1]]
            values[x,y]=tuple(sum(n[c] for n in ns)/4 for c in range(3))
    patch=SOURCE.copy()
    for x,y in pts:patch.putpixel((x,y),tuple(round(v) for v in values[x,y])+(SOURCE.getpixel((x,y))[3],))
    out.paste(patch,(0,0),m)
    return out

# Each shape has its own outline and internal articulation, in source pixels.
def talk(pose):
    if pose=='neutral':return SOURCE.copy()
    out=clean_mouth()
    shapes={
      'parted':[(155.7,80.0),(159.4,79.2),(166.0,79.6),(170.0,81.3),(166.0,83.4),(159.0,82.7),(155.7,80.0)],
      'a':[(156.0,80.0),(160.0,79.1),(166.8,79.6),(170.0,81.2),(170.0,87.2),(160.5,88.1),(156.0,80.0)],
      'o':[(160.0,80.0),(162.1,78.8),(166.3,79.6),(168.0,81.4),(171.0,88.5),(158.4,88.1),(160.0,80.0)],
      'e':[(154.4,80.0),(159.2,79.0),(166.3,79.9),(170.6,81.4),(168.4,86.0),(157.2,85.1),(154.4,80.0)]}
    shape=path(shapes[pose]);paint(out,shape,(42,20,15,255));stroke(out,shape,(62,29,19,255),.65)
    if pose=='parted':
        stroke(out,path([(157.4,82.4),(161.7,83.3),(166.3,83.4),(169.2,82.1)]),(140,63,37,255),.6)
    elif pose=='a':
        paint(out,path([(159.8,85.0),(163.0,83.9),(167.2,84.2),(168.7,85.6),(167.1,87.1),(163.0,87.0),(159.8,85.0)]),(157,67,50,255))
        stroke(out,path([(159.9,87.2),(163.7,89.1),(168.6,87.8),(170,85.4)]),(163,85,49,255),.65)
    elif pose=='o':
        stroke(out,shape,(128,60,37,255),.9)
        stroke(out,path([(161.8,86.0),(163.6,87.1),(166.2,87.0),(167.0,85.8)]),(173,88,56,255),.55)
    elif pose=='e':
        paint(out,path([(155.7,80.6),(160.3,80.2),(166.0,80.6),(169.4,81.6),(166.8,83.4),(158.7,82.6),(155.7,80.6)]),(220,199,155,255))
        stroke(out,path([(156.8,84.0),(161.8,86.0),(167.0,85.7),(169.5,83.6)]),(154,75,44,255),.6)
    # Exact source alpha and fixed moustache are composited back byte for byte.
    for y in range(74,83):
        for x in range(150,175):
            r,g,b,a=SOURCE.getpixel((x,y))
            if max(r,g,b)<52:
                out.putpixel((x,y),(r,g,b,a))
    out.putalpha(SOURCE.getchannel('A'))
    return out

clips=[]; all_frames=[]
for kind,label,frames in [('blink','Přirozené mrknutí',[blink(t) for t in [0,.52,1,.72,0]]),
                          ('talk','Mluvení – klid, pootevření, A, O, E',[talk(p) for p in ['neutral','parted','a','o','e']])]:
    names=[]
    for i,im in enumerate(frames,1):
        name=f'{kind}-{i:02d}.png'
        if im.tobytes()==SOURCE.tobytes(): shutil.copyfile(ROOT/'source.png',ROOT/name)
        else: im.save(ROOT/name)
        names.append(name)
    clips.append(dict(kind=kind,label=label,fps=12,frames=names));all_frames.append(frames)

# Full-size alignment preview plus enlarged eyes and mouth.
sheet=Image.new('RGB',(W*5, (H+140)*2),(40,35,31));d=ImageDraw.Draw(sheet)
for row,frames in enumerate(all_frames):
    for i,im in enumerate(frames):
        x=i*W;y=row*(H+140)
        sheet.paste(im,(x,y))
        detail=im.crop((137,39,187,91)).resize((120,125),Image.Resampling.NEAREST)
        sheet.paste(detail,(x+65,y+H))
        d.text((x+6,y+H+5),f'{["blink","talk"][row]} {i+1}',fill='white')
sheet.save(ROOT/'contact-sheet.png')

# Byte-level validation of all preservation and alignment constraints.
def changed_bbox(im):
    a=SOURCE.load();b=im.load();pts=[(x,y) for y in range(H) for x in range(W) if a[x,y]!=b[x,y]]
    return None if not pts else (min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts)+1,max(y for x,y in pts)+1)
boxes=[]
for frames in all_frames:
    bs=[changed_bbox(im) for im in frames];bs=[b for b in bs if b]
    boxes.append((min(b[0] for b in bs),min(b[1] for b in bs),max(b[2] for b in bs),max(b[3] for b in bs)))
a,b=boxes
assert a[3]<=b[1] or b[3]<=a[1] or a[2]<=b[0] or b[2]<=a[0]
assert all_frames[0][0].tobytes()==SOURCE.tobytes()==all_frames[0][-1].tobytes()
assert len({im.tobytes() for im in all_frames[0]})>=3
assert len({im.tobytes() for im in all_frames[1]})==5
for frames in all_frames:
    for im in frames:
        assert im.size==(249,235)
        assert im.getchannel('A').tobytes()==SOURCE.getchannel('A').tobytes()
        box=changed_bbox(im)
        if box:
            allowed=(138,40,187,61) if frames is all_frames[0] else (149,74,176,92)
            assert box[0]>=allowed[0] and box[1]>=allowed[1] and box[2]<=allowed[2] and box[3]<=allowed[3],(box,allowed)
notes='Lokálně vytvořeno pomocí Pillow: 5 snímků mrknutí a 5 odlišných tvarů úst včetně původního klidu, 12 sn./s. Víčka zakrývají pevně usazené oči. První a poslední snímek mrknutí přesně odpovídají zdroji. Rozměry, poloha, alfa kanál a všechny pixely mimo upravené oči a ústa jsou zachovány. Oblasti změn se nepřekrývají. Knír omezuje viditelnou horní část úst; zachován původní tmavý obrys kníru.'
(ROOT/'result.json').write_text(json.dumps(dict(notes=notes,scripts=['generate.py'],clips=clips),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Validated RGBA, dimensions, unique poses, exact blink endpoints and disjoint changed bounds:', boxes)

"""Reproducible local Pillow animation, without network or additional packages."""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import math, json, hashlib

ROOT=Path(__file__).resolve().parent
SRC=Image.open(ROOT/'source.png').convert('RGBA')
W,H=SRC.size
S=6
INK=(39,24,15)

def curve(points, steps=48):
    out=[points[0]]
    p=points[0]
    for j in range(1,len(points),3):
        a,b,c=points[j:j+3]
        for i in range(1,steps+1):
            t=i/steps;u=1-t
            out.append((u*u*u*p[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t*t*t*c[0],u*u*u*p[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t*t*t*c[1]))
        p=c
    return out

def poly(draw,pts,color): draw.polygon([(round(x*S),round(y*S)) for x,y in pts], fill=color)
def line(draw,pts,color,width): draw.line([(round(x*S),round(y*S)) for x,y in pts], fill=color,width=round(width*S),joint='curve')
def canvas():return SRC.convert('RGB').resize((W*S,H*S),Image.Resampling.NEAREST)
def finish(rgb,mask):
    rgb=rgb.resize((W,H),Image.Resampling.LANCZOS)
    mask=mask.resize((W,H),Image.Resampling.LANCZOS)
    # Enforce a compact support; Lanczos fringe is part of the explicitly edited mask.
    mask=mask.point(lambda p:0 if p<3 else p)
    out=Image.composite(rgb,SRC.convert('RGB'),mask).convert('RGBA')
    out.putalpha(SRC.getchannel('A'))
    return out

def blink(amount):
    if amount==0:return SRC.copy()
    rgb=canvas();d=ImageDraw.Draw(rgb);m=Image.new('L',rgb.size);md=ImageDraw.Draw(m)
    eyes=[(
        [(126.5,55.3),(128.1,48.9),(137.4,49.7),(148.0,58.9)],
        [(126.5,55.3),(126.0,65.0),(141.5,65.6),(148.0,58.9)],
        (180,117,65)),(
        [(170.0,61.9),(175.8,54.1),(185.2,52.7),(190.3,61.2)],
        [(170.0,61.9),(173.3,70.8),(187.3,70.2),(190.3,61.2)],
        (183,120,68))]
    for upper,lower,skin in eyes:
        up=curve(upper);lo=curve(lower)
        edge=[(a[0]*(1-amount*.72)+b[0]*amount*.72,a[1]*(1-amount*.72)+b[1]*amount*.72) for a,b in zip(up,lo)]
        bottom=[(a[0]*(amount*.28)+b[0]*(1-amount*.28),a[1]*(amount*.28)+b[1]*(1-amount*.28)) for a,b in zip(up,lo)]
        lid=up+list(reversed(edge))
        lower_lid=bottom+list(reversed(lo))
        local=Image.new('L',rgb.size);ld=ImageDraw.Draw(local)
        poly(ld,lid,255)
        poly(ld,lower_lid,255)
        # Skin is a shaded, lightly textured lid, not a resized eye.
        box=local.getbbox()
        if box:
            pix=rgb.load();mp=local.load()
            for yy in range(box[1],box[3]):
                for xx in range(box[0],box[2]):
                    if mp[xx,yy]:
                        fy=yy/S;fx=xx/S
                        shade=2.0*math.sin(fx*0.7+fy*0.3)+1.0*math.sin(fx*2.1-fy)
                        v=(fy-56)*0.75
                        pix[xx,yy]=tuple(round(c+shade-v) for c in skin)
        poly(md,lid,255)
        poly(md,lower_lid,255)
        line(d,edge,INK,1.35);line(md,edge,255,1.6)
        # A fine warm crease immediately above the moving lash line.
        if amount>.8:
            middle=edge[6:-6]
            crease=[(x,y-1.35) for x,y in middle]
            line(d,crease,(133,77,41),.48);line(md,crease,210,.65)
    return finish(rgb,m)

# The original mouth's upper contour follows the underside of the nose.
TOP=[(120.6,75.0),(126,78.8),(132,82.0),(139.4,84.0),
     (143,85.0),(146.5,88.8),(153,89.2),
     (165,91.1),(183,86.9),(192.1,80.9)]

def mouth_floor(depth):
    return [(192.1,80.9),(184.5,91.5+depth*.20),(169,94.2+depth),(155.7,94.2+depth),
            (141,94.6+depth),(127.5,85.7+depth*.28),(120.6,75.0)]

def mouth(pose):
    if pose=='neutral':return SRC.copy()
    rgb=canvas();d=ImageDraw.Draw(rgb);m=Image.new('L',rgb.size);md=ImageDraw.Draw(m)
    # Clear only the original smile and its lower lip, keeping nose and cheek creases.
    clean_top=curve(TOP)
    if pose in ('oo','mm'):
        clean_top=[(x,y-(.65 if 143<x<162 else 1.35)*math.sin(math.pi*(x-120.6)/71.5)**.4) for x,y in clean_top]
    clean=clean_top+curve([(192.1,80.9),(188,94),(169,100.4),(155,99.0),(139,98),(125,87),(120.6,75.0)])[1:]
    cm=Image.new('L',rgb.size);poly(ImageDraw.Draw(cm),clean,255)
    cp=cm.load();rp=rgb.load();sp=SRC.load()
    bb=cm.getbbox()
    for yy in range(bb[1],bb[3]):
        for xx in range(bb[0],bb[2]):
            if cp[xx,yy]:
                x=xx/S;y=yy/S
                # Actual skin texture sampled from a clean central chin patch.
                sx=round(143+(x-120)*23/73);sy=round(102+(y-75)*3/27)
                base=sp[sx,sy][:3]
                # Recover the face's warm cheek light without flattening its texture.
                rp[xx,yy]=tuple(min(255,max(0,int(c))) for c in base)
    poly(md,clean,255)
    if pose in ('aa','ee'):
        depth=5.3 if pose=='aa' else 1.5
        contour=curve(TOP)+curve(mouth_floor(depth))[1:]
        poly(d,contour,(43,25,16));line(d,contour+[contour[0]],INK,1.15)
        # The inside darkens toward the upper palate; a small shaded tongue stays low.
        if pose=='aa':
            tongue=curve([(143,97.0),(150,94.8),(165,95.1),(173,96.8),(168,100.4),(151,100.6),(143,97.0)])
            poly(d,tongue,(127,65,43));line(d,curve([(148,97),(155,95.8),(164,96),(169,97)]),(155,86,55),.6)
        # Keep the source teeth and the nose-side edges exactly as drawn. Only the
        # lower edge below each original tooth opens, revealing the shaded cavity.
        original=SRC.convert('RGB').resize(rgb.size,Image.Resampling.NEAREST)
        teeth=Image.new('L',rgb.size);td=ImageDraw.Draw(teeth)
        upper=curve(TOP)
        bottom=curve([(192.1,80.9),(183,91.2),(168.5,93.1),(155.5,92.5),(140,92.7),(126.2,84.9),(120.6,75.0)])
        poly(td,upper+bottom[1:],255)
        rgb.paste(original,(0,0),teeth);d=ImageDraw.Draw(rgb)
        # A subtle drawn lower-lip accent follows the opened mouth.
        lip=curve([(133,92+depth*.45),(147,99+depth*.6),(169,100+depth*.55),(181,93+depth*.45)])
        line(d,lip,(146,89,45),.65);line(md,lip,255,.9)
    elif pose in ('oo','mm'):
        # The retained corner creases converge into a pursed vowel or closed lips.
        if pose=='oo':
            left=curve([(121,75.5),(131,86),(140,88.2),(148,90.0)])
            right=curve([(170,90),(180,88),(186,85),(192,81)])
            line(d,left,(75,43,23),1.0);line(d,right,(75,43,23),1.0)
            outer=curve([(158.5,88.5),(151.5,88.3),(149.5,94.0),(153.7,98.4),(156.5,101.3),(163.1,100.3),(166,96.8),(169,92.5),(165,88.6),(158.5,88.5)])
            poly(d,outer,(131,75,40));line(d,outer,INK,.9)
            cavity=curve([(158.6,90.0),(154.4,89.8),(152.8,94.1),(155.4,96.8),(157.4,99.0),(162.2,97.9),(163.8,94.6),(165.2,91.6),(162.8,90.0),(158.6,90.0)])
            poly(d,cavity,(46,26,19));line(d,cavity,(63,33,22),.55)
            # One brief warm tooth edge keeps the gold-toothed design recognizable.
            line(d,curve([(155,90.1),(157,90.9),(160,91.1),(162.5,90.6)]),(209,171,76),1.1)
            line(d,curve([(155,98),(158,99),(163,98.5),(165,97.4)]),(200,133,74),.6)
        else:
            seam=curve(TOP)
            line(d,seam,(73,41,22),1.45)
            lower=curve([(135,88.8),(148,94.5),(169,95.1),(180,88.7)])
            line(d,lower,(157,94,48),.75)
            light=curve([(141,90.2),(152,93.2),(167,93.3),(175,90.9)])
            line(d,light,(198,133,72),.7)
    return finish(rgb,m)

clips=[]
for kind,label,ims in [
    ('blink','Přirozené mrknutí',[blink(a) for a in (0,.52,1,.30,0)]),
    ('talk','Mluvení – úsměv, A, E, O, M',[mouth(p) for p in ('neutral','aa','ee','oo','mm')])]:
    frames=[]
    for i,im in enumerate(ims,1):
        name=f'{kind}-frame-{i:02d}.png'
        if im.tobytes()==SRC.tobytes():
            (ROOT/name).write_bytes((ROOT/'source.png').read_bytes())
        else:
            im.save(ROOT/name)
        frames.append(name)
    clips.append(dict(kind=kind,label=label,fps=12,frames=frames))

# Full-resolution RGBA checks, including all RGB bytes behind transparency.
s=SRC.tobytes(); support={};bboxes={}
for clip in clips:
    changed=set();hs=[]
    for name in clip['frames']:
        im=Image.open(ROOT/name).convert('RGBA')
        assert im.size==SRC.size
        assert im.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
        raw=im.tobytes();hs.append(hashlib.sha256(raw).hexdigest())
        for k in range(W*H):
            j=k*4
            if raw[j:j+4]!=s[j:j+4]:changed.add((k%W,k//W))
    if clip['kind']=='blink':
        assert all((124<=x<152 and 49<=y<68) or (168<=x<194 and 53<=y<72) for x,y in changed)
    else:
        assert all(119<=x<194 and 73<=y<103 for x,y in changed)
    support[clip['kind']]=changed
    bboxes[clip['kind']]=[min(x for x,y in changed),min(y for x,y in changed),max(x for x,y in changed)+1,max(y for x,y in changed)+1]
    assert len(set(hs))==(4 if clip['kind']=='blink' else 5),hs
assert Image.open(ROOT/clips[0]['frames'][0]).tobytes()==s
assert Image.open(ROOT/clips[0]['frames'][-1]).tobytes()==s
assert not support['blink'] & support['talk']
a,b=bboxes['blink'],bboxes['talk']
assert a[2]<=b[0] or b[2]<=a[0] or a[3]<=b[1] or b[3]<=a[1],bboxes

# Review sheet combines aligned whole sprites and magnified face crops.
sheet=Image.new('RGB',(5*332,2*620),(224,211,187));sd=ImageDraw.Draw(sheet)
for row,clip in enumerate(clips):
    for col,name in enumerate(clip['frames']):
        im=Image.open(ROOT/name)
        x=col*332;y=row*620
        sheet.paste(im,(x,y+20),im)
        face=im.crop((110,44,201,108)).resize((273,192),Image.Resampling.NEAREST)
        sheet.paste(face,(x+29,y+422),face)
        sd.text((x+10,y+3),f'{clip["kind"]} {col+1} / 5',fill=(42,31,22))
sheet.save(ROOT/'contact-sheet.png')
notes='Dva zarovnané klipy po pěti snímcích při 12 fps. Mrknutí překrývá oči anatomickými víčky bez deformace; první i poslední snímek přesně odpovídají zdroji. Řeč má pět odlišných poloh: původní úsměv, A, E, O a zavřené M. Původní alfa i všechny RGBA bajty mimo upravené oblasti zůstávají zachovány. Obdélníky změn očí a úst se nepřekrývají. Omezení: ruční lokální 2D retuš v malém rozlišení, bez pohybu čelisti a bez synchronizace s konkrétním zvukem; O a M vyžadují rekonstrukci části kresby rtů.'
(ROOT/'result.json').write_text(json.dumps(dict(notes=notes,scripts=['generate.py'],clips=clips),ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'changed_bounds':bboxes,'distinct_frames':{'blink':4,'talk':5},'alpha':'exact','outside_support':'exact'},indent=2))

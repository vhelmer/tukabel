#!/usr/bin/env python3
"""Deterministic Pillow-only facial animation; untouched pixels copied verbatim."""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import math, json, hashlib

ROOT=Path(__file__).resolve().parent
SRC=Image.open(ROOT/'source.png').convert('RGBA')
W,H=SRC.size
S=4

def bezier(points,steps=32):
    out=[]
    for a,b,c,d in points:
        for i in range(steps+1):
            t=i/steps;r=1-t
            out.append((r*r*r*a[0]+3*r*r*t*b[0]+3*r*t*t*c[0]+t*t*t*d[0],r*r*r*a[1]+3*r*r*t*b[1]+3*r*t*t*c[1]+t*t*t*d[1]))
    return out

def shape_mask(curves):
    m=Image.new('L',(W*S,H*S));d=ImageDraw.Draw(m)
    d.polygon([(round(x*S),round(y*S)) for x,y in bezier(curves)],fill=255)
    return m.resize((W,H),Image.Resampling.LANCZOS)

def line_hi(layer,pts,fill,width):
    ImageDraw.Draw(layer).line([(round(x*S),round(y*S)) for x,y in pts],fill=fill,width=round(width*S),joint='curve')

def apply_rgb(original,paint,mask):
    out=Image.composite(paint,original,mask)
    out.putalpha(original.getchannel('A'))
    return out

# Each outline surrounds exactly one eye, including its original contour.
EYES=[
 dict(outer=[((190,57.8),(195,54.2),(203.5,55.5),(208.3,61)),((208.3,61),(213,66.5),(211.8,72),(205.8,75.8)),((205.8,75.8),(199,79.6),(188,77.8),(185,69.6)),((185,69.6),(183.6,65.1),(185.9,60.5),(190,57.8))],left=(185.6,68.4),right=(210,68.3),top=55.9,bottom=75.1,skin=(215,133,82)),
 dict(outer=[((216.4,53.6),(219.2,52),(220.8,47.3),(223.4,46.8)),((223.4,46.8),(227.1,46),(232.6,50.1),(233.6,54.8)),((233.6,54.8),(236,59.9),(229.3,62.7),(223.5,61.9)),((223.5,61.9),(217.2,61.5),(215.8,57.2),(216.4,53.6))],left=(217,56.4),right=(233.1,56.5),top=47.3,bottom=60.3,skin=(219,137,86))
]

def blink(amount):
    if amount==0:return SRC.copy()
    out=SRC.copy()
    for e in EYES:
        outline=shape_mask(e['outer'])
        left,right=e['left'],e['right'];x0,y0=left;x1,y1=right
        # The upper lid travels over the unchanged globe. A shallow curved edge
        # reaches the lower lid; neither eyeball nor head is scaled.
        mid=e['top']+(e['bottom']-e['top'])*amount
        if amount==1:mid=e['bottom']-1
        edge=bezier([((x0,y0),(x0+3,mid),(x1-3,mid),(x1,y1))],48)
        cut=Image.new('L',(W*S,H*S));d=ImageDraw.Draw(cut)
        d.polygon([(int(x*S),int(y*S)) for x,y in [(x0-5,40),(x1+5,40),(x1+5,y1),*reversed(edge),(x0-5,y0)]],fill=255)
        cut=cut.resize((W,H),Image.Resampling.LANCZOS)
        import PIL.ImageChops
        m=outline if amount==1 else PIL.ImageChops.multiply(outline,cut)
        # Match the source's warm, subtly shaded eyelid paint.
        paint=SRC.copy();pix=paint.load()
        for y in range(44,81):
            for x in range(182,238):
                if m.getpixel((x,y)):
                    shade=(y-e['top'])*.65
                    noise=(math.sin(x*1.63+y*2.17)+math.sin(x*.91-y*.77))*.9
                    pix[x,y]=tuple(max(0,min(255,int(c-shade+noise))) for c in e['skin'])+(255,)
        out=apply_rgb(out,paint,m)
        ink=Image.new('RGBA',(W*S,H*S),(0,0,0,0))
        line_hi(ink,edge,(44,28,19,255),1.12)
        # A fine, warm crease immediately above the descending lid.
        crease=[(x,y-2.1) for x,y in edge[6:-6]]
        line_hi(ink,crease,(145,78,44,150),.48)
        ink=ink.resize((W,H),Image.Resampling.LANCZOS)
        # Clip the ink to the eye edit zone as well.
        ink.putalpha(PIL.ImageChops.multiply(ink.getchannel('A'),outline))
        out=Image.alpha_composite(out,ink);out.putalpha(SRC.getchannel('A'))
    return out

# Mouth coordinates follow the original sloping lip line. The moustache, nose,
# cheek outline and chin outline all remain anchored outside this compact mask.
MOUTH=shape_mask([
 ((188.4,139.9),(184,136),(187,126),(193.5,121.2)),
 ((193.5,121.2),(205,113.2),(225,103),(242,99)),
 ((242,99),(248,95.4),(251,95.3),(249,103.2)),
 ((249,103.2),(248,108.5),(245,112),(244,115)),
 ((244,115),(246,114.8),(249,115.7),(249.8,117.8)),
 ((249.8,117.8),(245.5,121),(240,125.3),(231,129.8)),
 ((231,129.8),(218,136),(205,145.3),(195,145.4)),
 ((195,145.4),(190.7,144.9),(189.4,142.7),(188.4,139.9))
])
# Keep the boundary exact; subpixel antialias is confined to this mask.
C=math.cos(-.43);SN=math.sin(-.43)
TOP=[(-43,7),(-36,2),(-30,-3),(-23,-8),(-12,-11.5),(5,-12.6),(20,-11),(30,-10),(35,-5),(42,6)]

def interp(x,table):
    if x<=table[0][0]:return table[0][1]
    for (a,b),(c,d) in zip(table,table[1:]):
        if x<=c:return b+(d-b)*(x-a)/(c-a)
    return table[-1][1]

def sample(im,x,y):
    x=max(0,min(W-1.001,x));y=max(0,min(H-1.001,y))
    ix=int(x);iy=int(y);fx=x-ix;fy=y-iy
    q=[im[ix,iy],im[ix+1,iy],im[ix,iy+1],im[ix+1,iy+1]]
    return tuple(round(q[0][k]*(1-fx)*(1-fy)+q[1][k]*fx*(1-fy)+q[2][k]*(1-fx)*fy+q[3][k]*fx*fy) for k in range(4))

def talk(scale=1,horizontal=1,closed=False):
    if scale==1 and horizontal==1:return SRC.copy()
    paint=SRC.copy();p=paint.load();src=SRC.load()
    bbox=MOUTH.getbbox()
    for y in range(bbox[1],bbox[3]):
        for x in range(bbox[0],bbox[2]):
            if not MOUTH.getpixel((x,y)):continue
            u=C*(x-220)+SN*(y-118);v=-SN*(x-220)+C*(y-118)
            # A horizontal deformation tapers to zero at both mouth corners.
            # Invert its monotonic piecewise map, so no source pixels fold.
            def forward_u(z):
                return z*horizontal if abs(z)<=26 else math.copysign(26*horizontal+(abs(z)-26)*(45-26*horizontal)/19,z)
            if abs(u)<=26*horizontal:su=u/horizontal
            else:su=math.copysign(26+(abs(u)-26*horizontal)*19/(45-26*horizontal),u)
            # Horizontal narrowing is strongest within the lips, fades above/below.
            strength=max(0,min(1,(v+17)/5,(24-v)/7))
            su=u+(su-u)*strength
            top=interp(su,TOP)
            bottom=7.5-max(0,abs(su)-20)*.30
            if bottom<top+2:bottom=top+2
            lip_end=bottom+6
            new_bottom=top+(bottom-top)*scale
            new_lip_end=new_bottom+6*(.75 if closed else .92)
            anchor=25
            if v<=top:sv=v
            elif v<new_bottom:sv=top+(v-top)/scale
            elif v<new_lip_end:sv=bottom+(v-new_bottom)*6/(new_lip_end-new_bottom)
            elif v<anchor:sv=lip_end+(v-new_lip_end)*(anchor-lip_end)/(anchor-new_lip_end)
            else:sv=v
            sx=220+C*su-SN*sv;sy=118+SN*su+C*sv
            if sv>lip_end and scale<.8:
                # Fill the vacated aperture with the original stippled skin,
                # rather than elongating the chin. This only touches the lips'
                # original footprint. The source patch is from this same chin.
                tx=220+u*.46;ty=138.8+(v-6)*.36
                skin=sample(src,tx,ty)
                original=sample(src,sx,sy)
                blend=max(0,min(1,(sv-lip_end)/2.2))
                p[x,y]=tuple(round(original[k]*(1-blend)+skin[k]*blend) for k in range(4))
            else:p[x,y]=sample(src,sx,sy)
    out=apply_rgb(SRC,paint,MOUTH)
    if closed:
        # A closed bilabial pose joins both lips near the middle of the original
        # aperture. The upper lip descends as the lower lip rises.
        paint=SRC.copy();pixels=paint.load()
        for y in range(bbox[1],bbox[3]):
            for x in range(bbox[0],bbox[2]):
                if not MOUTH.getpixel((x,y)):continue
                u=C*(x-220)+SN*(y-118);v=-SN*(x-220)+C*(y-118)
                skin=sample(src,220+u*.49,139+(v-6)*.35)
                # Subtle warmer skin directly beneath the moustache.
                warm=max(0,min(1,(10-v)/23))
                pixels[x,y]=(min(255,round(skin[0]+warm*15)),min(255,round(skin[1]+warm*5)),skin[2],255)
        out=apply_rgb(SRC,paint,MOUTH)
        layer=Image.new('RGBA',(W*S,H*S),(0,0,0,0))
        pts=[];lower=[];highlight=[]
        for i in range(100):
            u=-33+i*64/99
            v=.2+1.6*(u/33)**2
            pts.append((220+C*u-SN*v,118+SN*u+C*v))
            lower.append((220+C*u-SN*(v+1.25),118+SN*u+C*(v+1.25)))
            highlight.append((220+C*u-SN*(v+2.25),118+SN*u+C*(v+2.25)))
        line_hi(layer,lower,(177,86,62,255),3.2)
        line_hi(layer,highlight[10:-10],(221,136,94,255),.7)
        line_hi(layer,pts,(62,31,23,255),1.15)
        layer=layer.resize((W,H),Image.Resampling.LANCZOS)
        from PIL import ImageChops
        layer.putalpha(ImageChops.multiply(layer.getchannel('A'),MOUTH))
        out=Image.alpha_composite(out,layer);out.putalpha(SRC.getchannel('A'))
    return out

def main():
    blink_frames=[blink(a) for a in [0,.58,1,.29,0]]
    talk_frames=[SRC.copy(),talk(1.20,1),talk(.42,1.01),talk(1.08,.65),talk(.035,1,True)]
    clips=[]
    for kind,label,frames in [('blink','Přirozené mrknutí',blink_frames),('talk','Mluvení: klid, A, E, O, M',talk_frames)]:
        names=[]
        for i,im in enumerate(frames,1):
            name=f'{kind}-{i:02d}.png';im.save(ROOT/name);names.append(name)
        clips.append(dict(kind=kind,label=label,fps=12,frames=names))
    # A review sheet at 3x facial detail, plus complete full-canvas sprites.
    sheet=Image.new('RGB',(5*294,2*330),(65,69,73));d=ImageDraw.Draw(sheet)
    for row,frames in enumerate([blink_frames,talk_frames]):
        for i,im in enumerate(frames):
            face=im.crop((175,40,273,145)).resize((294,315),Image.Resampling.NEAREST)
            bg=Image.new('RGBA',face.size,(190,190,190,255));bg.alpha_composite(face)
            sheet.paste(bg.convert('RGB'),(i*294,row*330+15))
            d.text((i*294+6,row*330+2),f'{"blink" if row==0 else "talk"} {i+1}',fill='white')
    sheet.save(ROOT/'contact-sheet.png')
    # Exact full RGBA validation, independent of drawing masks.
    srcbytes=SRC.tobytes();sets={};validation={}
    for clip in clips:
        changed=set();unique=set()
        for name in clip['frames']:
            im=Image.open(ROOT/name);assert im.mode=='RGBA' and im.size==SRC.size
            assert im.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
            b=im.tobytes();unique.add(hashlib.sha256(b).hexdigest())
            changed.update(i for i in range(W*H) if b[i*4:i*4+4]!=srcbytes[i*4:i*4+4])
        sets[clip['kind']]=changed
        xs=[i%W for i in changed];ys=[i//W for i in changed]
        validation[clip['kind']]={'changed_bbox':[min(xs),min(ys),max(xs)+1,max(ys)+1], 'unique_frames':len(unique),'changed_pixels_union':len(changed)}
    assert blink_frames[0].tobytes()==srcbytes==blink_frames[-1].tobytes()
    assert validation['blink']['unique_frames']>=4 and validation['talk']['unique_frames']==5
    a=validation['blink']['changed_bbox'];b=validation['talk']['changed_bbox']
    assert a[3]<=b[1] or b[3]<=a[1] or a[2]<=b[0] or b[2]<=a[0]
    assert not sets['blink'] & sets['talk']
    eye_masks=[shape_mask(e['outer']) for e in EYES]
    assert all(any(m.getpixel((i%W,i//W)) for m in eye_masks) for i in sets['blink'])
    assert all(MOUTH.getpixel((i%W,i//W)) for i in sets['talk'])
    validation['invariants']={'source_alpha_preserved':True,'outside_edit_masks_rgba_identical':True,'blink_endpoints_identical_to_source':True,'change_rectangles_disjoint':True,'canvas':[W,H],'fps':12,'frames_per_clip':5}
    (ROOT/'validation.json').write_text(json.dumps(validation,indent=2)+'\n')
    result={'notes':'Dva klipy po pěti snímcích při 12 fps, plátno 355 × 580. Mrknutí pohybuje horními víčky; první a poslední snímek jsou přesnou kopií zdroje. Mluvení obsahuje původní klidový výraz a čtyři odlišné tvary A, E, O a zavřené M. Zachována původní alfa všech snímků i všechny RGBA pixely mimo oddělené oblasti očí a úst. Oči a ústa mají nepřekrývající se obdélníky změn. Pózy vznikají lokálním překreslením víček a deformací původní kresby úst; pětisnímkový klip mluvení je sada póz, ne synchronizace s konkrétní zvukovou stopou.','scripts':['generate.py'],'clips':clips}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(validation,indent=2))

if __name__=='__main__':main()

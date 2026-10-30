"""Reproduce the five-frame blink locally using only Pillow and the source image."""
from pathlib import Path
from math import sin, pi
import json
import shutil
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
SCALE = 12


def cubic(points, steps=100):
    a, b, c, d = points
    return [((1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0],
             (1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1])
            for t in (i/steps for i in range(steps+1))]


def scaled(points):
    return [(round(x*SCALE), round(y*SCALE)) for x, y in points]


EYES = [
    dict(box=(45,39,66,54),
         top=[(46.3,44.5),(49.0,38.2),(60.0,37.9),(63.6,44.1)],
         open=[(46.3,44.5),(50.0,39.0),(60.1,38.2),(63.6,44.1)],
         shut=[(46.3,44.5),(49.0,49.3),(60.5,49.7),(63.6,44.1)],
         bottom=[(46.3,44.5),(47.5,54.8),(62.8,55.2),(63.6,44.1)],
         color=(148,90,65)),
    dict(box=(90,38,108,52),
         top=[(91.4,44.1),(94.1,38.2),(101.1,38.0),(105.5,41.8)],
         open=[(91.4,44.1),(94.1,39.6),(101.3,39.1),(105.5,41.8)],
         shut=[(91.4,44.1),(94.0,48.3),(102.5,47.8),(105.5,41.8)],
         bottom=[(91.4,44.1),(92.7,52.9),(103.9,52.8),(105.5,41.8)],
         color=(143,86,64)),
]


def eyelid(source, eye, amount):
    """Grow a textured upper eyelid over a fixed eye, with fixed canthi."""
    w, h = source.size
    size = (w*SCALE, h*SCALE)
    moving = [tuple(a[k]*(1-amount)+b[k]*amount for k in (0,1))
              for a,b in zip(eye['open'],eye['shut'])]
    upper = cubic(eye['top'])
    seam = cubic(moving)
    mask_hi = Image.new('L', size)
    md = ImageDraw.Draw(mask_hi)
    if amount == 1:
        # The entire original aperture is replaced on closure: no white or
        # pupil fragments can remain below the closed lid seam.
        lower = cubic(eye['bottom'])
        md.polygon(scaled(upper+list(reversed(lower))), fill=255)
    else:
        md.polygon(scaled(upper+list(reversed(seam))), fill=255)
    mask = mask_hi.resize(source.size, Image.Resampling.LANCZOS)
    # Clamp resampling support to the eye-only rectangles.
    clamp = Image.new('L', source.size)
    ImageDraw.Draw(clamp).rectangle((eye['box'][0],eye['box'][1],eye['box'][2]-1,eye['box'][3]-1),fill=255)
    import PIL.ImageChops
    mask = PIL.ImageChops.multiply(mask,clamp)

    # Texture is derived from the character's own nearby skin, rather than
    # a flat fill. The smooth lighting follows the volume of the eyelid.
    skin = source.crop((65,25,83,41)).convert('RGB')
    smooth = skin.filter(ImageFilter.GaussianBlur(1.1))
    paint = source.convert('RGB')
    pp = paint.load()
    for y in range(eye['box'][1],eye['box'][3]):
        for x in range(eye['box'][0],eye['box'][2]):
            u=(x-eye['box'][0])/(eye['box'][2]-eye['box'][0]-1)
            v=(y-eye['box'][1])/(eye['box'][3]-eye['box'][1]-1)
            tx=(x-eye['box'][0])%skin.width
            ty=(y-eye['box'][1])%skin.height
            raw, low=skin.getpixel((tx,ty)),smooth.getpixel((tx,ty))
            light=7*sin(pi*u)*sin(pi*v)-7*(1-v)
            pp[x,y]=tuple(max(0,min(255,round(base+light+0.65*(raw[k]-low[k]))))
                          for k,base in enumerate(eye['color']))
    out = Image.composite(paint,source.convert('RGB'),mask)

    # Follow the moving eyelid margin. Its line is warm brown like the source
    # outlines, and remains finer than the upper eye shadow in the rest pose.
    line_hi=Image.new('RGBA',size)
    d=ImageDraw.Draw(line_hi)
    d.line(scaled(seam),fill=(65,34,23,235),width=round(SCALE*0.85),joint='curve')
    if amount >= .9:
        # A slight lit edge gives the closed lid its thickness.
        ridge=[(x,y-1.1) for x,y in seam[12:88]]
        d.line(scaled(ridge), fill=(183,117,83,110),width=round(SCALE*.65),joint='curve')
    lines=line_hi.resize(source.size,Image.Resampling.LANCZOS)
    line_alpha=PIL.ImageChops.multiply(lines.getchannel('A'),clamp)
    out=Image.composite(lines.convert('RGB'),out,line_alpha)
    out.putalpha(source.getchannel('A'))
    return out


def main():
    source=Image.open(ROOT/'source.png').convert('RGBA')
    assert source.size==(139,108)
    frames=[]
    names=[]
    for number, amount in enumerate((0,.64,1,.36,0),1):
        name=f'frame-{number:02d}.png'
        if amount==0:
            # Copying also preserves the complete PNG byte stream.
            shutil.copyfile(ROOT/'source.png',ROOT/name)
            frame=source.copy()
        else:
            frame=source.copy()
            for eye in EYES:
                frame=eyelid(frame,eye,amount)
            frame.save(ROOT/name)
        names.append(name)
        frames.append(frame)

    # Human-readable inspection sheet, enlarged without smoothing the pixels.
    sheet=Image.new('RGB',(139*5,132),(238,226,209))
    draw=ImageDraw.Draw(sheet)
    for i,frame in enumerate(frames):
        bg=Image.new('RGBA',source.size,(226,215,199,255))
        bg.alpha_composite(frame)
        sheet.paste(bg.convert('RGB'),(i*139,20))
        draw.text((i*139+6,4),f'{i+1} / '+['klid','zavirani','zavreno','otevirani','klid'][i],fill=(40,25,16))
    sheet.resize((139*5*4,132*4),Image.Resampling.NEAREST).save(ROOT/'contact-sheet.png')

    # Verify exact preservation of all protected pixels and all source alpha.
    allowed=Image.new('1',source.size)
    ad=ImageDraw.Draw(allowed)
    for eye in EYES:
        x0,y0,x1,y1=eye['box']
        ad.rectangle((x0,y0,x1-1,y1-1),fill=1)
    src=list(source.getdata())
    for i,frame in enumerate(frames):
        pix=list(frame.getdata())
        assert frame.size==source.size
        assert frame.getchannel('A').tobytes()==source.getchannel('A').tobytes()
        assert all(a==b for a,b,m in zip(src,pix,allowed.getdata()) if not m)
        if i in (0,4):
            assert pix==src
        else:
            assert pix!=src
    assert len({f.tobytes() for f in frames})==4
    result={'notes':'Přirozené mrknutí v pěti snímcích: klid, přivření, zavření, otevření a návrat. Každé víčko sleduje vlastní tvar oka; zorničky se nedeformují. Změny jsou omezeny na oblasti očí (x 45–65, y 39–53 a x 90–107, y 38–51). Původní alfa i všechny pixely mimo tyto oblasti jsou přesně zachovány. První a poslední PNG jsou přesné kopie zdroje. Omezením je drobné rozlišení předlohy; pohyb víček má rozsah několika pixelů.',
            'scripts':['generate.py'],
            'clips':[{'kind':'blink','label':'Přirozené mrknutí','fps':12,'frames':names}]}
    (ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for i,f in enumerate(frames):
        changed=[(j%139,j//139) for j,(a,b) in enumerate(zip(src,f.getdata())) if a!=b]
        bbox=(min(x for x,y in changed),min(y for x,y in changed),max(x for x,y in changed)+1,max(y for x,y in changed)+1) if changed else None
        print(names[i], 'changed pixels:',len(changed),'bbox:',bbox)
    print('Verified: five frames, four distinct poses, exact alpha, exact rest frames, unchanged pixels outside eyes.')

if __name__=='__main__':
    main()

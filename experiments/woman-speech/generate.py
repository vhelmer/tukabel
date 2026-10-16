#!/usr/bin/env python3
"""Asset-specific, deterministic mouth pose study. Pillow only; no AI/API.

All painting/resampling happens inside a fixed mouth footprint. Original upper
and lower teeth are separate texture layers, the lower lip moves with the jaw,
and the mouth cavity/lip silhouettes are drawn at 8x with fitted Bezier curves.
The original RGBA canvas and its entire alpha channel are retained verbatim.
"""
from pathlib import Path
import argparse
import hashlib
import itertools
import json
import math
import shutil
import subprocess
import tempfile

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'src/assets/woman.png'
OUTPUT = Path(__file__).resolve().parent / 'output'
BOX = (429, 256, 489, 309)
SCALE = 8
COLS = 3
FACE = (374, 139, 548, 334)
MOUTH = (420, 249, 494, 310)
INK = (30, 23, 17)
SEQUENCE = [0, 1, 2, 3, 2, 1, 0, 4, 5, 4, 2, 1, 0]
TIMING = [360, 100, 110, 100, 90, 100, 180, 110, 140, 90, 100, 90, 500]
NAMES = ['neutral', 'slight', 'medium', 'open', 'rounded', 'pursed']
LABELS = ['X / A – zavřená', 'B – pootevřená', 'C – střední (originál)',
          'D – otevřená', 'E / O – zaoblená', 'F / U – našpulená']


def bezier(a, b, c, d, steps=32):
    return [tuple((1-t)**3*a[k]+3*(1-t)**2*t*b[k]+3*(1-t)*t*t*c[k]+t**3*d[k]
                  for k in (0, 1)) for t in (i/steps for i in range(steps+1))]


def chain(segments):
    return [p for segment in segments for p in bezier(*segment)]


def points(coords):
    return [((x-BOX[0])*SCALE, (y-BOX[1])*SCALE) for x, y in coords]


def mask_polygon(coords, feather=0):
    result = Image.new('L', ((BOX[2]-BOX[0])*SCALE, (BOX[3]-BOX[1])*SCALE))
    ImageDraw.Draw(result).polygon(points(coords), fill=255)
    return result.filter(ImageFilter.GaussianBlur(feather*SCALE)) if feather else result


# Two fitted retouch islands: remove the original aperture/ink and lower-lip
# crease. Neither nose, cheek fold, jaw silhouette nor eye pixels are included.
ERASE = [
    [(431.4, 262.4), (441, 262), (450, 259.5), (460, 258.6),
     (468, 259), (475, 262.5), (482, 270.5), (484, 280),
     (476, 284.5), (447, 286), (441, 283), (441, 276),
     (436, 274), (433.5, 269.5), (431, 268)],
    [(439.3, 286), (446, 284.5), (468, 283), (475.8, 286),
     (476, 292.5), (470, 298.5), (449, 301), (441, 295)],
]


def retouch_mask():
    high_mask = ImageChops.lighter(*(mask_polygon(p) for p in ERASE))
    native = high_mask.resize((BOX[2]-BOX[0], BOX[3]-BOX[1]), Image.Resampling.LANCZOS)
    return native.filter(ImageFilter.MaxFilter(3)).point(lambda n: 255 if n >= 64 else 0)


def edit_mask(original):
    # Fixed, independently specified union of retouch, lip and aperture stencils.
    # Not inferred from output differences: untouched nose/jaw pixels stay exact.
    result = retouch_mask().filter(ImageFilter.MaxFilter(3))
    for p in POSES.values():
        contour = opening(p['left'],p['upper'],p['right'],p['lower'])
        aperture = mask_polygon(contour).filter(ImageFilter.MaxFilter(4*SCALE+1))
        _, lip = element(original,LIP,sx=p.get('width',1),dx=p.get('lip_x',0),dy=p['lip_y'])
        for high in (aperture,lip):
            native = high.resize(result.size,Image.Resampling.LANCZOS).point(lambda n:255 if n >= 16 else 0)
            result=ImageChops.lighter(result,native)
    _, lip = element(original,LIP,dy=-8)
    result=ImageChops.lighter(result,lip.resize(result.size,Image.Resampling.LANCZOS).point(lambda n:255 if n >= 16 else 0))
    # Keep the original philtrum mark and nasolabial crease ink verbatim.
    protect=ImageDraw.Draw(result)
    protect.rectangle((0,0,444-BOX[0],261-BOX[1]),fill=0)
    protect.rectangle((0,0,430-BOX[0],275-BOX[1]),fill=0)
    protect.rectangle((483-BOX[0],0,result.width-1,278-BOX[1]),fill=0)
    return result


def clean_skin(original):
    """Harmonic fill using unmodified skin at the boundary, on the small ROI.

    This is a local clean plate, not a face-scale blur or a generated skin patch.
    Red/black relaxation converges the three channels without numpy/OpenCV.
    """
    native = retouch_mask()
    plate = original.crop(BOX).convert('RGB')
    w, h = plate.size
    unknown = [(x,y) for y in range(1,h-1) for x in range(1,w-1) if native.getpixel((x,y))]
    data = [[float(c) for c in rgb] for rgb in plate.getdata()]
    # Warm skin, seeded from a clean patch immediately below the mouth.
    seed = original.getpixel((479, 297))[:3]
    for x,y in unknown:
        data[y*w+x] = list(seed)
    parity = [[(x,y) for x,y in unknown if (x+y)%2 == r] for r in (0,1)]
    for _ in range(550):
        for group in parity:
            for x,y in group:
                i = y*w+x
                for c in range(3):
                    average = sum(data[j][c] for j in (i-1,i+1,i-w,i+w))/4
                    data[i][c] += 1.65*(average-data[i][c])
    plate.putdata([tuple(max(0,min(255,round(c))) for c in rgb) for rgb in data])
    blend = native.filter(ImageFilter.GaussianBlur(0.55))
    # Exterior boundary pixels come from the original, so no rectangular seam.
    result = Image.composite(plate, original.crop(BOX).convert('RGB'), blend)
    return result.resize((w*SCALE,h*SCALE), Image.Resampling.BICUBIC)


UPPER = [(435.8,265.1),(444.2,265.7),(449.2,264),(456.3,261.7),
         (464.6,261.9),(470.8,265.4),(473.5,270.6),(468,270.3),
         (465,269.6),(459.3,271),(457.2,270.6),(454.5,273.2),
         (447.6,273),(444.6,271.8),(444,274.2),(439.7,274.3),(435.9,270.8)]
LOWER = [(445.8,274.3),(449.3,274.2),(450.8,275.5),(454.2,273.5),
         (458.9,273.7),(460.8,275),(463.2,273.2),(467,272.1),
         (469,274),(472.3,271.9),(476.2,273.3),(478.2,278),
         (471,280.2),(463,282.2),(453,283.7),(445.1,282.5),(444.9,278.3)]
LIP = [(439.5,285.9),(447,284.5),(467,283.3),(475,285.8),
       (476,292.3),(470,298.4),(449.5,300),(440.7,294.7)]


def element(original, outline, sx=1, sy=1, dx=0, dy=0, cx=458, cy=271):
    texture = original.crop(BOX).convert('RGB').resize(
        ((BOX[2]-BOX[0])*SCALE,(BOX[3]-BOX[1])*SCALE), Image.Resampling.BICUBIC)
    mask = mask_polygon(outline, 0.18)
    # Inverse transform of this texture layer only; source canvas never moves.
    affine = (1/sx, 0, ((1-1/sx)*(cx-BOX[0])-dx/sx)*SCALE,
              0, 1/sy, ((1-1/sy)*(cy-BOX[1])-dy/sy)*SCALE)
    texture = texture.transform(texture.size, Image.Transform.AFFINE, affine, Image.Resampling.BICUBIC)
    mask = mask.transform(mask.size, Image.Transform.AFFINE, affine, Image.Resampling.BICUBIC)
    return texture, mask


def stroke(image, coords, color, width):
    ImageDraw.Draw(image).line(points(coords), fill=color, width=round(width*SCALE), joint='curve')


def opening(left, upper, right, lower):
    return chain([(left,*upper,right),(right,*lower,left)])


POSES = {
    'slight': dict(left=(434.5,266.6), upper=((451,271),(458,255.7)), right=(479.8,276.3),
                   lower=((467,279.8),(449,282)), upper_y=0, lower_y=-3.7, lip_y=-4.2),
    'open': dict(left=(434.5,266), upper=((451,270),(458.7,255)), right=(481,280.2),
                 lower=((472,293),(449,294)), upper_y=0, lower_y=7.0, lip_y=7.0),
    'rounded': dict(left=(447,266.9), upper=((451,261.3),(464,261)), right=(471.5,274.5),
                    lower=((472.3,289),(447,289)), upper_y=1.5, lower_y=3.2, lip_y=2.7, width=0.65),
    'pursed': dict(left=(448.5,268.5), upper=((451.5,265.2),(461,264.8)), right=(465,274),
                   lower=((465.5,281),(449.5,281)), upper_y=3.5, lower_y=-1.3, lip_y=-7.5, lip_x=-2, width=0.48),
}


def pose(original, plate, name):
    if name == 'medium':
        return original.copy()
    layer = plate.copy()
    if name == 'neutral':
        seam = chain([((434.8,267.2),(442,271),(448,269.8),(454,267.7)),
                      ((454,267.7),(464,265),(472,269.1),(479,274.3))])
        stroke(layer, [(x,y+0.7) for x,y in seam], (149,93,50), 2.8)
        stroke(layer, seam, INK, 1.35)
        stroke(layer, bezier((443,274.8),(452,278.2),(466,276),(473,275.7)), (236,178,115), 0.85)
        lip, mask = element(original, LIP, dy=-8)
        layer.paste(lip, (0,0), mask)
    else:
        p = POSES[name]
        outline = opening(p['left'], p['upper'], p['right'], p['lower'])
        mouth = mask_polygon(outline)
        # Skin lip rim; aperture is not a squashed/resized original mouth.
        shadow = Image.new('RGB', layer.size, (147,91,50))
        rim = mouth.filter(ImageFilter.MaxFilter(2*SCALE+1)).filter(ImageFilter.GaussianBlur(0.45*SCALE))
        layer.paste(shadow, (0,0), rim)
        cavity = Image.new('RGB',layer.size)
        d = ImageDraw.Draw(cavity)
        for y in range(layer.height):
            t = (BOX[1]+y/SCALE-265)/30
            color = tuple(round(a+(b-a)*max(0,min(1,t))) for a,b in zip((31,22,18),(76,40,29)))
            d.line([(0,y),(layer.width,y)], fill=color)
        # A restrained warm tongue plane in open vowels, behind the teeth.
        if name in ('open','rounded'):
            tongue = opening((448 if name=='open' else 450,285), ((454,281),(465,281)), (474 if name=='open' else 470,284), ((471,291),(451,293)))
            ImageDraw.Draw(cavity).polygon(points(tongue), fill=(111,61,45))
            stroke(cavity,bezier((452,286),(458,284),(466,284),(470,285)),(135,76,55),0.55)
        layer.paste(cavity,(0,0),mouth)
        width = p.get('width',1)
        for tooth_outline, dy in [(LOWER,p['lower_y']), (UPPER,p['upper_y'])]:
            if name=='slight' and tooth_outline==LOWER:
                continue  # Lower teeth stay behind the nearly closed lower lip.
            teeth, mask = element(original, tooth_outline, sx=1, dx=0.4 if name=='rounded' else 0, dy=dy)
            layer.paste(teeth,(0,0),ImageChops.multiply(mask,mouth))
        # Pursed U shows no teeth: the lips occlude the dentition.
        if name=='pursed':
            layer.paste(cavity,(0,0),mouth)
        stroke(layer,outline+[outline[0]],INK,1.65 if name!='pursed' else 1.3)
        lip, mask = element(original, LIP, sx=width, dx=p.get('lip_x',0), dy=p['lip_y'])
        layer.paste(lip,(0,0),mask)
        if name=='pursed':
            # Puckering is a lip action, not a small round hole in the face.
            stroke(layer,bezier((448.7,266.5),(453.2,262.5),(460,262.6),(464.5,268)),(177,115,66),0.65)
            stroke(layer,bezier((449.2,279.4),(453,282.3),(461.2,282.2),(465,277.6)),(237,176,110),0.9)
            stroke(layer,bezier((446.5,269.9),(445,272.1),(445.3,275.8),(447.3,277.2)),(153,97,53),0.55)
            stroke(layer,bezier((467.1,271.1),(469,273.4),(469.3,276.3),(467.5,277.7)),(153,97,53),0.55)
    # Feather the retouch islands into original skin and permit the jaw's new
    # contour below them, but keep every pixel outside the fixed ROI unchanged.
    result = original.copy()
    native = layer.resize((BOX[2]-BOX[0],BOX[3]-BOX[1]),Image.Resampling.LANCZOS)
    native = Image.composite(native,original.crop(BOX).convert('RGB'),edit_mask(original))
    result.paste(native,BOX[:2])
    result.putalpha(original.getchannel('A'))
    return result


def sha(filename):
    return hashlib.sha256(filename.read_bytes()).hexdigest()


def diff_mask(a,b):
    channels = ImageChops.difference(a,b).split()
    mask = channels[0]
    for channel in channels[1:]:
        mask = ImageChops.lighter(mask,channel)
    return mask.point(lambda v: 255 if v else 0)


def count(mask):
    return mask.histogram()[255]


def write_json(name,value):
    file = OUTPUT/name
    file.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
    formatter = ROOT/'node_modules/.bin/prettier'
    if formatter.exists():
        subprocess.run([str(formatter),'--write',str(file)],check=True,stdout=subprocess.DEVNULL)


def verify(original, paths):
    allowed = Image.new('L',original.size)
    allowed.paste(edit_mask(original),BOX[:2])
    outside = ImageChops.invert(allowed)
    saved_mask=Image.open(OUTPUT/'mouth-mask.png').convert('L')
    if saved_mask.size!=original.size or saved_mask.tobytes()!=allowed.tobytes():
        raise ValueError('Exported edit mask differs from authored stencils')
    sheet = Image.open(OUTPUT/'spritesheet.png').convert('RGBA')
    atlas=json.loads((OUTPUT/'spritesheet.json').read_text())
    if atlas['animations']['mouthShapes']!=[p.name for p in paths]:
        raise ValueError('Atlas mouth shape order mismatch')
    w,h=original.size
    if sheet.size!=(w*COLS,h*math.ceil(len(paths)/COLS)):
        raise ValueError('Atlas size mismatch')
    for i,name in enumerate(atlas['animations']['mouthShapes']):
        if atlas['frames'][name]['frame']!={'x':i%COLS*w,'y':i//COLS*h,'w':w,'h':h}:
            raise ValueError('Atlas frame metadata mismatch')
    frames=[]
    report=[]
    for i,file in enumerate(paths):
        frame = Image.open(file).convert('RGBA')
        if frame.size!=original.size: raise ValueError('Wrong canvas: '+file.name)
        if frame.getchannel('A').tobytes()!=original.getchannel('A').tobytes(): raise ValueError('Alpha changed: '+file.name)
        mask = diff_mask(frame,original)
        if count(ImageChops.multiply(mask,outside)): raise ValueError('Pixels outside mouth changed: '+file.name)
        w,h=original.size
        tile=sheet.crop(((i%COLS)*w,(i//COLS)*h,(i%COLS+1)*w,(i//COLS+1)*h))
        if tile.tobytes()!=frame.tobytes():raise ValueError('Atlas pixels changed: '+file.name)
        frames.append(frame)
        report.append(dict(frame=file.name,changedPixels=count(mask),changedOutsideMouth=0,alphaIdentical=True,changedBounds=mask.getbbox(),sha256=sha(file)))
    if paths[2].read_bytes()!=SOURCE.read_bytes():raise ValueError('Medium must be original PNG bytes')
    differences=[]
    for a,b in itertools.combinations(range(len(frames)),2):
        changed=count(diff_mask(frames[a],frames[b]))
        if changed<80:raise ValueError('Mouth poses insufficiently distinct')
        differences.append(dict(a=NAMES[a],b=NAMES[b],differentPixels=changed))
    gif=Image.open(OUTPUT/'preview.gif')
    if gif.n_frames!=len(SEQUENCE) or gif.info.get('loop')!=0:raise ValueError('GIF frame count mismatch')
    for i,duration in enumerate(TIMING):
        gif.seek(i)
        if gif.info['duration']!=duration:raise ValueError('GIF timing mismatch')
    return dict(source=str(SOURCE.relative_to(ROOT)),sourceSha256=sha(SOURCE),size=list(original.size),allowedMouthBox=list(BOX),allowedMouthPixels=count(allowed),frames=report,pairwiseDifferences=differences,spritesheetTilesIdentical=True,gifFrames=gif.n_frames)


def font(size):
    file=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    return ImageFont.truetype(str(file),size) if file.exists() else ImageFont.load_default(size=size)


def background(frame):
    bg=Image.new('RGBA',frame.size,(231,222,204,255));bg.alpha_composite(frame)
    return bg.convert('RGB')


def previews(frames):
    contact=Image.new('RGB',(1122,890),(36,31,35))
    d=ImageDraw.Draw(contact)
    for i,frame in enumerate(frames):
        x,y=(i%3)*374,(i//3)*445
        face=background(frame).crop(FACE).resize((348,390),Image.Resampling.LANCZOS)
        contact.paste(face,(x+13,y+42))
        d.text((x+13,y+12),f'{i+1:02}  {LABELS[i]}',font=font(17),fill=(243,216,172))
    contact.save(OUTPUT/'contact.png')
    mouth=Image.new('RGB',(1380,830),(36,31,35));d=ImageDraw.Draw(mouth)
    for i,frame in enumerate(frames):
        x,y=(i%3)*460,(i//3)*415
        mouth.paste(background(frame).crop(MOUTH).resize((444,366),Image.Resampling.LANCZOS),(x+8,y+40))
        d.text((x+10,y+10),LABELS[i],font=font(18),fill=(243,216,172))
    mouth.save(OUTPUT/'mouth-contact.png')
    panels=[]
    for index in SEQUENCE:
        panel=Image.new('RGB',(900,660),(36,31,35));d=ImageDraw.Draw(panel)
        composite=background(frames[index])
        body=composite.resize((407,543),Image.Resampling.LANCZOS)
        panel.paste(body,(-30,78))
        panel.paste(composite.crop(FACE).resize((487,546),Image.Resampling.LANCZOS),(395,58))
        d.text((24,20),'WOMAN / studie mluvení',font=font(24),fill=(243,216,172))
        d.text((400,620),LABELS[index],font=font(21),fill=(243,216,172))
        panels.append(panel)
    # One shared palette prevents inter-frame colour flicker. PNG keeps alpha;
    # GIF deliberately uses an opaque warm background (GIF has no partial alpha).
    palette_source=Image.new('RGB',(900,len(frames)*660))
    for i in range(len(frames)):
        palette_source.paste(panels[SEQUENCE.index(i)],(0,i*660))
    palette=palette_source.quantize(colors=255,method=Image.Quantize.MEDIANCUT)
    quantized=[p.quantize(palette=palette,dither=Image.Dither.NONE) for p in panels]
    quantized[0].save(OUTPUT/'preview.gif',save_all=True,append_images=quantized[1:],duration=TIMING,loop=0,disposal=1,optimize=False)


def self_test(original, paths):
    with tempfile.TemporaryDirectory(prefix='woman-speech-test-') as directory:
        bad=Path(directory)/paths[0].name
        for point,channel,expected in [((410,190),0,'outside mouth'),((456,275),3,'Alpha changed')]:
            image=Image.open(paths[0]).convert('RGBA')
            pixel=list(image.getpixel(point));pixel[channel]^=1
            image.putpixel(point,tuple(pixel));image.save(bad)
            try:
                verify(original,[bad,*paths[1:]])
            except ValueError as error:
                if expected not in str(error):raise
            else:
                raise AssertionError('Verifier accepted a corrupt frame')
    print('Negative controls passed: outside-mouth and alpha corruption rejected')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument(
        '--self-test', action='store_true',
        help='Prove the verifier rejects outside-mask and alpha corruption',
    )
    args = parser.parse_args()
    original = Image.open(SOURCE).convert('RGBA')
    paths = [OUTPUT / f'frame-{i+1:02}-{name}.png' for i, name in enumerate(NAMES)]
    if not args.verify_only:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        plate = clean_skin(original)
        frames = [pose(original, plate, name) for name in NAMES]
        allowed = Image.new('L', original.size)
        allowed.paste(edit_mask(original), BOX[:2])
        allowed.save(OUTPUT / 'mouth-mask.png')
        for i, (frame, file) in enumerate(zip(frames, paths)):
            if i == 2:
                shutil.copyfile(SOURCE, file)
            else:
                frame.save(file, optimize=True)
        w, h = original.size
        sheet = Image.new('RGBA', (w * COLS, h * math.ceil(len(frames) / COLS)))
        for i, frame in enumerate(frames):
            # No alpha mask here: retain even RGB underneath zero alpha.
            sheet.paste(frame, ((i % COLS) * w, (i // COLS) * h))
        sheet.save(OUTPUT / 'spritesheet.png', optimize=True)
        names = [p.name for p in paths]
        atlas = {
            'frames': {
                name: {
                    'frame': {'x': i % COLS * w, 'y': i // COLS * h, 'w': w, 'h': h},
                    'rotated': False,
                    'trimmed': False,
                    'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h},
                    'sourceSize': {'w': w, 'h': h},
                }
                for i, name in enumerate(names)
            },
            'animations': {
                'mouthShapes': names,
                'talk': [names[i] for i in SEQUENCE],
            },
            'meta': {
                'image': 'spritesheet.png',
                'format': 'RGBA8888',
                'size': {'w': sheet.width, 'h': sheet.height},
                'scale': '1',
            },
        }
        write_json('spritesheet.json', atlas)
        previews(frames)
    report = verify(original, paths)
    if args.self_test:
        self_test(original, paths)
    write_json('validation.json', report)
    write_json('poses.json', {
        'source': 'woman.png',
        'region': {
            'x': BOX[0], 'y': BOX[1],
            'width': BOX[2] - BOX[0], 'height': BOX[3] - BOX[1],
        },
        'frames': [p.name for p in paths],
        'mouthShapes': dict(X=0, A=0, B=1, C=2, D=3, E=4, F=5, G=1, H=2),
        'previewSequence': SEQUENCE,
        'previewDurationsMs': TIMING,
        'note': 'Experiment only. Import mouthShapes atlas sequence to preserve zero-based mapping. Medium is original; other poses modify mouth only.',
    })
    print(f'Verified {len(paths)} distinct {original.width}x{original.height} poses; '
          'identical alpha and zero changed pixels outside mouth.')


if __name__ == '__main__':
    main()

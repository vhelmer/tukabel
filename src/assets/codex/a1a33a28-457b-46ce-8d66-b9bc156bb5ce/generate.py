"""Reproduce the five aligned cloud animation frames using only local Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import json
import math

ROOT = Path(__file__).resolve().parent
source = Image.open(ROOT / 'source.png').convert('RGBA')
request = json.loads((ROOT / 'request.json').read_text())
selection = request.get('selection') or request['context']['selection']
polygon = [(p['x'], p['y']) for p in selection]
W, H = source.size
assert (W, H) == (1672, 941)
box = (944, 0, W, 327)
left, top, right, bottom = box
cw, ch = right-left, bottom-top
rgb = source.crop(box).convert('RGB')

# Supersampled boundary, with the feather entirely INSIDE the selection.
scale = 4
large = Image.new('L', (cw*scale, ch*scale))
ImageDraw.Draw(large).polygon(
    [((x-left)*scale, (y-top)*scale) for x, y in polygon], fill=255)
region = large.resize((cw, ch), Image.Resampling.LANCZOS)
region = region.point(lambda v: 255 if v == 255 else 0)
inset = region.filter(ImageFilter.MinFilter(25))
feather = ImageChops.multiply(
    inset.filter(ImageFilter.GaussianBlur(5)), region)

# Cloud support follows the painted cloud edges, including their grey shading.
# An inset around the stationary architecture prevents resampling its outlines.
cloud = Image.new('L', (cw, ch))
cloud.putdata([
    255 if r > 150 and g > 160 and b > 155 and max(r,g,b)-min(r,g,b) < 65 else 0
    for r,g,b in rgb.getdata()
])
cloud = cloud.filter(ImageFilter.MaxFilter(17)).filter(ImageFilter.GaussianBlur(4))
mask = ImageChops.multiply(cloud, feather)
architecture = Image.new('L', (cw, ch), 255)
ad = ImageDraw.Draw(architecture)
# The image's fixed roof and chimney, with a small guard band.
ad.polygon([(0,149),(160,220),(163,159),(221,151),(235,179),
            (232,250),(284,279),(356,327),(0,327)], fill=0)
architecture = architecture.filter(ImageFilter.MinFilter(9))
architecture = architecture.filter(ImageFilter.GaussianBlur(2))
mask = ImageChops.multiply(mask, architecture)
for protected in request.get('protectedRegions', []):
    # Handle rectangular protected regions if present in a future request.
    if isinstance(protected, dict) and all(k in protected for k in ('x','y','width','height')):
        ImageDraw.Draw(mask).rectangle((protected['x']-left, protected['y']-top,
            protected['x']+protected['width']-left,
            protected['y']+protected['height']-top), fill=0)

frames = []
for frame in range(5):
    phase = 2*math.pi*frame/5
    def displaced(x, y):
        # Periodic local deformation: different cloud lobes move slightly
        # differently, rather than relocating the whole cloud bank.
        sx = (x+left-1100)/156
        sy = (y-125)/104
        dx = 1.25*math.sin(phase+sx+0.32*sy) + 0.28*math.sin(phase-sy)
        dy = 0.67*math.cos(phase+0.73*sx-0.6*sy)
        return x+dx, y+dy
    mesh = []
    step = 12
    for y in range(0, ch, step):
        for x in range(0, cw, step):
            x1, y1 = min(x+step,cw), min(y+step,ch)
            corners = [displaced(x,y), displaced(x,y1),
                       displaced(x1,y1), displaced(x1,y)]
            mesh.append(((x,y,x1,y1), tuple(v for p in corners for v in p)))
    warped = rgb.transform((cw,ch), Image.Transform.MESH, mesh,
                           resample=Image.Resampling.BICUBIC)
    edited = Image.composite(warped, rgb, mask).convert('RGBA')
    edited.putalpha(source.crop(box).getchannel('A'))
    output = source.copy()
    output.paste(edited, box[:2])
    filename = f'frame-{frame+1:02d}.png'
    output.save(ROOT / filename)
    frames.append(filename)

# Inspectable native-resolution cloud crops plus full-canvas alignment views.
sheet = Image.new('RGB', (1456, 1110), '#202832')
draw = ImageDraw.Draw(sheet)
for i, filename in enumerate(frames):
    im = Image.open(ROOT / filename)
    x, y = (i%2)*728, (i//2)*370
    draw.text((x+8,y+5), f'{i+1:02d} / 5  |  {i/12:.3f} s', fill='white')
    sheet.paste(im.crop(box).convert('RGB'), (x,y+25))
preview = source.convert('RGB')
preview.thumbnail((700,330))
sheet.paste(preview, (736,765))
sheet.save(ROOT / 'contact-sheet.png')

# Verify original RGBA bytes outside the selected area, and all source alpha.
selected = Image.new('L', source.size)
selected.paste(region, box[:2])
outside = selected.point(lambda v: 255 if v == 0 else 0)
source_bytes = source.tobytes()
unique = set()
for filename in frames:
    im = Image.open(ROOT / filename).convert('RGBA')
    assert im.size == source.size
    assert im.getchannel('A').tobytes() == source.getchannel('A').tobytes()
    diff = ImageChops.difference(im.convert('RGB'), source.convert('RGB'))
    assert ImageChops.multiply(diff, Image.merge('RGB',(outside,)*3)).getbbox() is None
    assert diff.getbbox() is not None
    unique.add(im.tobytes())
assert len(unique) == 5

result = {
    'notes': 'Jemné prostorově proměnlivé vlnění mraků v plynulé pěti­snímkové smyčce. Pohyb je omezen na vybranou oblohu a směrem k hranici výběru slábne. Kostel, komín a okolí zůstávají stabilní; všechny RGBA bajty mimo výběr i původní alfa jsou zachovány. Rozměry všech snímků jsou 1672 × 941. Kvůli délce pěti snímků při 12 fps je pohyb záměrně velmi jemný.',
    'scripts': ['generate.py'],
    'clips': [{'kind':'idle','label':'Jemné vlnění mraků','fps':12,'frames':frames}]
}
(ROOT / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print('Verified: five distinct RGBA frames; original alpha; unchanged pixels outside selection.')

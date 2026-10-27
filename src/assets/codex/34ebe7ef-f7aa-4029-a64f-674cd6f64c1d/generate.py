"""Reproduce the ten aligned ambient frames using only source.png and Pillow.

Small, periodic elastic deformations articulate the hen's head, chest and tail.
The feet, selection border, original alpha and unedited pixels stay fixed.
"""
from pathlib import Path
import hashlib
import json
import math

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
TAU = 2 * math.pi


def smoothstep(a, b, value):
    t = max(0.0, min(1.0, (value - a) / (b - a)))
    return t * t * (3 - 2 * t)


def generate():
    source = Image.open(ROOT / 'source.png').convert('RGBA')
    assert source.size == (1672, 940)
    request = json.loads((ROOT / 'request.json').read_text())
    selection = request.get('selection') or request['context']['selection']
    left = math.ceil(min(p['x'] for p in selection))
    top = math.ceil(min(p['y'] for p in selection))
    right = math.floor(max(p['x'] for p in selection))
    bottom = math.floor(max(p['y'] for p in selection))

    # Confine the deformation to the actual bird and a narrow antialias margin.
    box = (1461, 497, 1516, 546)
    x0, y0, x1, y1 = box
    assert left <= x0 < x1 <= right and top <= y0 < y1 <= bottom
    crop = source.crop(box)
    width, height = crop.size
    support = Image.new('L', crop.size)
    silhouette = [
        (1467, 519), (1470, 516), (1474, 517), (1478, 521),
        (1485, 518), (1490, 516), (1493, 511), (1495, 507),
        (1493, 505), (1495, 502), (1500, 501), (1505, 503),
        (1508, 506), (1509, 512), (1507, 519), (1506, 525),
        (1502, 533), (1497, 538), (1490, 543), (1482, 543),
        (1476, 539), (1473, 535), (1469, 533), (1467, 528),
    ]
    ImageDraw.Draw(support).polygon([(x-x0, y-y0) for x,y in silhouette], fill=255)
    support = support.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(0.8))
    weights = support.load()

    def displacement(x, y, phase):
        ix = max(0, min(width-1, round(x-x0)))
        iy = max(0, min(height-1, round(y-y0)))
        edge = weights[ix, iy] / 255
        # No motion reaches either foot or the ground shadow.
        anchor = 1 - smoothstep(537.0, 543.0, y)
        head = math.exp(-0.5 * (((x-1501)/7.8)**2 + ((y-510)/10.0)**2))
        body = math.exp(-0.5 * (((x-1486)/12.0)**2 + ((y-532)/7.5)**2))
        tail = math.exp(-0.5 * (((x-1471)/4.5)**2 + ((y-523)/6.0)**2))
        sway = math.sin(phase)
        breath = (1-math.cos(phase)) / 2
        # A slight neck-led nod, a breathing arc and a delayed tail movement.
        dx = head * (0.95*sway + 0.12*math.sin(2*phase))
        dx += body * (x-1486) * 0.018 * breath
        dx += tail * 0.28 * (math.sin(phase+0.4)-math.sin(0.4))
        dy = head * (0.38*sway - 0.22*breath)
        dy -= body * 0.48 * breath
        dy += tail * 0.6 * (math.sin(phase-0.4)-math.sin(-0.4))
        return dx*edge*anchor, dy*edge*anchor

    frames = []
    names = []
    for index in range(10):
        # Sample one period without duplicating its endpoint.
        phase = TAU * index / 10
        frame = source.copy()
        if index:
            mesh = []
            for y in range(height):
                for x in range(width):
                    quad = []
                    for px, py in ((x,y), (x,y+1), (x+1,y+1), (x+1,y)):
                        dx, dy = displacement(x0+px, y0+py, phase)
                        quad.extend((px-dx, py-dy))
                    mesh.append(((x,y,x+1,y+1), tuple(quad)))
            warped = crop.transform(crop.size, Image.Transform.MESH, mesh,
                                    resample=Image.Resampling.BICUBIC)
            # Additional taper prevents any change on the patch border.
            blend = support.copy()
            bp = blend.load()
            for y in range(height):
                for x in range(width):
                    border = min(x, y, width-1-x, height-1-y)
                    bp[x,y] = round(bp[x,y] * smoothstep(0, 3, border)
                                    * (1-smoothstep(537, 543, y+y0)))
            edited = Image.composite(warped, crop, blend)
            edited.putalpha(crop.getchannel('A'))
            frame.paste(edited, box[:2])

        # Check raw bytes, including alpha; do not rely on RGBA getbbox alone.
        assert frame.getchannel('A').tobytes() == source.getchannel('A').tobytes()
        outside = frame.copy()
        outside.paste(source.crop(box), box[:2])
        assert outside.tobytes() == source.tobytes()
        diff = ImageChops.difference(frame, source).convert('RGB').getbbox()
        if index:
            assert diff is not None
            assert x0 <= diff[0] < diff[2] <= x1
            assert y0 <= diff[1] < diff[3] <= y1
        name = f'frame-{index+1:02d}.png'
        frame.save(ROOT / name)
        names.append(name)
        frames.append(frame)

    assert len({hashlib.sha256(f.tobytes()).digest() for f in frames}) == 10
    assert frames[0].tobytes() == source.tobytes()

    # Inspection sheet: enlarged selection crops, all ten actual output frames.
    thumb_box = (1451, 491, 1520, 562)
    scale = 4
    tw, th = 69*scale, 71*scale
    sheet = Image.new('RGB', (5*tw, 2*(th+24)), '#eee7db')
    draw = ImageDraw.Draw(sheet)
    for i, frame in enumerate(frames):
        tx, ty = (i%5)*tw, (i//5)*(th+24)
        sheet.paste(frame.crop(thumb_box).resize((tw,th), Image.Resampling.NEAREST), (tx,ty+24))
        draw.text((tx+8,ty+6), f'{i+1:02d} / 10   {i/12:.3f} s', fill='#30251e')
    sheet.save(ROOT / 'contact-sheet.png')

    result = {
        'notes': 'Jemná plynulá smyčka slepice: kývnutí hlavy, dýchání a lehký pohyb ocasu. '
                 'Nohy zůstávají ukotvené; plátno má 1672 × 940 px a původní alfa je zachována. '
                 'Všechny pixely mimo upravenou oblast uvnitř výběru jsou přesně původní. '
                 'Deset různých snímků tvoří periodu bez zdvojeného koncového snímku. '
                 'Omezení: jde o jemnou 2D deformaci malé slepice z jediného obrázku, '
                 'bez domýšlení zakrytých částí či nových detailů.',
        'scripts': ['generate.py'],
        'clips': [{'kind': 'idle', 'label': 'Slepice – klidné dýchání a kývnutí',
                   'fps': 12, 'frames': names}],
    }
    (ROOT / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print('Validated: 10 distinct RGBA frames, 1672x940, original alpha, fixed exterior.')


if __name__ == '__main__':
    generate()

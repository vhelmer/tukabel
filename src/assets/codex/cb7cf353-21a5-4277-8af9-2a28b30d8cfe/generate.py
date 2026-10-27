"""Reproduce the five-frame smoke loop using only Python and Pillow."""
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
FPS = 12
COUNT = 5


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def sample_bilinear(pixels, x, y):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    return tuple(round(
        pixels[ix, iy][c] * (1 - fx) * (1 - fy)
        + pixels[ix + 1, iy][c] * fx * (1 - fy)
        + pixels[ix, iy + 1][c] * (1 - fx) * fy
        + pixels[ix + 1, iy + 1][c] * fx * fy
    ) for c in range(3))


def main():
    source = Image.open(ROOT / 'source.png').convert('RGBA')
    assert source.size == (1672, 940)
    request = json.loads((ROOT / 'request.json').read_text())
    selection = request.get('selection') or request['context']['selection']
    left, right = min(p['x'] for p in selection), max(p['x'] for p in selection)
    top, bottom = min(p['y'] for p in selection), max(p['y'] for p in selection)

    # A generous feathered envelope around the existing smoke, ending above
    # the chimney. Only its interior is warped; no object is translated.
    envelope = Image.new('L', source.size)
    draw = ImageDraw.Draw(envelope)
    draw.polygon([
        (1548, 299), (1548, 276), (1546, 259), (1553, 244),
        (1552, 231), (1562, 219), (1564, 207), (1576, 195),
        (1576, 180), (1583, 166), (1587, 153), (1595, 145),
        (1596, 129), (1608, 119), (1627, 111), (1640, 116),
        (1641, 106), (1655, 102), (1671, 104), (1671, 166),
        (1657, 170), (1651, 184), (1636, 191), (1642, 201),
        (1634, 217), (1620, 228), (1617, 240), (1603, 248),
        (1604, 258), (1588, 272), (1589, 284), (1578, 299),
    ], fill=255)
    envelope = envelope.filter(ImageFilter.GaussianBlur(3.0))
    mask = envelope.load()
    pixels = source.load()
    frames = []
    metrics = []
    # The two cables are approximated locally by their smooth parabolas.
    # An exact-source guard band is wider than the largest displacement,
    # so bilinear sampling never moves or duplicates a cable.
    for index in range(COUNT):
        phase = 2 * math.pi * index / COUNT
        frame = source.copy()
        output = frame.load()
        for y in range(96, 302):
            for x in range(1534, 1672):
                if not (left <= x < right and top <= y < bottom):
                    continue
                weight = mask[x, y] / 255.0
                # The cream cloud touches the top of the smoke envelope.
                # Exclude its bright paint while retaining smoke and sky.
                weight *= 1 - smoothstep(140, 165, min(pixels[x, y][:3]))
                # Fix the image edge and the base of the smoke plume.
                weight *= smoothstep(0, 12, 1671 - x)
                weight *= 1 - smoothstep(254, 294, y)
                u = x - 1620
                cable1 = 172.7 + 0.00040 * u * u
                cable2 = 206.3 + 0.00066 * (x - 1647) ** 2
                distance = min(abs(y - cable1), abs(y - cable2))
                weight *= smoothstep(4.8, 11.0, distance)
                if weight < 0.003:
                    continue
                # Different heights sway with slightly different phases.
                # The analytic field has period 2*pi, including the wrap
                # from frame five back to frame one (no duplicated endpoint).
                height_phase = (y - 190) / 45.0
                dx = weight * (1.85 * math.sin(phase + height_phase)
                               + 0.35 * math.sin(2 * phase - height_phase))
                dy = weight * 0.65 * math.cos(phase + height_phase * 0.7)
                rgb = sample_bilinear(pixels, x + dx, y + dy)
                output[x, y] = rgb + (pixels[x, y][3],)
        name = f'frame-{index + 1:02d}.png'
        frame.save(ROOT / name)
        frames.append(frame)
        difference = ImageChops.difference(source, frame)
        bbox = difference.convert('RGB').getbbox()
        assert bbox is not None
        assert bbox[0] >= math.ceil(left) and bbox[1] >= math.ceil(top)
        assert bbox[2] <= right and bbox[3] <= bottom
        assert frame.getchannel('A').tobytes() == source.getchannel('A').tobytes()
        count = 0
        for yy in range(bbox[1], bbox[3]):
            for xx in range(bbox[0], bbox[2]):
                count += output[xx, yy] != pixels[xx, yy]
        metrics.append({'frame': name, 'changed_bbox': bbox, 'changed_pixels': count})

    for i in range(COUNT):
        for j in range(i):
            assert frames[i].tobytes() != frames[j].tobytes()

    # Enlarged detail plus the original allow inspection of wires, chimney,
    # plume silhouette, and the fixed right canvas edge.
    crop_box = (1508, 88, 1672, 316)
    scale = 2
    panel_w, panel_h = 328, 456
    sheet = Image.new('RGB', (panel_w * 6, panel_h + 34), '#eee8de')
    captions = ['Zdroj'] + [f'Faze {i + 1} / 5' for i in range(COUNT)]
    d = ImageDraw.Draw(sheet)
    for i, im in enumerate([source] + frames):
        sheet.paste(im.crop(crop_box).resize((panel_w, panel_h), Image.Resampling.NEAREST).convert('RGB'), (i * panel_w, 34))
        d.text((i * panel_w + 10, 10), captions[i], fill='#252525')
    sheet.save(ROOT / 'contact-sheet.png')

    result = {
        'notes': 'Jemná plynulá smyčka vlnění kouře nad komínem v pěti odlišných fázích. Zachovány původní rozměry 1672 × 940, poloha scény, komín, elektrická vedení, pevné okraje výběru a veškerý alfa kanál. Všechny RGBA pixely mimo vybranou oblast zůstávají přesně původní. Omezení: jde o lokální deformaci existující kresby; kouř se nově nevytváří ani nerozptyluje. Pět snímků při 12 fps tvoří krátkou smyčku přibližně 0,42 s.',
        'scripts': ['generate.py'],
        'clips': [{
            'kind': 'idle',
            'label': 'Jemné vlnění kouře',
            'fps': FPS,
            'frames': [f'frame-{i + 1:02d}.png' for i in range(COUNT)],
        }],
    }
    (ROOT / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'validated': True, 'frames': metrics}, indent=2))


if __name__ == '__main__':
    main()

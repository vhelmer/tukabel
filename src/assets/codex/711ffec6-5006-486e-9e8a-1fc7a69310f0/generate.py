"""Reproduce the ten-frame dog idle using only local Pillow and stdlib.

Dense, smoothly supported inverse deformation retains the original drawing.
The feet and distant background stay pinned. No generated or external assets.
"""
from pathlib import Path
import hashlib
import json
import math
from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent
ROI = (41, 491, 218, 603)


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def window(v, a, b, c, d):
    return smooth((v - a) / (b - a)) * smooth((d - v) / (d - c))


def displacement(x, y, phase):
    # Tiny expansion of the rib cage. Support vanishes well above the paws.
    r = math.hypot((x - 126.0) / 54.0, (y - 533.0) / 42.0)
    body = 1.0 - smooth((r - 0.42) / 0.58)
    breath = 0.68 * (1.0 - math.cos(phase))
    dx = body * (x - 126.0) * breath * 0.008
    dy = -body * breath

    # The tail bends about its attachment; the torso is not translated.
    tail = window(x, 43, 53, 79, 98) * window(y, 507, 518, 553, 566)
    angle = 0.105 * math.sin(phase)
    tx, ty = x - 91.0, y - 516.0
    dx += tail * ((math.cos(angle) - 1.0) * tx - math.sin(angle) * ty)
    dy += tail * (math.sin(angle) * tx + (math.cos(angle) - 1.0) * ty)

    # A small sniffing nod, blended into the neck, with the muzzle intact.
    head = window(x, 146, 166, 205, 216) * window(y, 531, 549, 583, 592)
    nod = 0.038 * math.sin(phase)
    hx, hy = x - 165.0, y - 548.0
    dx += head * ((math.cos(nod) - 1.0) * hx - math.sin(nod) * hy
                  + 0.65 * math.sin(phase))
    dy += head * (math.sin(nod) * hx + (math.cos(nod) - 1.0) * hy
                  + 0.20 * math.sin(2.0 * phase))
    return dx, dy


def main():
    source = Image.open(ROOT / 'source.png').convert('RGBA')
    assert source.size == (1672, 940)
    request = json.loads((ROOT / 'request.json').read_text())
    vertices = request.get('selection') or request['context']['selection']
    selection = Image.new('L', source.size, 0)
    ImageDraw.Draw(selection).polygon([(p['x'], p['y']) for p in vertices], fill=255)
    fixed_outside = ImageChops.invert(selection)
    x0, y0, x1, y1 = ROI
    patch = source.crop(ROI)
    w, h = patch.size
    original_alpha = source.getchannel('A')
    paths, rendered, changed_boxes = [], [], []
    hashes = set()
    for index in range(10):
        phase = 2.0 * math.pi * index / 10.0
        frame = source.copy()
        if index:
            # One-pixel mesh cells give a continuous dense warp. Fixed-point
            # inversion avoids the distortions of directly negating the field.
            coordinates = {}
            for yy in range(h + 1):
                for xx in range(w + 1):
                    px, py = float(x0 + xx), float(y0 + yy)
                    sx, sy = px, py
                    for _ in range(4):
                        dx, dy = displacement(sx, sy, phase)
                        sx, sy = px - dx, py - dy
                    coordinates[xx, yy] = (sx - x0, sy - y0)
            mesh = []
            for yy in range(h):
                for xx in range(w):
                    quad = sum((coordinates[p] for p in
                                [(xx, yy), (xx, yy+1), (xx+1, yy+1), (xx+1, yy)]), ())
                    mesh.append(((xx, yy, xx+1, yy+1), quad))
            warped = patch.transform(patch.size, Image.Transform.MESH, mesh,
                                     resample=Image.Resampling.BICUBIC)
            active = Image.new('L', patch.size)
            active.putdata([255 if max(map(abs, displacement(x0+x+0.5, y0+y+0.5, phase))) > 1e-7
                            else 0 for y in range(h) for x in range(w)])
            active = ImageChops.multiply(active, selection.crop(ROI))
            frame.paste(warped, (x0, y0), active)
            # Preserve every original alpha byte, including within the edit.
            frame.putalpha(original_alpha)

        difference = ImageChops.difference(frame, source)
        rgb_diff = difference.convert('RGB')
        assert ImageChops.multiply(rgb_diff, fixed_outside.convert('RGB')).getbbox() is None
        assert ImageChops.difference(frame.getchannel('A'), original_alpha).getbbox() is None
        # All paws and ground contact stay absolutely fixed.
        assert rgb_diff.crop((0, 592, source.width, source.height)).getbbox() is None
        if index == 0:
            assert frame.tobytes() == source.tobytes()
        else:
            assert rgb_diff.getbbox() is not None
        hashes.add(hashlib.sha256(frame.tobytes()).digest())
        name = f'frame-{index+1:02d}.png'
        frame.save(ROOT / name)
        paths.append(name)
        rendered.append(frame)
        changed_boxes.append(rgb_diff.getbbox())
    assert len(hashes) == 10, 'Every animation frame must be genuinely distinct.'

    # Full-resolution close-ups make deformation and registration easy to review.
    crop = (35, 485, 223, 611)
    tw, th = 564, 402
    sheet = Image.new('RGB', (5*tw, 2*th), '#eee8da')
    draw = ImageDraw.Draw(sheet)
    for i, frame in enumerate(rendered):
        x, y = (i % 5)*tw, (i // 5)*th
        sheet.paste(frame.crop(crop).convert('RGB').resize((564, 378), Image.Resampling.NEAREST), (x, y+24))
        draw.text((x+10, y+6), f'{i+1:02d} / 10', fill='#29251f')
    sheet.save(ROOT / 'contact-sheet.png')
    # A local preview, ancillary to the ten full-size PNG deliverables.
    previews = [f.crop(crop).resize((564, 378), Image.Resampling.LANCZOS) for f in rendered]
    previews[0].save(ROOT / 'preview.webp', save_all=True, append_images=previews[1:],
                     duration=[83, 84, 83, 83, 84, 83, 83, 84, 83, 83], loop=0, lossless=True)
    result = {
        'notes': 'Plynulá desetisnímková smyčka psa: jemné kývání ocasem, dech hrudníku a drobný čichací pohyb hlavy. '
                 'Tlapky i poloha psa zůstávají pevné. Rozměr 1672 × 940, všechny původní hodnoty alfa a pixely mimo výběr '
                 'jsou zachovány. První snímek je totožný se zdrojem; fáze navazují přes konec smyčky. '
                 'Omezení: jde o jemnou lokální deformaci jediné kresby, bez nově odhalených částí těla; '
                 'těsně u pohybujícího se obrysu se nepatrně deformuje i okolní podklad. '
                 'Přiložen kontaktní list a animovaný náhled.',
        'scripts': ['generate.py'],
        'clips': [{'kind': 'idle', 'label': 'Pes – klidné očichávání a pohyb ocasu', 'fps': 12, 'frames': paths}]
    }
    (ROOT / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'frames': len(paths), 'unique': len(hashes), 'changed_bounds': changed_boxes,
                      'outside_selection': 'unchanged', 'alpha': 'unchanged', 'feet': 'fixed'}))


if __name__ == '__main__':
    main()

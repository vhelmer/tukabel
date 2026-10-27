"""Reproduce the selected cloud loop locally using Python and Pillow only."""
from pathlib import Path
import hashlib
import json
import math

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
FRAMES = 10
FPS = 6


def inside(x, y, polygon):
    hit = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > y) != (b[1] > y):
            if x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
                hit = not hit
    return hit


def edge_distance(x, y, polygon):
    best = float('inf')
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        vx, vy = b[0] - a[0], b[1] - a[1]
        t = max(0, min(1, ((x-a[0])*vx + (y-a[1])*vy)/(vx*vx+vy*vy)))
        best = min(best, math.hypot(x-a[0]-t*vx, y-a[1]-t*vy))
    return best


def smooth(t):
    t = max(0, min(1, t))
    return t*t*(3-2*t)


def main():
    source = Image.open(ROOT / 'source.png').convert('RGBA')
    assert source.size == (1672, 940)
    request = json.loads((ROOT / 'request.json').read_text())
    selection = request.get('selection') or request['context']['selection']
    polygon = [(p['x'], p['y']) for p in selection]
    # All requested clouds lie here. This crop avoids unnecessary full-frame work.
    cw, ch = 352, 218
    src = source.load()
    clouds = Image.new('L', (cw, ch))
    safe_sky = Image.new('L', (cw, ch))
    cp, sp = clouds.load(), safe_sky.load()
    for y in range(ch):
        for x in range(cw):
            r, g, b, a = src[x, y]
            # Cream cloud pigment and blue sky; exclude hill and shelter pigment.
            cloud = r > 195 and g > 170 and b > 128 and r-b > 12 and r > g
            # Include antialiased blue/cream mixtures along the cloud contour.
            # A strict saturation cutoff would incorrectly pin those contours.
            blue = b > 180 and g > 150
            # The shelter touches the rightmost cloud: retain its occlusion edge.
            in_cloud_region = x < 337 and y < 204
            if in_cloud_region and cloud:
                cp[x, y] = 255
            if in_cloud_region and (cloud or blue):
                sp[x, y] = 255
    # Feather the sky around cloud outlines, retaining the painted edge texture.
    support = clouds.filter(ImageFilter.MaxFilter(19)).filter(ImageFilter.GaussianBlur(3))
    # Smoothly anchor all nearby scenery. No sampled pixel reaches across an object edge.
    safe = safe_sky.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(1.5))
    hp, ap = support.load(), safe.load()
    editable = []
    for y in range(ch):
        for x in range(cw):
            if not inside(x+.5, y+.5, polygon):
                continue
            # Exactly zero outside the original polygon, gently pinned at its edge.
            weight = hp[x, y]/255 * ap[x, y]/255
            weight *= smooth(edge_distance(x+.5, y+.5, polygon)/13)
            if weight > .002 and sp[x, y]:
                editable.append((x, y, weight))

    frames, hashes, bounds, changed_counts = [], [], [], []
    for index in range(FRAMES):
        t = 2*math.pi*index/FRAMES
        frame = source.copy()
        dst = frame.load()
        for x, y, weight in editable:
            # Periodic, spatially varying flow deforms cloud contours locally.
            # Subtract the phase-zero field so frame 01 is the exact source.
            px, py = x/79 + y/103, x/67 - y/121
            dx = weight * (1.15*(math.sin(t+px)-math.sin(px))
                           + .32*(math.sin(2*t-x/57)-math.sin(-x/57)))
            dy = weight * (1.05*(math.sin(t+py)-math.sin(py))
                           + .23*(math.cos(2*t+y/41)-math.cos(y/41)))
            if abs(dx)+abs(dy) < 1e-9:
                continue
            sx, sy = max(0, x+dx), max(0, y+dy)
            ix, iy = math.floor(sx), math.floor(sy)
            fx, fy = sx-ix, sy-iy
            p00, p10 = src[ix, iy], src[ix+1, iy]
            p01, p11 = src[ix, iy+1], src[ix+1, iy+1]
            rgb = tuple(round((1-fy)*((1-fx)*p00[c]+fx*p10[c])
                              + fy*((1-fx)*p01[c]+fx*p11[c])) for c in range(3))
            dst[x, y] = (*rgb, src[x, y][3])
        filename = f'frame-{index+1:02}.png'
        frame.save(ROOT / filename)
        frames.append(filename)
        hashes.append(hashlib.sha256(frame.tobytes()).hexdigest())
        # Independently compare all four channels over the full source canvas.
        different = Image.new('L', source.size)
        dp = different.load()
        changes = 0
        for y in range(source.height):
            for x in range(source.width):
                p, q = src[x, y], dst[x, y]
                assert p[3] == q[3], 'Source alpha changed'
                if p != q:
                    assert inside(x+.5, y+.5, polygon), 'Changed pixel outside selection'
                    dp[x, y] = 255
                    changes += 1
        bounds.append(different.getbbox())
        changed_counts.append(changes)
    assert len(set(hashes)) == FRAMES, 'Duplicate frame'
    assert Image.open(ROOT / frames[0]).tobytes() == source.tobytes()

    # Full-resolution cloud crops make the small contour motion inspectable.
    sheet = Image.new('RGB', (cw*5, (ch+24)*2), '#202831')
    draw = ImageDraw.Draw(sheet)
    for i, name in enumerate(frames):
        ox, oy = (i % 5)*cw, (i // 5)*(ch+24)
        draw.text((ox+8, oy+6), f'{i+1:02}  /  {i/FPS:.3f} s', fill='white')
        sheet.paste(Image.open(ROOT/name).convert('RGB').crop((0, 0, cw, ch)), (ox, oy+24))
    sheet.save(ROOT / 'contact-sheet.png')
    result = {
        'notes': 'Jemné lokální vlnění mraků v označené oblasti. Deset různých snímků, 6 fps, délka smyčky 1,67 s. První snímek odpovídá zdroji; periodický pohyb plynule navazuje přes konec smyčky. Zachovány rozměry 1672 × 940, poloha scény, všechny zdrojové alfa hodnoty a každý RGBA pixel mimo výběr. Omezení: pohyb je záměrně drobný (jednotky pixelů), u hranice výběru a okolních objektů se tlumí; části mraků mimo výběr zůstávají nehybné.',
        'scripts': ['generate.py'],
        'clips': [{'kind': 'idle', 'label': 'Jemné vlnění mraků', 'fps': FPS, 'frames': frames}],
    }
    (ROOT/'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'frames': len(frames), 'unique': len(set(hashes)),
                      'changed_pixels': changed_counts, 'changed_bounds': bounds,
                      'outside_selection': 0, 'alpha_changes': 0}, indent=2))


if __name__ == '__main__':
    main()

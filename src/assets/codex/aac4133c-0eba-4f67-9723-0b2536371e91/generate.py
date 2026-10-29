#!/usr/bin/env python3
"""Reproduce the five-frame, selection-limited cloud loop with Pillow only."""
import json
import math
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent


def main():
    request = json.loads((ROOT / 'request.json').read_text())
    source = Image.open(ROOT / 'source.png').convert('RGBA')
    width, height = source.size
    selection = request.get('selection', request.get('context', {}).get('selection'))
    assert selection, 'An explicit sky selection is required.'
    polygon = [(p['x'], p['y']) for p in selection]
    selected = Image.new('L', source.size)
    ImageDraw.Draw(selected).polygon(polygon, fill=255)

    # Work in a padded sky crop. Selection and foreground masks are evaluated
    # in original coordinates; no rescaling of the delivered frames occurs.
    box = (max(0, int(min(x for x, y in polygon)) - 8),
           max(0, int(min(y for x, y in polygon)) - 8),
           min(width, math.ceil(max(x for x, y in polygon)) + 9),
           min(height, math.ceil(max(y for x, y in polygon)) + 9))
    crop = source.crop(box)
    cw, ch = crop.size
    region = selected.crop(box)
    sky = Image.new('L', crop.size)
    clouds = Image.new('L', crop.size)
    sky.putdata([255 if b > 145 and g > 130 and b > r - 30 and b > g - 25
                 else 0 for r, g, b, a in crop.getdata()])
    clouds.putdata([255 if r > 145 and g > 160 and b > 155
                    and b > r - 30 else 0
                    for r, g, b, a in crop.getdata()])

    # Erode before feathering: all chimney, roof outlines, selection edges,
    # and canvas edges have a stationary guard band. Cloud-adjacent blue sky
    # is included to allow clean movement without double-exposed contours.
    safe = ImageChops.multiply(region, sky).filter(ImageFilter.MinFilter(9))
    inner = safe.filter(ImageFilter.MinFilter(17))
    feather = ImageChops.multiply(inner.filter(ImageFilter.GaussianBlur(7)), safe)
    near_cloud = clouds.filter(ImageFilter.MaxFilter(17)).filter(
        ImageFilter.GaussianBlur(8))
    strength = ImageChops.multiply(feather, near_cloud)
    # Preserve any protected regions should they be supplied in request.json.
    protected = request.get('protectedRegions',
                            request.get('context', {}).get('protectedRegions', []))
    assert not protected, 'This scene request is expected to have no protected regions.'
    field = strength.load()
    permit = strength.point(lambda value: 255 if value else 0)

    def offset(x, y, dx, dy):
        weight = field[min(cw - 1, max(0, x)), min(ch - 1, max(0, y))] / 255.0
        return x - dx * weight, y - dy * weight

    frames = []
    names = []
    for index in range(5):
        phase = 2 * math.pi * index / 5
        # Five equally spaced samples of a closed, differentiable trajectory.
        # Do not duplicate the endpoint: playback supplies the sixth sample
        # by wrapping to frame 1, maintaining the uniform phase interval.
        dx = 1.5 * math.sin(phase)
        dy = 0.30 * (math.cos(phase) - 1)
        output = source.copy()
        if index:
            mesh = []
            step = 6
            for top in range(0, ch, step):
                bottom = min(ch, top + step)
                for left in range(0, cw, step):
                    right = min(cw, left + step)
                    corners = [offset(left, top, dx, dy),
                               offset(left, bottom, dx, dy),
                               offset(right, bottom, dx, dy),
                               offset(right, top, dx, dy)]
                    mesh.append(((left, top, right, bottom),
                                 tuple(v for point in corners for v in point)))
            moved = crop.convert('RGB').transform(
                crop.size, Image.Transform.MESH, mesh, Image.Resampling.BICUBIC)
            # Copy instead of blending the warped image. No ghosted edges.
            patch = Image.composite(moved, crop.convert('RGB'), permit).convert('RGBA')
            patch.putalpha(crop.getchannel('A'))
            output.paste(patch, box[:2])
        name = f'frame-{index + 1:02d}.png'
        output.save(ROOT / name)
        frames.append(output)
        names.append(name)

    notes = ('Jemná uzavřená smyčka pohybu mraků v označené obloze. '
             'Pět různých snímků při 12 fps, původní rozměry 1672 × 941. '
             'Okraje výběru, komín, střecha i ostatní scéna zůstávají pevné; '
             'mimo upravovanou oblast jsou všechny RGBA bajty zachovány, '
             'alfa je zachována všude. Kvůli krátké délce 0,417 s je pohyb '
             'omezen na drobné periodické unášení přibližně o 1,5 pixelu. '
             'Poslední snímek plynule navazuje na první bez zdvojeného konce.')
    result = {'notes': notes, 'scripts': ['generate.py'], 'clips': [
        {'kind': 'idle', 'label': 'Jemné plynutí mraků', 'fps': 12, 'frames': names}]}
    (ROOT / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')

    # Contact sheet contains both scene context and original-scale cloud detail.
    sheet = Image.new('RGB', (1000, 520 * 2), '#202830')
    draw = ImageDraw.Draw(sheet)
    for i, frame in enumerate(frames):
        col, row = i % 2, i // 2
        x, y = col * 500, row * 340
        draw.text((x + 8, y + 5), f'{i + 1:02d} / 5  phase {i * 72} deg', fill='white')
        preview = frame.convert('RGB').resize((480, 270), Image.Resampling.LANCZOS)
        sheet.paste(preview, (x + 8, y + 25))
    sheet.save(ROOT / 'contact-sheet.png')
    detail = Image.new('RGB', (1400, 5 * 260), '#202830')
    for i, frame in enumerate(frames):
        view = frame.crop((970, 30, 1670, 160)).convert('RGB').resize(
            (1400, 260), Image.Resampling.NEAREST)
        detail.paste(view, (0, i * 260))
    detail.save(ROOT / 'cloud-detail-sheet.png')

    # Verify decoded pixels, never compressed PNG file bytes.
    outside = ImageChops.invert(selected)
    summaries = []
    for i, name in enumerate(names):
        actual = Image.open(ROOT / name).convert('RGBA')
        assert actual.size == source.size
        assert actual.getchannel('A').tobytes() == source.getchannel('A').tobytes()
        diff = ImageChops.difference(actual, source)
        rgbdiff = diff.convert('RGB')
        assert not ImageChops.multiply(rgbdiff, outside.convert('RGB')).getbbox()
        foreground_diff = ImageChops.multiply(rgbdiff.crop(box),
                                              ImageChops.invert(safe).convert('RGB'))
        assert not foreground_diff.getbbox(), 'Foreground or guard band changed'
        summaries.append({'frame': name, 'changed_bbox': rgbdiff.getbbox()})
    assert len({frame.tobytes() for frame in frames}) == 5
    assert frames[0].tobytes() == source.tobytes()
    print(json.dumps({'verified': True, 'distinct_frames': 5,
                      'alpha_preserved': True, 'outside_selection_unchanged': True,
                      'frames': summaries}, indent=2))


if __name__ == '__main__':
    main()

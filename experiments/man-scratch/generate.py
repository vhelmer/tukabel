#!/usr/bin/env python3
"""Isolated two-bone arm study. Pillow only. Never calls an API.

prepare writes masks/reference images; render consumes the archived OpenAI clean
plate and exports PNGs/GIF/atlas. Original art is copied, never overwritten.
"""
import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output'
RIG = json.loads((ROOT / 'rig.json').read_text())
SIZE = tuple(RIG['canvas'])
OFFSET = tuple(RIG['offset'])
RESAMPLE = Image.Resampling.LANCZOS


def write_json(name, value):
    file = OUT / name
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    formatter = ROOT.parents[1] / 'node_modules/.bin/prettier'
    if formatter.exists():
        subprocess.run([str(formatter), '--write', str(file)], check=True, stdout=subprocess.DEVNULL)


def point(key):
    return tuple(a + b for a, b in zip(RIG[key], OFFSET))


def source():
    image = Image.open(ROOT / RIG['source']).convert('RGBA')
    result = Image.new('RGBA', SIZE)
    result.paste(image, OFFSET)
    return result


def mask_polygon(points):
    mask = Image.new('L', SIZE)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


def arm_mask():
    return mask_polygon([(x + OFFSET[0], y + OFFSET[1]) for x, y in RIG['arm']])


def face_mask(original):
    # Protect visible face pixels, excluding the hand that originally occluded
    # the scalp. This is an input constraint, never inferred from output diffs.
    rect = mask_polygon([(x+OFFSET[0], y+OFFSET[1]) for x, y in [(165, 35), (290, 35), (290, 175), (165, 175)]])
    visible = original.getchannel('A').point(lambda a: 255 if a else 0)
    return ImageChops.darker(ImageChops.darker(rect, visible), ImageChops.invert(arm_mask()))


def prepare():
    OUT.mkdir(exist_ok=True)
    if not (ROOT / 'source.png').exists():
        raise FileNotFoundError('Missing archived source.png next to rig.json')
    original = source()
    original.save(OUT / 'source-padded.png')
    arm = arm_mask()
    arm.save(OUT / 'arm-mask.png')
    repair = arm.filter(ImageFilter.MaxFilter(9))
    repair.save(OUT / 'repair-mask.png')
    api = original.resize((1024, 1536), RESAMPLE)
    # Transparent RGB from the source must not reveal its former background.
    api.putdata([(r, g, b, a) if a else (0, 0, 0, 0) for r, g, b, a in api.getdata()])
    api.save(OUT / 'api-input.png')
    mask = Image.new('RGBA', SIZE, (255, 255, 255, 255))
    mask.putalpha(ImageChops.invert(repair))
    mask.resize(api.size, Image.Resampling.NEAREST).save(OUT / 'api-mask.png')
    draw = ImageDraw.Draw(original)
    for key, color in [('shoulder', '#ff5959'), ('elbow', '#ffd75d'), ('wrist', '#53dbec')]:
        x, y = point(key)
        draw.ellipse((x-5, y-5, x+5, y+5), fill=color)
        draw.text((x+8, y), key, fill=color)
    review = Image.new('RGBA', SIZE, '#485361')
    review.alpha_composite(original)
    review.convert('RGB').save(OUT / 'rig-preview.png')


def part(original, mask):
    result = original.copy()
    result.putalpha(ImageChops.darker(original.getchannel('A'), mask))
    result = Image.composite(result, Image.new('RGBA', SIZE), result.getchannel('A').point(lambda a: 255 if a else 0))
    return result


def layers(original):
    full = arm_mask()
    upper = mask_polygon([(0, OFFSET[1]+109), (SIZE[0], OFFSET[1]+109), (SIZE[0], SIZE[1]), (0, SIZE[1])])
    fore = Image.new('L', SIZE)
    edge = fore.load()
    for y in range(SIZE[1]):
        coverage = round(255 * max(0, min(1, (OFFSET[1]+137-y)/24)))
        for x in range(SIZE[0]):
            edge[x, y] = coverage
    hand = Image.new('L', SIZE)
    wrist = point('wrist')
    hp = hand.load()
    fp = fore.load()
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            distance = (x-wrist[0])*.76 + (y-wrist[1])*.65
            hp[x, y] = round(255 * max(0, min(1, (9-distance)/12)))
            if distance < -7:
                fp[x, y] = 0
    masks = [ImageChops.darker(full, m) for m in (upper, fore, hand)]
    return [part(original, m) for m in masks]


def angle(a, b):
    return math.atan2(b[1]-a[1], b[0]-a[0])


def solve_arm(target):
    shoulder, elbow, wrist = [point(k) for k in ('shoulder', 'elbow', 'wrist')]
    length1, length2 = math.dist(shoulder, elbow), math.dist(elbow, wrist)
    d = math.dist(shoulder, target)
    along = (length1**2 - length2**2 + d**2) / (2*d)
    height = math.sqrt(max(0, length1**2-along**2))
    ux, uy = (target[0]-shoulder[0])/d, (target[1]-shoulder[1])/d
    options = [(shoulder[0]+along*ux+s*height*-uy, shoulder[1]+along*uy+s*height*ux) for s in (-1, 1)]
    return min(options, key=lambda p: math.dist(p, elbow))


def warp(image, pivot, target, rotation):
    """Rigid rotation + translation only; same scale for every limb segment."""
    c, s = math.cos(rotation), math.sin(rotation)
    tx = target[0] - c*pivot[0] + s*pivot[1]
    ty = target[1] - s*pivot[0] - c*pivot[1]
    scale = 3
    large = image.resize((SIZE[0]*scale, SIZE[1]*scale), RESAMPLE)
    inverse = (c, s, (-c*tx-s*ty)*scale, -s, c, (s*tx-c*ty)*scale)
    # Pillow's RGBa mode interpolates premultiplied colors at transparent edges.
    return large.convert('RGBa').transform(large.size, Image.Transform.AFFINE, inverse, Image.Resampling.BICUBIC).convert('RGBA').resize(SIZE, RESAMPLE)


def composite_background(image, color='#4a5361'):
    background = Image.new('RGBA', SIZE, color)
    background.alpha_composite(image)
    return background.convert('RGB')


def render():
    original = source()
    provider = Image.open(OUT / 'provider-clean-plate.png').convert('RGBA')
    if provider.size != (1024, 1536):
        raise ValueError('Unexpected provider geometry; refusing to stretch the result')
    restored = provider.resize(SIZE, RESAMPLE)
    repair = Image.open(OUT / 'repair-mask.png').convert('L')
    base = Image.composite(restored, original, repair)
    base.save(OUT / 'body.png')
    parts = layers(original)
    protected_face = face_mask(original)
    protected_face.save(OUT / 'face-keep-mask.png')
    for name, image in zip(('upper-arm', 'forearm', 'hand'), parts):
        image.save(OUT / f'{name}.png')
    shoulder, elbow, wrist = [point(k) for k in ('shoulder', 'elbow', 'wrist')]
    frames, transforms = [], []
    support = repair.copy()
    count = RIG['frameCount']
    for index in range(count):
        t = index/(count-1)
        envelope = math.sin(math.pi*t)**2
        stroke = math.sin(t*math.pi*6)
        forearm_rotation = math.radians(envelope*(1+stroke*3))
        c, s = math.cos(forearm_rotation), math.sin(forearm_rotation)
        vx, vy = wrist[0]-elbow[0], wrist[1]-elbow[1]
        target = (elbow[0]+c*vx-s*vy, elbow[1]+s*vx+c*vy)
        moving_elbow = solve_arm(target)
        a1 = angle(shoulder, moving_elbow)-angle(shoulder, elbow)
        a2 = angle(moving_elbow, target)-angle(elbow, wrist)
        a3 = a2 + math.radians(envelope*(-4+stroke*8))
        poses = [warp(parts[0], shoulder, shoulder, a1), warp(parts[1], elbow, moving_elbow, a2), warp(parts[2], wrist, target, a3)]
        frame = base.copy()
        for image in poses:
            frame.alpha_composite(image)
            support = ImageChops.lighter(support, image.getchannel('A').point(lambda a: 255 if a else 0))
        # The upper arm stays fixed while scratching. Restore its attachment to
        # the torso verbatim; the transition lies safely inside the joint overlap.
        static = Image.new('L', SIZE)
        sd = static.load()
        for y in range(SIZE[1]):
            alpha = round(255 * max(0, min(1, (y-OFFSET[1]-136)/14)))
            for x in range(SIZE[0]):
                sd[x, y] = alpha
        frame = Image.composite(original, frame, static)
        frame = Image.composite(original, frame, protected_face)
        if index in (0, count-1):
            frame = original.copy()
        frames.append(frame)
        transforms.append({'shoulderAngle': a1, 'elbowAngle': a2, 'wristAngle': a3, 'wrist': target, 'elbow': moving_elbow})
    support = support.filter(ImageFilter.MaxFilter(7)).point(lambda a: 255 if a else 0)
    support.save(OUT / 'edit-support.png')
    names = []
    for index, frame in enumerate(frames):
        frame = Image.composite(frame, original, support)
        frames[index] = frame
        name = f'frame-{index+1:02d}.png'
        frame.save(OUT / name)
        names.append(name)
    previews = [composite_background(f) for f in frames]
    palette = previews[0].quantize(colors=255).getpalette()
    pal_image = Image.new('P', (1, 1)); pal_image.putpalette(palette)
    gif = [f.quantize(palette=pal_image, dither=Image.Dither.NONE) for f in previews]
    gif[0].save(OUT / 'preview.gif', save_all=True, append_images=gif[1:], duration=[900]+[63]*(count-2)+[900], loop=0, disposal=2)
    sheet = Image.new('RGBA', (SIZE[0]*8, SIZE[1]*4))
    atlas = {}
    for i, (name, frame) in enumerate(zip(names, frames)):
        x, y = i%8*SIZE[0], i//8*SIZE[1]
        sheet.paste(frame, (x, y))
        atlas[name] = {'frame': {'x': x, 'y': y, 'w': SIZE[0], 'h': SIZE[1]}, 'rotated': False, 'trimmed': False, 'spriteSourceSize': {'x': 0, 'y': 0, 'w': SIZE[0], 'h': SIZE[1]}, 'sourceSize': {'w': SIZE[0], 'h': SIZE[1]}}
    sheet.save(OUT / 'spritesheet.png')
    write_json('spritesheet.json', {'frames': atlas, 'animations': {'scratch': names}, 'meta': {'image': 'spritesheet.png', 'scale': '1'}})
    write_json('clip.json', {'label': 'Poškrábání hlavy – vrstvená ruka', 'kind': 'expression', 'source': 'source-padded.png', 'frames': names, 'fps': RIG['fps'], 'loop': False, 'sourceOffset': OFFSET, 'originalSize': Image.open(ROOT / 'source.png').size})
    contact = Image.new('RGB', (4*256, 2*384), '#4a5361')
    for n, i in enumerate((0, 4, 8, 12, 16, 20, 25, 31)):
        tile = previews[i].resize((256, 384), RESAMPLE)
        ImageDraw.Draw(tile).text((8, 8), f'{i+1:02d}', fill='white')
        contact.paste(tile, (n%4*256, n//4*384))
    contact.save(OUT / 'contact.png')
    detail = Image.new('RGB', (4*336, 2*330), '#4a5361')
    for n, i in enumerate((0, 4, 8, 12, 16, 20, 25, 31)):
        tile = previews[i].crop((OFFSET[0]+170, OFFSET[1]-10, OFFSET[0]+394, OFFSET[1]+210)).resize((336, 330), RESAMPLE)
        ImageDraw.Draw(tile).text((8, 8), f'{i+1:02d}', fill='white')
        detail.paste(tile, (n%4*336, n//4*330))
    detail.save(OUT / 'arm-contact.png')
    validate(original, frames, support, transforms)


def validate(original, frames, support, transforms):
    assert len(frames) == RIG['frameCount']
    outside = 0
    face_changes = 0
    protected_face = face_mask(original)
    for frame in frames:
        assert frame.mode == 'RGBA' and frame.size == SIZE
        for pixel, source_pixel, allowed in zip(frame.getdata(), original.getdata(), support.getdata()):
            outside += pixel != source_pixel and not allowed
        for pixel, source_pixel, protected in zip(frame.getdata(), original.getdata(), protected_face.getdata()):
            face_changes += pixel != source_pixel and bool(protected)
    assert outside == 0
    assert face_changes == 0
    assert frames[0].tobytes() == original.tobytes() == frames[-1].tobytes()
    errors = []
    shoulder, elbow, wrist = [point(k) for k in ('shoulder', 'elbow', 'wrist')]
    for pose in transforms:
        errors.extend([abs(math.dist(shoulder, pose['elbow'])-math.dist(shoulder, elbow)), abs(math.dist(pose['elbow'], pose['wrist'])-math.dist(elbow, wrist))])
    assert max(errors) < 1e-8
    atlas = Image.open(OUT / 'spritesheet.png').convert('RGBA')
    for i, frame in enumerate(frames):
        x, y = i%8*SIZE[0], i//8*SIZE[1]
        assert atlas.crop((x, y, x+SIZE[0], y+SIZE[1])).tobytes() == frame.tobytes()
    assert len({f.tobytes() for f in frames}) > 2
    report = {'frameCount': len(frames), 'canvas': SIZE, 'sourceOffset': OFFSET, 'sourceSha256': hashlib.sha256((ROOT / 'source.png').read_bytes()).hexdigest(), 'unchangedOutsideSupport': outside == 0, 'unexpectedPixels': outside, 'protectedFaceChanges': face_changes, 'exactEndpoints': True, 'atlasMatchesFrames': True, 'maxBoneLengthError': max(errors), 'distinctPoses': len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}), 'method': 'original limb layers, two-bone IK with stationary upper arm, forearm/wrist rotations, OpenAI hidden clean plate', 'transforms': transforms}
    write_json('validation.json', report)
    print(json.dumps({k: v for k, v in report.items() if k != 'transforms'}))


def verify():
    saved = json.loads((OUT / 'validation.json').read_text())
    frames = [Image.open(OUT / f'frame-{i+1:02d}.png').convert('RGBA') for i in range(RIG['frameCount'])]
    validate(source(), frames, Image.open(OUT / 'edit-support.png').convert('L'), saved['transforms'])
    # Negative control: the validator must detect an unrelated facial edit.
    changed = frames[5].copy()
    x, y = OFFSET[0]+205, OFFSET[1]+70
    changed.putpixel((x, y), (0, 255, 0, 255))
    try:
        validate(source(), [*frames[:5], changed, *frames[6:]], Image.open(OUT / 'edit-support.png').convert('L'), saved['transforms'])
    except AssertionError:
        print('Negative control: unrelated eye edit correctly rejected')
    else:
        raise AssertionError('Unrelated eye edit was accepted')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'render', 'verify'])
    args = parser.parse_args()
    {'prepare': prepare, 'render': render, 'verify': verify}[args.command]()

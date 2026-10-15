#!/usr/bin/env python3
"""Deterministic, asset-specific eyelid drawing. Requires Pillow 10.2+ only.

No model, eye rescaling, source resampling, or game integration. Coordinates are
hand-fitted to woman.png; a different character needs different eyelid curves.
"""

import argparse
import hashlib
import json
import math
import shutil
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src/assets/woman.png"
OUTPUT = Path(__file__).resolve().parent / "output"
SCALE = 8
FACE = (380, 145, 510, 240)
DURATIONS = [1800, 60, 90, 80, 700]
ATLAS_COLUMNS = 3


def atlas_box(index, size):
    width, height = size
    x, y = index % ATLAS_COLUMNS * width, index // ATLAS_COLUMNS * height
    return (x, y, x + width, y + height)


def curve(start, control1, control2, end, steps=48):
    """Sample a cubic Bezier in original image coordinates."""
    return [
        tuple(
            (1 - t) ** 3 * start[c]
            + 3 * (1 - t) ** 2 * t * control1[c]
            + 3 * (1 - t) * t**2 * control2[c]
            + t**3 * end[c]
            for c in (0, 1)
        )
        for t in (i / steps for i in range(steps + 1))
    ]


# Each contour surrounds only the eyeball and its original ink edge. Brows,
# nose, eye bags and the rest of the drawing are outside these fixed regions.
EYES = [
    {
        "name": "screen-left",
        "outline": [
            [(396.0, 189), (396.5, 182), (401, 177.8), (406, 179)],
            [(406, 179), (416, 180), (425, 186), (428.5, 192)],
            [(428.5, 192), (432, 200), (423, 207.8), (414, 208)],
            [(414, 208), (402, 209), (394, 202), (396.0, 189)],
        ],
        "half": [(397.6, 188), (405, 187.7), (417, 193.4), (427, 194)],
        "closed": [(397.6, 188), (402, 201), (419, 205), (427, 194)],
        "crease": [(400, 184), (406, 180.5), (418, 186), (423, 190)],
        "highlight": [(401, 190), (407, 195), (418, 199), (423, 195)],
        "box": [394, 177, 432, 211],
    },
    {
        "name": "screen-right",
        "outline": [
            [(450, 190), (451, 181), (461, 175), (473, 175.5)],
            [(473, 175.5), (486, 175), (493, 182), (493, 190)],
            [(493, 190), (494, 200), (482, 207.5), (471, 208)],
            [(471, 208), (459, 208.5), (448, 201), (450, 190)],
        ],
        "half": [(451.7, 191), (462, 190), (480, 185), (491, 188)],
        "closed": [(451.7, 191), (462, 204), (483, 203), (491, 188)],
        "crease": [(456, 185), (463, 178), (479, 177), (486, 183)],
        "highlight": [(456, 192), (465, 198), (480, 198), (487, 191)],
        "box": [447, 173, 496, 211],
    },
]


def local_points(points, box):
    return [((x - box[0]) * SCALE, (y - box[1]) * SCALE) for x, y in points]


def contour(eye):
    return [p for segment in eye["outline"] for p in curve(*segment)]


def draw_lid(source, eye, closed):
    box = eye["box"]
    width, height = box[2] - box[0], box[3] - box[1]
    size = (width * SCALE, height * SCALE)
    region = Image.new("L", size)
    ImageDraw.Draw(region).polygon(local_points(contour(eye), box), fill=255)
    # A short feather covers the old antialiased ink without a hard patch edge.
    blend = region.filter(ImageFilter.GaussianBlur(0.38 * SCALE))
    skin = Image.new("RGB", size)
    pixels = skin.load()
    for y in range(size[1]):
        v = y / size[1]
        for x in range(size[0]):
            u = x / size[0]
            dome = math.sin(math.pi * u) ** 0.7
            # Warm ochre lid, rounded highlight, darker lower tarsal edge.
            light = 9 * dome - 34 * v + 8 * math.sin(math.pi * v)
            pixels[x, y] = tuple(round(c + light * k) for c, k in
                                 zip((190, 133, 81), (1, 0.78, 0.52)))

    ink = ImageDraw.Draw(skin)
    seam = curve(*eye["closed" if closed else "half"])
    if not closed:
        # Retain the original globe below the moving lid: the pupil and sclera
        # never move or shrink. Only the occluding eyelid changes silhouette.
        covering = Image.new("L", size)
        upper = [(box[0], box[1]), (box[2], box[1]),
                 (box[2], seam[-1][1])] + list(reversed(seam))
        upper += [(box[0], seam[0][1])]
        ImageDraw.Draw(covering).polygon(local_points(upper, box), fill=255)
        blend = ImageChops.multiply(blend, covering)
    ink.line(local_points(curve(*eye["crease"]), box), fill=(117, 77, 46),
             width=round(0.8 * SCALE))
    if closed:
        ink.line(local_points(curve(*eye["highlight"]), box),
                 fill=(217, 156, 97), width=round(0.8 * SCALE))

    # Lid margin, with a warm narrow shadow underneath and a tapered ink line.
    shadow = [(x, y + 0.65) for x, y in seam]
    ink.line(local_points(shadow, box), fill=(125, 80, 47),
             width=round(2.6 * SCALE))
    ink.line(local_points(seam, box), fill=(30, 23, 16),
             width=round(1.65 * SCALE), joint="curve")
    # The seam must also cover the white at its antialiased margin.
    seam_mask = Image.new("L", size)
    ImageDraw.Draw(seam_mask).line(local_points(seam, box), fill=255,
                                  width=round(2.2 * SCALE))
    blend = ImageChops.lighter(blend, ImageChops.multiply(seam_mask, region))
    skin = skin.resize((width, height), Image.Resampling.LANCZOS)
    blend = blend.resize((width, height), Image.Resampling.LANCZOS)
    # Declare the exact editing footprint before touching any source pixels.
    allowed = Image.new("L", source.size)
    allowed.paste(region.resize((width, height), Image.Resampling.LANCZOS), box)
    allowed = allowed.point(lambda value: 255 if value else 0)
    full_blend = Image.new("L", source.size)
    full_blend.paste(blend, box)
    full_blend = ImageChops.multiply(full_blend, allowed)
    painted = source.convert("RGB")
    painted.paste(skin, box)
    result = Image.composite(painted, source.convert("RGB"), full_blend)
    result.putalpha(source.getchannel("A"))
    return result, allowed


def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(source, paths, allowed, sheet_path):
    """Check the actual exported files, including RGB under transparent pixels."""
    source_pixels = source.tobytes()
    alpha = source.getchannel("A").tobytes()
    mask = allowed.tobytes()
    report = []
    for index, path in enumerate(paths):
        frame = Image.open(path).convert("RGBA")
        if frame.size != source.size:
            raise ValueError(f"Wrong dimensions: {path}")
        if frame.getchannel("A").tobytes() != alpha:
            raise ValueError(f"Alpha changed: {path}")
        data = frame.tobytes()
        changed = [p for p in range(len(mask))
                   if data[p*4:p*4+4] != source_pixels[p*4:p*4+4]]
        outside = sum(not mask[p] for p in changed)
        if outside:
            raise ValueError(f"{outside} changed pixels outside the eyes: {path}")
        if index in (0, 4) and path.read_bytes() != SOURCE.read_bytes():
            raise ValueError("First/last PNG must be byte-for-byte original")
        report.append({"frame": path.name, "changedPixels": len(changed),
                       "changedOutsideEyes": outside, "alphaIdentical": True,
                       "sha256": hash_file(path)})
    sheet = Image.open(sheet_path).convert("RGBA")
    width, height = source.size
    if sheet.size != (width * ATLAS_COLUMNS, height * 2):
        raise ValueError("Wrong spritesheet dimensions")
    for i, path in enumerate(paths):
        tile = sheet.crop(atlas_box(i, source.size))
        if tile.tobytes() != Image.open(path).convert("RGBA").tobytes():
            raise ValueError("Spritesheet tile differs from PNG")
    gif = Image.open(OUTPUT / "preview.gif")
    if gif.n_frames != 5 or gif.info.get("loop") != 0:
        raise ValueError("GIF must have five looping frames")
    for i, duration in enumerate(DURATIONS):
        gif.seek(i)
        if gif.info["duration"] != duration:
            raise ValueError("Wrong GIF timing")
    return {"source": str(SOURCE.relative_to(ROOT)), "sourceSha256": hash_file(SOURCE),
            "size": list(source.size), "allowedEyePixels": sum(bool(v) for v in mask),
            "frames": report, "spritesheetTilesIdentical": True,
            "gifFrames": gif.n_frames, "durationMs": DURATIONS}


def self_test(source, paths, allowed, sheet_path):
    """Prove verification rejects corrupted exports, without touching outputs."""
    with tempfile.TemporaryDirectory(prefix="woman-blink-test-") as directory:
        bad = Path(directory) / "bad.png"
        frame = Image.open(paths[1]).convert("RGBA")
        for point, channel in [((600, 600), 0), ((410, 190), 3)]:
            changed = frame.copy()
            pixel = list(changed.getpixel(point))
            pixel[channel] ^= 1
            changed.putpixel(point, tuple(pixel))
            changed.save(bad)
            try:
                verify(source, [paths[0], bad, *paths[2:]], allowed, sheet_path)
            except ValueError:
                continue
            raise AssertionError("Validator accepted a corrupted frame")
    print("Negative controls passed: outside-eye and alpha corruption rejected")


def preview(frames):
    # GIF has no partial alpha: composite previews on an opaque neutral backdrop.
    previews = []
    for frame in frames:
        panel = Image.new("RGB", (740, 760), (49, 53, 61))
        body = Image.new("RGBA", frame.size, (49, 53, 61, 255))
        body.alpha_composite(frame)
        body = body.convert("RGB")
        panel.paste(body.resize((543, 724), Image.Resampling.LANCZOS), (-100, 25))
        panel.paste(body.crop(FACE).resize((390, 285), Image.Resampling.LANCZOS), (340, 100))
        d = ImageDraw.Draw(panel)
        d.text((350, 70), "Eyelids / 3x detail", fill="white")
        d.text((350, 430), "Original body pixels + local eyelid drawing", fill="white")
        d.text((350, 450), "PNG / spritesheet preserve original alpha", fill="white")
        previews.append(panel)
    # One shared palette prevents temporal color flicker; palette quality is
    # preview-only and never affects the source-sized PNG files.
    palette = previews[0].quantize(colors=256)
    gifs = [p.quantize(palette=palette, dither=Image.Dither.NONE) for p in previews]
    gifs[0].save(OUTPUT / "preview.gif", save_all=True, append_images=gifs[1:],
                 duration=DURATIONS, loop=0, disposal=2, optimize=False)
    contact = Image.new("RGB", (650, 250), (49, 53, 61))
    d = ImageDraw.Draw(contact)
    for i, frame in enumerate(frames):
        crop = Image.new("RGBA", frame.size, (49, 53, 61, 255))
        crop.alpha_composite(frame)
        contact.paste(crop.crop(FACE).convert("RGB"), (130 * i, 30))
        d.text((130 * i + 10, 10), f"{i+1} / {DURATIONS[i]} ms", fill="white")
        eyes = crop.crop((390, 172, 500, 215)).convert("RGB")
        contact.paste(eyes.resize((130, 51)), (130 * i, 150))
    contact.resize((1300, 500), Image.Resampling.NEAREST).save(OUTPUT / "contact.png")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true",
                        help="Check existing exports without regenerating them")
    parser.add_argument("--self-test", action="store_true",
                        help="Also prove pixel/alpha corruption is rejected")
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")
    paths = [OUTPUT / f"frame-{i+1:02d}.png" for i in range(5)]
    sheet_path = OUTPUT / "spritesheet.png"
    if args.verify_only:
        allowed = Image.open(OUTPUT / "eye-regions.png").convert("L")
        print(json.dumps(verify(source, paths, allowed, sheet_path), indent=2))
        if args.self_test:
            self_test(source, paths, allowed, sheet_path)
        return
    allowed = Image.new("L", source.size)
    poses = []
    for closed in (False, True):
        frame = source.copy()
        for eye in EYES:
            frame, mask = draw_lid(frame, eye, closed)
            allowed = ImageChops.lighter(allowed, mask)
        poses.append(frame)
    frames = [source, poses[0], poses[1], poses[0], source]
    for i, (frame, path) in enumerate(zip(frames, paths)):
        if i in (0, 4):
            shutil.copyfile(SOURCE, path)
        else:
            frame.save(path)
    allowed.save(OUTPUT / "eye-regions.png")
    width, height = source.size
    sheet = Image.new("RGBA", (width * ATLAS_COLUMNS, height * 2))
    for i, frame in enumerate(frames):
        sheet.paste(frame, atlas_box(i, source.size)[:2])
    sheet.save(sheet_path)
    metadata = {
        "frames": {path.name: {
            "frame": {"x": atlas_box(i, source.size)[0],
                      "y": atlas_box(i, source.size)[1], "w": width, "h": height},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": width, "h": height},
            "sourceSize": {"w": width, "h": height},
            "duration": DURATIONS[i],
        } for i, path in enumerate(paths)},
        "animations": {"blink": [path.name for path in paths]},
        "meta": {"image": "spritesheet.png", "format": "RGBA8888", "scale": "1",
                 "size": {"w": sheet.width, "h": sheet.height}},
    }
    (OUTPUT / "spritesheet.json").write_text(json.dumps(metadata, indent=2) + "\n")
    preview(frames)
    report = verify(source, paths, allowed, sheet_path)
    (OUTPUT / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if args.self_test:
        self_test(source, paths, allowed, sheet_path)


if __name__ == "__main__":
    main()

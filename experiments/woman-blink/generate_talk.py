#!/usr/bin/env python3
"""Reproducible local jaw movement for the technical layered-animation demo.

Pillow only. Upper teeth stay anchored; lower teeth, lip and adjacent skin move
with a smooth displacement field. The original pixels outside the mouth patch
and the complete alpha channel remain unchanged. This is not a lip-sync track.
"""
from pathlib import Path
from PIL import Image, ImageChops
import math

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src/assets/woman.png"
DEST = ROOT / "src/assets/animations/woman-talk"
PATCH = (428, 267, 488, 304)


def horizontal(x):
    t = max(0.0, min(1.0, (x - PATCH[0]) / (PATCH[2] - PATCH[0])))
    return math.sin(math.pi * t) ** 2


def vertical(y):
    if y <= 270 or y >= 302:
        return 0.0
    t = (y - 270) / 12 if y < 282 else (302 - y) / 20
    return (1 - math.cos(math.pi * t)) / 2


def frame(original, distance):
    result = original.copy()
    pixels = original.load()
    for y in range(PATCH[1], PATCH[3]):
        for x in range(PATCH[0], PATCH[2]):
            weight = distance * horizontal(x)
            low, high = y - distance, y
            for _ in range(20):
                middle = (low + high) / 2
                if middle + weight * vertical(middle) < y:
                    low = middle
                else:
                    high = middle
            sy = (low + high) / 2
            if abs(sy - y) < 0.001:
                continue
            iy = math.floor(sy)
            fraction = sy - iy
            rgb = tuple(round(pixels[x, iy][c] * (1 - fraction) + pixels[x, iy + 1][c] * fraction) for c in range(3))
            result.putpixel((x, y), (*rgb, pixels[x, y][3]))
    diff = ImageChops.difference(original.convert('RGB'), result.convert('RGB'))
    outside = diff.copy()
    outside.paste((0, 0, 0), PATCH)
    assert outside.getbbox() is None
    assert original.getchannel('A').tobytes() == result.getchannel('A').tobytes()
    return result


if __name__ == '__main__':
    original = Image.open(SOURCE).convert('RGBA')
    DEST.mkdir(parents=True, exist_ok=True)
    for index, distance in [(2, 2.5), (3, 5.0)]:
        image = frame(original, distance)
        image.save(DEST / f'frame-{index:02}.png', optimize=True)
        print(f'frame-{index:02}: changed pixels bbox', ImageChops.difference(original.convert('RGB'), image.convert('RGB')).getbbox())

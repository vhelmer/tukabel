#!/usr/bin/env python3
"""Restore source moustache pixels in talk-04/05; leave all other frames untouched.

Run: python3 repair_moustache.py [--verify-only]
generate.py also uses preserve_moustache when reproducing the two mouth poses.
"""
import argparse
import hashlib
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
TARGETS = ("talk-04.png", "talk-05.png")
# Lower edge follows the moustache ABOVE the original yellow teeth. All points
# are original source pixels, with no scaling or feathering of the source ink.
LOWER_EDGE = [
    (193, 93), (197, 97), (201, 100), (204, 102), (207, 105),
    (210, 108), (214, 110), (218, 111), (222, 112), (226, 113),
    (230, 114), (234, 114), (238, 113), (242, 113), (246, 112),
    (250, 110), (254, 109), (258, 108), (263, 107), (267, 105),
]


def protected_mask(size):
    if size != (302, 613):
        raise ValueError("This preservation mask belongs to the 302 x 613 source.")
    mask = Image.new("L", size)
    ImageDraw.Draw(mask).polygon(
        [(190, 88), (268, 88)] + list(reversed(LOWER_EDGE)), fill=255
    )
    return mask


def preserve_moustache(frame, source):
    if frame.size != source.size:
        raise ValueError("Frame dimensions must match the original.")
    result = frame.copy()
    result.paste(source, (0, 0), protected_mask(source.size))
    return result


def verify(frame, source):
    if frame.size != source.size or frame.mode != "RGBA":
        raise AssertionError("Canvas or color mode changed.")
    if frame.getchannel("A").tobytes() != source.getchannel("A").tobytes():
        raise AssertionError("Original alpha changed.")
    mask = protected_mask(source.size)
    for original, current, protected in zip(
        source.getdata(), frame.getdata(), mask.getdata()
    ):
        if protected and current != original:
            raise AssertionError("Moustache differs from the original pixels.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    source = Image.open(ROOT / "source.png").convert("RGBA")
    untouched = {
        p: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in ROOT.glob("*.png")
        if p.name not in TARGETS
    }
    mask = protected_mask(source.size)
    for name in TARGETS:
        file = ROOT / name
        before = Image.open(file).convert("RGBA")
        result = before if args.verify_only else preserve_moustache(before, source)
        verify(result, source)
        changed = 0
        for old, new, protected in zip(
            before.getdata(), result.getdata(), mask.getdata()
        ):
            if old != new:
                if not protected:
                    raise AssertionError("A pixel outside the moustache changed.")
                changed += 1
        if changed:
            temporary = file.with_suffix(".tmp.png")
            result.save(temporary)
            temporary.replace(file)
        print(f"{name}: verified; restored {changed} pixels; changes outside mask: 0")
    for file, original_hash in untouched.items():
        if hashlib.sha256(file.read_bytes()).hexdigest() != original_hash:
            raise AssertionError(f"Unrelated file changed: {file.name}")
    print("Other frames/source are byte-identical; original alpha is preserved.")


if __name__ == "__main__":
    main()

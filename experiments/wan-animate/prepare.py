#!/usr/bin/env python3
"""Prepare local Wan inputs without changing or publishing the driving video."""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path

import av
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video', type=Path)
    parser.add_argument('comfyui', type=Path)
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'man-scratch/source.png')
    parser.add_argument('--start', type=float, default=0.7)
    parser.add_argument('--frames', type=int, default=49)
    parser.add_argument('--fps', type=int, default=16)
    mirror = parser.add_mutually_exclusive_group()
    mirror.add_argument('--mirror', dest='mirror', action='store_true')
    mirror.add_argument('--no-mirror', dest='mirror', action='store_false')
    parser.set_defaults(mirror=False)
    args = parser.parse_args()
    if args.start < 0 or args.frames < 1 or args.frames % 4 != 1 or args.fps < 1:
        parser.error('Use a positive fps, nonnegative start and 4n+1 frames')
    inputs = args.comfyui.resolve() / 'input'
    if not (args.comfyui / 'main.py').is_file():
        parser.error('Expected an existing ComfyUI directory')
    inputs.mkdir(exist_ok=True)
    size = (320, 512)
    original = Image.open(args.source).convert('RGBA')
    reference = Image.new('RGBA', size, '#b2b0a5')
    fitted = ImageOps.contain(original, (288, 464), Image.Resampling.LANCZOS)
    offset = ((size[0] - fitted.width)//2, (size[1] - fitted.height)//2)
    reference.alpha_composite(fitted, offset)
    reference.convert('RGB').save(inputs / 'tukabel-wan-character.png')

    targets = [args.start + i/args.fps for i in range(args.frames)]
    frames = []
    with av.open(str(args.video)) as source:
        for frame in source.decode(video=0):
            seconds = float(frame.pts * frame.time_base)
            while len(frames) < len(targets) and seconds >= targets[len(frames)]:
                image = frame.to_image().convert('RGB')
                if args.mirror:
                    image = ImageOps.mirror(image)
                frames.append(image)
            if len(frames) == len(targets):
                break
    if len(frames) != args.frames:
        raise ValueError('The requested segment extends beyond the source video')
    with av.open(str(inputs / 'tukabel-scratch-driving.mp4'), 'w') as output:
        stream = output.add_stream('libx264', rate=Fraction(args.fps))
        stream.width, stream.height = frames[0].size
        stream.pix_fmt = 'yuv420p'
        stream.options = {'crf': '16', 'preset': 'medium'}
        for image in frames:
            for packet in stream.encode(av.VideoFrame.from_image(image)):
                output.mux(packet)
        for packet in stream.encode():
            output.mux(packet)
    metadata = {
        'sourceSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
        'drivingVideoSha256': hashlib.sha256(args.video.read_bytes()).hexdigest(),
        'drivingVideoName': args.video.name,
        'startSeconds': args.start, 'frames': args.frames, 'fps': args.fps,
        'mirror': args.mirror, 'canvas': size,
        'sourceSize': original.size, 'referenceSize': fitted.size,
        'referenceOffset': offset,
        'note': 'Driving video stays local; only pose data conditions the animation.',
    }
    (ROOT / 'inputs.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()

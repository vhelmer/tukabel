#!/usr/bin/env python3
"""Archive a generated video and render inspection sheets without altering frames."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

import av
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video', type=Path)
    parser.add_argument('--prefix', default='', choices=['', 'fast-', 'idle-'])
    parser.add_argument('--prompt-only', action='store_true')
    args = parser.parse_args()
    def output(name):
        return ROOT / (args.prefix + name)
    with av.open(str(args.video)) as source:
        stream = source.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_image().convert('RGB') for frame in source.decode(stream)]
    if not frames or len({frame.size for frame in frames}) != 1:
        raise ValueError('Expected equally sized, nonempty frames')
    shutil.copyfile(args.video, output('result.mp4'))
    frames[0].save(output('preview.gif'), save_all=True, append_images=frames[1:],
                   duration=round(1000/fps), loop=0)
    indices = [round(i*(len(frames)-1)/7) for i in range(8)]
    contact = Image.new('RGB', (320*4, (512+24)*2), '#262729')
    hands = Image.new('RGB', (240*4, 220*2), '#262729')
    for cell, index in enumerate(indices):
        image = frames[index]
        contact.paste(image, ((cell % 4)*320, (cell//4)*536))
        ImageDraw.Draw(contact).text(((cell % 4)*320+8, (cell//4)*536+514),
                                     f'{index+1} / {len(frames)}', fill='white')
        hands.paste(image.crop((170, 20, 290, 118)).resize((240, 196)),
                    ((cell % 4)*240, (cell//4)*220))
        ImageDraw.Draw(hands).text(((cell % 4)*240+8, (cell//4)*220+198),
                                   f'{index+1} / {len(frames)}', fill='white')
    contact.save(output('contact.png'))
    hands.save(output('hands.png'))
    report = {
        'frames': len(frames), 'canvas': frames[0].size, 'fps': fps,
        'durationSeconds': len(frames)/fps,
        'distinctDecodedFrames': len({hashlib.sha256(frame.tobytes()).hexdigest() for frame in frames}),
        'videoSha256': hashlib.sha256(args.video.read_bytes()).hexdigest(),
        'comfyOutput': str(args.video),
        'transparency': False,
        'method': ('Wan2.2 Animate generates new RGB frames from the reference image and text only; no driving video or pose.'
                   if args.prompt_only else 'Wan2.2 Animate generates new RGB frames from the reference image and retargeted DWPose control.'),
        'note': 'This is a motion-transfer quality experiment, not a pixel-preserving sprite edit or finished transparent loop.',
    }
    output('result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

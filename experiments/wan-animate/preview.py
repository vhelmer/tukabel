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
    parser.add_argument('--prefix', default='', choices=['', 'fast-', 'idle-', 'ti2v-'])
    parser.add_argument('--prompt-only', action='store_true')
    parser.add_argument('--model', default='Wan2.2 Animate', choices=['Wan2.2 Animate', 'Wan2.2 TI2V-5B'])
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
    durations = [round((i+1)*100/fps)*10-round(i*100/fps)*10 for i in range(len(frames))]
    frames[0].save(output('preview.gif'), save_all=True, append_images=frames[1:],
                   duration=durations, loop=0)
    indices = [round(i*(len(frames)-1)/7) for i in range(8)]
    width, height = frames[0].size
    thumb_height = round(height*320/width)
    contact = Image.new('RGB', (320*4, (thumb_height+24)*2), '#262729')
    hands = Image.new('RGB', (240*4, 220*2), '#262729')
    for cell, index in enumerate(indices):
        image = frames[index]
        thumbnail = image.resize((320, thumb_height), Image.Resampling.LANCZOS)
        contact.paste(thumbnail, ((cell % 4)*320, (cell//4)*(thumb_height+24)))
        ImageDraw.Draw(contact).text(((cell % 4)*320+8, (cell//4)*(thumb_height+24)+thumb_height+2),
                                     f'{index+1} / {len(frames)}', fill='white')
        box = (round(width*170/320), round(height*20/512), round(width*290/320), round(height*118/512))
        hands.paste(image.crop(box).resize((240, 196)),
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
        'model': args.model,
        'method': (f'{args.model} generates new RGB frames from the reference image and text only; no driving video or pose.'
                   if args.prompt_only else f'{args.model} generates new RGB frames from the reference image and retargeted DWPose control.'),
        'note': 'Generative motion experiment; original pixels, transparency and a finished loop are not guaranteed.',
    }
    output('result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

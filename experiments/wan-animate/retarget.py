#!/usr/bin/env python3
"""Adapt the extracted arm movement to this cartoon's full-body proportions.

This produces a skeleton control video, never warped character pixels.
Wan generates the actual animation separately from this control and reference.
"""
import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import sys

import av
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
BODY = [
    (267, 94), (233, 183), (108, 171), (28, 270), (88, 283),
    (289, 177), (358, 119), (284, 64), (144, 361), (128, 446),
    (109, 544), (266, 365), (280, 441), (260, 530),
    (212, 68), (260, 53), (165, 115), None,
]


def points(values):
    if not values:
        return None
    return np.asarray(values, dtype=float).reshape(-1, 3)


def rotate(angle):
    c, s = math.cos(angle), math.sin(angle)
    return np.array([[c, -s], [s, c]])


def angle(vector):
    return math.atan2(vector[1], vector[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('poses', type=Path, help='DWPose driving-pose JSON')
    parser.add_argument('comfyui', type=Path)
    parser.add_argument('--max-arm-degrees', type=float, default=25)
    parser.add_argument('--max-forearm-degrees', type=float, default=55)
    args = parser.parse_args()
    if not all(0 < value <= 90 for value in [args.max_arm_degrees, args.max_forearm_degrees]):
        parser.error('Motion limits must be between 0 and 90 degrees')
    sys.path.insert(0, str(args.comfyui / 'custom_nodes/comfyui_controlnet_aux/src'))
    from custom_controlnet_aux.dwpose import decode_json_as_poses, draw_poses

    metadata = json.loads((ROOT / 'inputs.json').read_text())
    size = metadata['canvas']
    sx = metadata['referenceSize'][0] / metadata['sourceSize'][0]
    sy = metadata['referenceSize'][1] / metadata['sourceSize'][1]
    offset = np.asarray(metadata['referenceOffset'])
    target = np.asarray([
        [*(np.asarray(p)*[sx, sy]+offset), 1] if p else [0, 0, 0]
        for p in BODY
    ])
    frames = json.loads(args.poses.read_text())
    people = []
    for frame in frames:
        if len(frame['people']) != 1:
            raise ValueError('This isolated example expects exactly one person per frame')
        person = frame['people'][0]
        body = points(person['pose_keypoints_2d'])
        if body is None or np.any(body[[5, 6, 7], 2] < 1):
            raise ValueError('The active shoulder, elbow and wrist must be visible in every frame')
        people.append(person)
    drivers = np.asarray([points(p['pose_keypoints_2d']) for p in people])
    angles = np.unwrap(np.asarray([
        [angle(p[6, :2]-p[5, :2]), angle(p[7, :2]-p[6, :2])]
        for p in drivers
    ]), axis=0)
    # Suppress detector jitter, while preserving the observed scratching motion.
    angles = np.asarray([np.mean(angles[max(0, i-1):i+2], axis=0) for i in range(len(angles))])
    limits = np.radians([args.max_arm_degrees, args.max_forearm_degrees])
    changes = np.clip(angles - angles[0], -limits, limits)
    arm = target[6, :2] - target[5, :2]
    forearm = target[7, :2] - target[6, :2]
    base_hand = points(people[0].get('hand_left_keypoints_2d'))
    hand_transform = None
    if base_hand is not None and np.all(base_hand[[0, 9], 2] == 1):
        palm = base_hand[9, :2] - base_hand[0, :2]
        hand_transform = rotate(math.radians(-120) - angle(palm)) * (24*sx / np.linalg.norm(palm))

    rendered, retargeted = [], []
    for i, person in enumerate(people):
        body = target.copy()
        body[6, :2] = body[5, :2] + rotate(changes[i, 0]) @ arm
        body[7, :2] = body[6, :2] + rotate(changes[i, 1]) @ forearm
        hand = points(person.get('hand_left_keypoints_2d'))
        hand_data = None
        if hand_transform is not None and hand is not None and hand[0, 2] == 1:
            hand[:, :2] = (hand[:, :2] - hand[0, :2]) @ hand_transform.T + body[7, :2]
            hand_data = hand.flatten().tolist()
        result = {'canvas_width': size[0], 'canvas_height': size[1], 'people': [{
            'pose_keypoints_2d': body.flatten().tolist(),
            'hand_left_keypoints_2d': hand_data,
            'hand_right_keypoints_2d': None, 'face_keypoints_2d': None,
        }]}
        poses, _, height, width = decode_json_as_poses(result)
        rendered.append(Image.fromarray(draw_poses(poses, height, width, draw_body=True,
                                                  draw_hand=True, draw_face=False)))
        retargeted.append(result)
    output = args.comfyui / 'input/tukabel-scratch-pose.mp4'
    with av.open(str(output), 'w') as container:
        stream = container.add_stream('libx264', rate=Fraction(metadata['fps']))
        stream.width, stream.height = size
        stream.pix_fmt = 'yuv420p'
        stream.options = {'crf': '12'}
        for image in rendered:
            for packet in stream.encode(av.VideoFrame.from_image(image)):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    (ROOT / 'retargeted-pose.json').write_text(json.dumps(retargeted, indent=2) + '\n')
    (ROOT / 'retarget.json').write_text(json.dumps({
        'limitsDegrees': np.degrees(limits).tolist(),
        'maxArmDeltaDegrees': np.degrees(np.max(np.abs(changes), axis=0)).tolist(),
        'frames': len(rendered), 'handDetected': hand_transform is not None,
    }, indent=2) + '\n')
    rendered[0].save(ROOT / 'pose-preview.gif', save_all=True, append_images=rendered[1:],
                     duration=round(1000/metadata['fps']), loop=0)
    reference = Image.open(args.comfyui / 'input/tukabel-wan-character.png').convert('RGB')
    comparison = Image.new('RGB', (size[0]*2, size[1]))
    comparison.paste(reference, (0, 0))
    comparison.paste(rendered[0], (size[0], 0))
    comparison.save(ROOT / 'pose-reference.png')
    print(json.dumps({'frames': len(rendered), 'output': str(output),
                      'maxArmDeltaDegrees': np.degrees(np.max(np.abs(changes), axis=0)).tolist(),
                      'handDetected': hand_transform is not None}, indent=2))


if __name__ == '__main__':
    main()

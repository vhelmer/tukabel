#!/usr/bin/env python3
"""Prepare a native Wan2.2 TI2V-5B image/prompt experiment in existing ComfyUI."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent


def node(kind, **inputs):
    return {'class_type': kind, 'inputs': inputs}


def graph():
    return {
        '1': node('UNETLoader', unet_name='wan2.2_ti2v_5B_fp16.safetensors', weight_dtype='default'),
        '2': node('ModelSamplingSD3', model=['1', 0], shift=8.0),
        '3': node('CLIPLoaderGGUF', clip_name='umt5-xxl-encoder-Q5_K_M.gguf', type='wan'),
        '4': node('CLIPTextEncode', clip=['3', 0], text=(
            'Fixed camera, full-body view of the exact same hand-drawn cartoon character. '
            'He lowers his raised free hand from his forehead to his chest and makes one short palm-up questioning gesture, keeping that hand close to his body. '
            'He keeps holding the same opaque white ceramic mug in his other hand. '
            'His head and torso maintain the same three-quarter angle facing right throughout. '
            'Preserve the original thick irregular black ink outlines, rough painted shading, muted colors, moustache, facial proportions, dirty vest, gold necklace, trousers and sandals. '
            'The original illustrated character comes to life without being redesigned. Static plain gray background. No camera motion.')),
        '5': node('CLIPTextEncode', clip=['3', 0], text=(
            'photorealism, 3D render, plastic, anime, clean vector art, changing illustration style, '
            'changing face, changing body proportions, clothing changes, transparent drinking glass, '
            'changing mug, turning to face the viewer, body rotation, camera movement, zoom, panning, '
            'cuts, transitions, morphing, dissolving hands, extra limbs, extra fingers, cropped hands, '
            'cropped feet, text, watermark, changing background')),
        '6': node('VAELoader', vae_name='wan2.2_vae.safetensors'),
        '7': node('LoadImage', image='tukabel-ti2v-character.png'),
        '8': node('Wan22ImageToVideoLatent', vae=['6', 0], width=480, height=768,
                  length=73, batch_size=1, start_image=['7', 0]),
        '9': node('KSampler', model=['2', 0], seed=67213042, steps=20, cfg=5.0,
                  sampler_name='uni_pc', scheduler='simple', positive=['4', 0],
                  negative=['5', 0], latent_image=['8', 0], denoise=1.0),
        '10': node('VAEDecode', samples=['9', 0], vae=['6', 0]),
        '11': node('CreateVideo', images=['10', 0], fps=24),
        '12': node('SaveVideo', **{'video': ['11', 0], 'filename_prefix': 'tukabel-ti2v/fero-gesture',
                                  'format': 'mp4', 'format.codec': 'h264',
                                  'format.codec.encoding': 'auto'}),
        '13': node('SaveImage', images=['10', 0], filename_prefix='tukabel-ti2v/gesture-frames/fero'),
        # A separate non-generative VAE round trip isolates reconstruction loss.
        '14': node('VAEEncode', pixels=['7', 0], vae=['6', 0]),
        '15': node('VAEDecode', samples=['14', 0], vae=['6', 0]),
        '16': node('SaveImage', images=['15', 0], filename_prefix='tukabel-ti2v/source-reconstructed'),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('comfyui', type=Path)
    args = parser.parse_args()
    if not (args.comfyui / 'main.py').is_file():
        parser.error('Expected an existing ComfyUI directory')
    source = ROOT.parent / 'man-scratch/source.png'
    image = Image.open(source).convert('RGBA')
    size = (480, 768)
    if image.width > size[0]-32 or image.height > size[1]-32:
        raise ValueError('This experiment expects the native Fero asset to fit with a safety margin')
    offset = ((size[0]-image.width)//2, (size[1]-image.height)//2)
    reference = Image.new('RGBA', size, '#b2b0a5')
    reference.alpha_composite(image, offset)
    reference = reference.convert('RGB')
    reference.save(ROOT / 'ti2v-reference.png')
    reference.save(args.comfyui / 'input/tukabel-ti2v-character.png')
    metadata = {'source': '../man-scratch/source.png',
                'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'sourceSize': image.size, 'canvas': size, 'offset': offset, 'scale': 1,
                'frames': 73, 'fps': 24, 'drivingVideo': None,
                'note': 'Native character pixels composited on neutral gray; no rescaling or generated input art.'}
    (ROOT / 'ti2v-inputs.json').write_text(json.dumps(metadata, indent=2)+'\n')
    (ROOT / 'ti2v-api.json').write_text(json.dumps(graph(), indent=2)+'\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()

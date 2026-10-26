#!/usr/bin/env python3
"""Build small API graphs for the existing native ComfyUI Wan Animate nodes."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SETTINGS = json.loads((ROOT / 'inputs.json').read_text()) if (ROOT / 'inputs.json').exists() else {}
FPS = SETTINGS.get('fps', 16)
FRAMES = SETTINGS.get('frames', 33)
WIDTH, HEIGHT = SETTINGS.get('canvas', [320, 512])


def node(kind, **inputs):
    return {'class_type': kind, 'inputs': inputs}


def video_output(images, prefix):
    return {
        '90': node('CreateVideo', images=images, fps=FPS),
        '91': node('SaveVideo', **{'video': ['90', 0], 'filename_prefix': prefix,
                                  'format': 'mp4', 'format.codec': 'h264',
                                  'format.codec.encoding': 'auto'}),
    }


def preprocess():
    graph = {
        '1': node('LoadVideo', file='tukabel-scratch-driving.mp4'),
        '2': node('GetVideoComponents', video=['1', 0]),
        '3': node('DWPreprocessor', image=['2', 0], detect_hand='enable',
                  detect_body='enable', detect_face='disable', resolution=512,
                  bbox_detector='yolox_l.onnx', pose_estimator='dw-ll_ucoco_384.onnx',
                  scale_stick_for_xinsr_cn='disable'),
        '4': node('SavePoseKpsAsJsonFile', pose_kps=['3', 1],
                  filename_prefix='tukabel-wan/driving-pose'),
        **video_output(['3', 0], 'tukabel-wan/driving-pose'),
    }
    graph['5'] = node('LoadImage', image='tukabel-wan-character.png')
    graph['6'] = node('DWPreprocessor', **{**graph['3']['inputs'], 'image': ['5', 0]})
    graph['7'] = node('SavePoseKpsAsJsonFile', pose_kps=['6', 1],
                      filename_prefix='tukabel-wan/reference-pose')
    graph['8'] = node('SaveImage', images=['6', 0], filename_prefix='tukabel-wan/reference-pose')
    return graph


def animate():
    return {
        '1': node('UnetLoaderGGUF', unet_name='Wan2.2-Animate-14B-Q4_K_S.gguf'),
        '2': node('LoraLoaderModelOnly', model=['1', 0],
                  lora_name='lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
                  strength_model=1.0),
        '3': node('ModelSamplingSD3', model=['2', 0], shift=8.0),
        '4': node('CLIPLoaderGGUF', clip_name='umt5-xxl-encoder-Q5_K_M.gguf', type='wan'),
        '5': node('CLIPTextEncode', clip=['4', 0], text=(
            'A full body 2D hand drawn cartoon man nervously scratches his scalp '
            'with his raised hand. His fingertips gently rub his hair. '
            'The other hand stays still holding his mug. Preserve the exact '
            'character design, thick black ink outlines, moustache, clothing, '
            'body proportions and muted colors of the reference image. '
            'Small natural motion, fixed camera, flat neutral grey background.')),
        '6': node('CLIPTextEncode', clip=['4', 0], text=(
            'photorealistic, 3d render, camera movement, zoom, cropped feet, '
            'extra limbs, extra fingers, distorted hands, changing clothes, '
            'disappearing moustache, flickering, text, watermark')),
        '7': node('VAELoader', vae_name='wan_2.1_vae.safetensors'),
        '8': node('CLIPVisionLoader', clip_name='clip_vision_h.safetensors'),
        '9': node('LoadImage', image='tukabel-wan-character.png'),
        '10': node('CLIPVisionEncode', clip_vision=['8', 0], image=['9', 0], crop='none'),
        '11': node('LoadVideo', file='tukabel-scratch-pose.mp4'),
        '12': node('GetVideoComponents', video=['11', 0]),
        '13': node('WanAnimateToVideo', positive=['5', 0], negative=['6', 0],
                   vae=['7', 0], width=WIDTH, height=HEIGHT, length=FRAMES, batch_size=1,
                   continue_motion_max_frames=5, video_frame_offset=0,
                   clip_vision_output=['10', 0], reference_image=['9', 0],
                   pose_video=['12', 0]),
        '14': node('KSampler', model=['3', 0], seed=67213042, steps=6, cfg=1.0,
                   sampler_name='euler', scheduler='simple', positive=['13', 0],
                   negative=['13', 1], latent_image=['13', 2], denoise=1.0),
        '15': node('TrimVideoLatent', samples=['14', 0], trim_amount=['13', 3]),
        '16': node('VAEDecode', samples=['15', 0], vae=['7', 0]),
        '17': node('ImageFromBatch', image=['16', 0], batch_index=['13', 4], length=FRAMES),
        **video_output(['17', 0], 'tukabel-wan/scratch'),
        '92': node('SaveImage', images=['17', 0], filename_prefix='tukabel-wan/frames/scratch'),
    }


def quality():
    graph = animate()
    graph['2']['inputs']['strength_model'] = 0.0
    graph['14']['inputs']['steps'] = 20
    graph['14']['inputs']['cfg'] = 3.0
    graph['5']['inputs']['text'] += (' His raised hand stays visible in front of his hairline, '
                                    'with distinct fingers touching the top of his forehead. '
                                    'His mouth, moustache and facial expression stay still.')
    graph['6']['inputs']['text'] += (', hidden hand, hand behind head, fused hand, '
                                    'hand fused with head, changing face, moving mouth')
    graph['91']['inputs']['filename_prefix'] = 'tukabel-wan/scratch-quality'
    graph['92']['inputs']['filename_prefix'] = 'tukabel-wan/quality-frames/scratch'
    return graph


def idle():
    graph = animate()
    del graph['11']
    del graph['12']
    del graph['13']['inputs']['pose_video']
    graph['13']['inputs']['length'] = 33
    graph['13']['inputs']['continue_motion'] = ['9', 0]
    graph['13']['inputs']['continue_motion_max_frames'] = 1
    graph['17']['inputs']['length'] = 33
    graph['17']['inputs']['batch_index'] = 0
    graph['14']['inputs']['steps'] = 8
    graph['5']['inputs']['text'] = (
        'A full body hand drawn 2D cartoon man quietly idles in place. '
        'He slowly exhales, his shoulders relax, and he makes one small curious '
        'head tilt and glances sideways, then settles back into his starting pose. '
        'His raised hand keeps resting against his hair, his other hand holds '
        'his mug steady. Very small natural movement. Preserve the character '
        'identity, moustache, clothing, thick black ink outlines and muted colors '
        'of the reference. Fixed camera, full body stays in frame, plain neutral grey background.')
    graph['91']['inputs']['filename_prefix'] = 'tukabel-wan/idle-prompt'
    graph['92']['inputs']['filename_prefix'] = 'tukabel-wan/idle-prompt-frames/idle'
    return graph


if __name__ == '__main__':
    for name, graph in [('preprocess-api', preprocess()), ('animate-api', animate()),
                        ('quality-api', quality()), ('idle-api', idle())]:
        (ROOT / f'{name}.json').write_text(json.dumps(graph, indent=2) + '\n')

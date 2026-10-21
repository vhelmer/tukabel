"""Adapter contract with real inference, not a pretrained quality benchmark."""
import sys
import tempfile

sys.path.insert(0, "scripts/segmentation")

import numpy as np
import torch
from transformers import (
    Sam3ImageProcessor,
    Sam3TrackerConfig,
    Sam3TrackerMaskDecoderConfig,
    Sam3TrackerModel,
    Sam3TrackerProcessor,
    Sam3TrackerPromptEncoderConfig,
    Sam3ViTConfig,
    Sam3VisionConfig,
)
from sam3_adapter import Sam3Predictor

torch.set_num_threads(4)
vision = Sam3VisionConfig(
    backbone_config=Sam3ViTConfig(
        hidden_size=32, intermediate_size=64, num_hidden_layers=2,
        num_attention_heads=4, image_size=56, patch_size=14,
        pretrain_image_size=56, window_size=2, global_attn_indexes=[1],
    ),
    fpn_hidden_size=32,
    backbone_feature_sizes=[[16, 16], [8, 8], [4, 4]],
)
config = Sam3TrackerConfig(
    vision_config=vision,
    prompt_encoder_config=Sam3TrackerPromptEncoderConfig(
        hidden_size=32, image_size=56, patch_size=14,
    ),
    mask_decoder_config=Sam3TrackerMaskDecoderConfig(
        hidden_size=32, mlp_dim=64, num_hidden_layers=1,
        num_attention_heads=4, iou_head_hidden_dim=32,
    ),
)
with tempfile.TemporaryDirectory() as folder:
    Sam3TrackerModel(config).save_pretrained(folder)
    Sam3TrackerProcessor(
        Sam3ImageProcessor(size={"height": 56, "width": 56})
    ).save_pretrained(folder)
    predictor = Sam3Predictor(folder)
    with torch.inference_mode():
        predictor.set_image(np.zeros((73, 91, 3), dtype=np.uint8))
        masks, scores, _ = predictor.predict(
            point_coords=np.array([[40, 30], [5, 5]]),
            point_labels=np.array([1, 0]),
            box=np.array([10, 12, 70, 60]),
        )
    assert masks.shape == (3, 73, 91), masks.shape
    assert scores.shape == (3,), scores.shape
    assert masks.dtype == np.bool_
    print("Offline adapter inference passed (random test weights, not a quality test).")

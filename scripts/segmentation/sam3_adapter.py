"""Offline SAM 3 visual prompts, matching our SAM 2 predictor boundary.

Weights/config must already exist locally. No remote code or runtime downloads.
The native-size binary mask then follows the same edge refinement and matting.
"""
import numpy as np
import torch
from device import inference_device
from PIL import Image
from transformers import Sam3TrackerModel, Sam3TrackerProcessor


class Sam3Predictor:
    def __init__(self, model_path):
        self.device = inference_device()
        self.processor = Sam3TrackerProcessor.from_pretrained(model_path, local_files_only=True)
        self.model = Sam3TrackerModel.from_pretrained(model_path, local_files_only=True, use_safetensors=True).to(self.device).eval()
        self.image = None

    def set_image(self, image):
        self.image = Image.fromarray(image)

    def predict(self, point_coords=None, point_labels=None, box=None, multimask_output=True):
        prompts = {"input_boxes": [[np.asarray(box).tolist()]]}
        if point_coords is not None:
            prompts["input_points"] = [[np.asarray(point_coords).tolist()]]
            prompts["input_labels"] = [[np.asarray(point_labels).tolist()]]
        inputs = self.processor(images=self.image, return_tensors="pt", **prompts).to(self.device)
        with torch.inference_mode():
            outputs = self.model(**inputs, multimask_output=multimask_output)
        masks = self.processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0][0]
        return masks.numpy().astype(bool), outputs.iou_scores[0, 0].cpu().numpy(), None

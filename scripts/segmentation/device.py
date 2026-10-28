"""Explicit local device stays CPU; SSH can request auto/cuda without downloads."""
import os
import torch


def inference_device():
    device = os.environ.get("TUKABEL_DEVICE", "cpu")
    if device not in ("cpu", "cuda", "auto"):
        raise ValueError("unsupported device")
    if device == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but unavailable")
    return device

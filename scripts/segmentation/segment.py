"""Local, non-generative mask inference. No model downloads or image resampling."""
import importlib.util
import json
import os
import sys


def capabilities():
    grabcut = all(importlib.util.find_spec(m) for m in ("cv2", "numpy"))
    sam2 = grabcut and importlib.util.find_spec("sam2") is not None and os.path.isfile(os.environ.get("TUKABEL_SAM2_CHECKPOINT", ""))
    return {"grabcut": bool(grabcut), "sam2": bool(sam2)}


if sys.argv[1:] == ["--status"]:
    print(json.dumps(capabilities()))
    sys.exit(0)

import cv2 as cv
import numpy as np

cv.setNumThreads(1)
cv.setRNGSeed(7)
folder, method = sys.argv[1:3]
refine_edges = len(sys.argv) < 4 or sys.argv[3] == "source-edges"
detail_pass = len(sys.argv) > 4 and sys.argv[4] == "detail"
image = cv.imread(os.path.join(folder, "source.png"), cv.IMREAD_COLOR)
prior = cv.imread(os.path.join(folder, "prior.png"), cv.IMREAD_GRAYSCALE)
seeds = cv.imread(os.path.join(folder, "seeds.png"), cv.IMREAD_GRAYSCALE)
assert image is not None and prior is not None and seeds is not None
assert image.shape[:2] == prior.shape == seeds.shape
inside = prior >= 128
# Explicit strokes can recover details outside the original coarse polygon.
inside[seeds == 255] = True
inside[seeds == 128] = False
assert np.any(inside), "empty mask"
ys, xs = np.where(inside)
x0, x1 = max(0, int(xs.min()) - 24), min(image.shape[1], int(xs.max()) + 25)
y0, y1 = max(0, int(ys.min()) - 24), min(image.shape[0], int(ys.max()) + 25)
roi = image[y0:y1, x0:x1].copy()
p = inside[y0:y1, x0:x1]
s = seeds[y0:y1, x0:x1]


def source_edges(image, mask, seeds):
    """Fit SAM's coarse boundary to original pixels, never soften its alpha.

    Only a 12px boundary band may change. Interior/background remain fixed;
    explicit brush strokes are hard constraints, including recovered thin parts.
    No closing/filling: real holes and gaps between antennae must survive.
    """
    mask = mask.copy()
    mask[seeds == 255] = True
    mask[seeds == 128] = False
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, (25, 25))
    core = cv.erode(mask.astype(np.uint8), kernel) > 0
    possible = cv.dilate(mask.astype(np.uint8), kernel) > 0
    core[seeds == 255] = True
    possible[seeds == 255] = True
    # Degenerate/tiny masks cannot train GrabCut's foreground/background GMMs.
    if np.count_nonzero(core) < 5 or np.count_nonzero(~possible) < 5:
        return mask
    yy, xx = np.where(possible)
    x0, x1 = max(0, int(xx.min()) - 1), min(image.shape[1], int(xx.max()) + 2)
    y0, y1 = max(0, int(yy.min()) - 1), min(image.shape[0], int(yy.max()) + 2)
    labels = np.where(mask, cv.GC_PR_FGD, cv.GC_PR_BGD).astype(np.uint8)
    labels[core] = cv.GC_FGD
    labels[~possible] = cv.GC_BGD
    labels[seeds == 255] = cv.GC_FGD
    labels[seeds == 128] = cv.GC_BGD
    region = labels[y0:y1, x0:x1].copy()
    cv.grabCut(image[y0:y1, x0:x1].copy(), region, None, np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64), 5, cv.GC_INIT_WITH_MASK)
    result = np.zeros_like(mask)
    result[y0:y1, x0:x1] = (region == cv.GC_FGD) | (region == cv.GC_PR_FGD)
    # Color refinement can grow unrelated dark specks/lines near the object.
    # Keep disconnected parts already recognized by SAM or explicitly painted,
    # but discard entirely new islands with no connection to either anchor.
    count, components = cv.connectedComponents(result.astype(np.uint8), connectivity=8)
    keep = np.zeros(count, dtype=bool)
    keep[np.unique(components[mask | (seeds == 255)])] = True
    keep[0] = False
    result = keep[components]
    return result


if method == "grabcut":
    labels = np.where(p, cv.GC_PR_FGD, cv.GC_BGD).astype(np.uint8)
    labels[s == 255] = cv.GC_FGD
    labels[s == 128] = cv.GC_BGD
    assert np.any(labels == cv.GC_BGD), "mark some background"
    cv.grabCut(roi, labels, None, np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64), 5, cv.GC_INIT_WITH_MASK)
    mask = (labels == cv.GC_FGD) | (labels == cv.GC_PR_FGD)
elif method == "sam2":
    # Optional official SAM 2 installation and a local checkpoint. Never fetch
    # weights, execute model-provided code or use a cloud endpoint here.
    # SAM needs scene context: a tight GrabCut ROI can turn a whole object into
    # disconnected details. Keep its box and brush prompts in source pixels.
    x0, y0 = 0, 0
    x1, y1 = image.shape[1], image.shape[0]
    roi, s = image, seeds
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    import torch
    points, labels = [], []
    for value, label in ((255, 1), (128, 0)):
        # SAM point prompts represent clicks, not densely sampled brush pixels.
        # Repeating dozens of adjacent points can select the wall instead of the
        # object. Use one actual brush pixel per connected stroke, near its center.
        count, components, stats, centers = cv.connectedComponentsWithStats((s == value).astype(np.uint8), 8)
        for component in sorted(range(1, count), key=lambda c: -stats[c, cv.CC_STAT_AREA])[:64]:
            yy, xx = np.where(components == component)
            center = centers[component]
            i = np.argmin((xx - center[0]) ** 2 + (yy - center[1]) ** 2)
            points.append([xx[i], yy[i]])
            labels.append(label)
    with torch.inference_mode():
        predictor = SAM2ImagePredictor(build_sam2(os.environ.get("TUKABEL_SAM2_CONFIG", "configs/sam2.1/sam2.1_hiera_t.yaml"), os.environ["TUKABEL_SAM2_CHECKPOINT"], device="cpu", apply_postprocessing=False))
        predictor.set_image(cv.cvtColor(roi, cv.COLOR_BGR2RGB))
        masks, scores, _ = predictor.predict(point_coords=np.asarray(points, dtype=np.float32) if points else None, point_labels=np.asarray(labels, dtype=np.int32) if points else None, box=np.array([xs.min() - x0, ys.min() - y0, xs.max() - x0, ys.max() - y0], dtype=np.float32), multimask_output=True)
        mask = masks[int(np.argmax(scores))].astype(bool)
        if detail_pass:
            # A second embedding allocates more model pixels to the object, with
            # ample context (not the tight GrabCut ROI). Coordinates stay native.
            pad = max(96, int(max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.35))
            cx0, cy0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
            cx1, cy1 = min(image.shape[1], int(xs.max()) + pad + 1), min(image.shape[0], int(ys.max()) + pad + 1)
            predictor.set_image(cv.cvtColor(image[cy0:cy1, cx0:cx1], cv.COLOR_BGR2RGB))
            local_points = np.asarray(points, dtype=np.float32) - [cx0, cy0] if points else None
            local, quality, _ = predictor.predict(point_coords=local_points, point_labels=np.asarray(labels, dtype=np.int32) if points else None, box=np.array([xs.min() - cx0, ys.min() - cy0, xs.max() - cx0, ys.max() - cy0], dtype=np.float32), multimask_output=True)
            # Reject unrelated/partial crop interpretations. Confidence scores
            # are compared only within the same image embedding.
            for i in np.argsort(quality)[::-1]:
                candidate = np.zeros_like(mask)
                candidate[cy0:cy1, cx0:cx1] = local[i]
                union = np.count_nonzero(candidate | mask)
                if union and np.count_nonzero(candidate & mask) / union > 0.6:
                    mask = candidate
                    break
    if refine_edges:
        mask = source_edges(image, mask, seeds)
else:
    raise ValueError("unknown method")

mask[s == 255] = True
mask[s == 128] = False
out = np.zeros(prior.shape, dtype=np.uint8)
out[y0:y1, x0:x1] = mask.astype(np.uint8) * 255
assert np.any(out), "no foreground found; add foreground strokes"
assert cv.imwrite(os.path.join(folder, "result.png"), out)
print(json.dumps({"method": method}))

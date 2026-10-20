"""Local trimap-guided matting. Source pixels never pass through a generator."""
import importlib.util
import json
import os
from pathlib import Path
import sys


def capabilities():
    classic = all(importlib.util.find_spec(m) for m in ("cv2", "numpy", "pymatting"))
    model = Path(os.environ.get("TUKABEL_VITMATTE_MODEL", ".local-tools/models/vitmatte-small"))
    vit = classic and importlib.util.find_spec("transformers") is not None and all((model / f).is_file() for f in ("config.json", "preprocessor_config.json", "model.safetensors"))
    return {"closed-form": bool(classic), "vitmatte": bool(vit)}


def make_trimap(prior, seeds, radius):
    import cv2 as cv
    import numpy as np
    inside = (prior >= 128).astype(np.uint8)
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    trimap = np.zeros_like(prior)
    trimap[cv.dilate(inside, kernel) > 0] = 128
    trimap[cv.erode(inside, kernel) > 0] = 255
    trimap[seeds == 64] = 128
    trimap[seeds == 255] = 255
    trimap[seeds == 128] = 0
    if not np.any(trimap == 255) or not np.any(trimap == 0):
        raise ValueError("mark definite foreground and background with the brush")
    return trimap


def bounds(mask, pad=24):
    import numpy as np
    yy, xx = np.where(mask)
    if not len(xx):
        raise ValueError("empty object")
    return max(0, int(xx.min()) - pad), max(0, int(yy.min()) - pad), min(mask.shape[1], int(xx.max()) + pad + 1), min(mask.shape[0], int(yy.max()) + pad + 1)


def estimate_alpha(image, prior, seeds, method, radius, model_dir=None):
    import cv2 as cv
    import numpy as np
    trimap = make_trimap(prior, seeds, radius)
    x0, y0, x1, y1 = bounds(trimap > 0)
    rgb = cv.cvtColor(image[y0:y1, x0:x1, :3], cv.COLOR_BGR2RGB)
    tri = trimap[y0:y1, x0:x1]
    if method in ("vitmatte", "vitmatte-raw"):
        import torch
        from transformers import VitMatteImageProcessor, VitMatteForImageMatting
        model_dir = model_dir or os.environ.get("TUKABEL_VITMATTE_MODEL", ".local-tools/models/vitmatte-small")
        processor = VitMatteImageProcessor.from_pretrained(model_dir, local_files_only=True)
        model = VitMatteForImageMatting.from_pretrained(model_dir, local_files_only=True, use_safetensors=True).eval()

        def predict(im, tm):
            inputs = processor(images=im, trimaps=tm, return_tensors="pt")
            with torch.inference_mode():
                return model(**inputs).alphas[0, 0, :im.shape[0], :im.shape[1]].cpu().numpy()
    elif method == "closed-form":
        from pymatting import estimate_alpha_cf

        def predict(im, tm):
            return estimate_alpha_cf(im.astype(np.float64) / 255, tm.astype(np.float64) / 255, cg_kwargs={"maxiter": 2000})
    else:
        raise ValueError("unknown matting method")

    # Native-resolution overlapping tiles avoid downsampling thin line art or
    # allocating quadratic attention over a whole 4K scene. No asset is resized.
    h, w = tri.shape
    total, weights = np.zeros((h, w), np.float32), np.zeros((h, w), np.float32)
    tile, overlap = 768, 96
    for top in range(0, h, tile - overlap * 2):
        for left in range(0, w, tile - overlap * 2):
            bottom, right = min(h, top + tile), min(w, left + tile)
            tm = tri[top:bottom, left:right]
            if np.any(tm == 128):
                # A trimap tile without known foreground cannot establish color
                # ownership for closed-form; the full trimap remains editable.
                if method == "closed-form" and (not np.any(tm == 255) or not np.any(tm == 0)):
                    raise ValueError("mark foreground/background nearer the uncertain edge")
                value = predict(rgb[top:bottom, left:right], tm)
            else:
                value = tm.astype(np.float32) / 255
            wy = np.minimum(1, np.minimum(np.arange(bottom - top) + 1, np.arange(bottom - top, 0, -1)) / overlap)
            wx = np.minimum(1, np.minimum(np.arange(right - left) + 1, np.arange(right - left, 0, -1)) / overlap)
            weight = wy[:, None] * wx[None, :]
            total[top:bottom, left:right] += value * weight
            weights[top:bottom, left:right] += weight
    alpha = np.zeros(prior.shape, np.float64)
    alpha[y0:y1, x0:x1] = total / weights
    alpha[trimap == 0] = 0
    alpha[trimap == 255] = 1
    # Existing PNG alpha is authoritative; never square premultiplied coverage.
    if image.shape[2] == 4:
        intrinsic = image[:, :, 3].astype(np.float64) / 255
        alpha = np.minimum(alpha, intrinsic)
    alpha[seeds == 128] = 0
    result = np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)
    if method == "vitmatte":
        # ViTMatte resolves semantic ownership; a narrow original-color solve
        # then restores crisp line art. Keep the original trimap's hard facts.
        polish_seeds = np.zeros_like(seeds)
        polish_seeds[trimap == 255] = 255
        polish_seeds[trimap == 0] = 128
        polish_seeds[seeds == 64] = 64
        result, _ = estimate_alpha(image, result, polish_seeds, "closed-form", min(2, radius))
    return result, trimap


def foreground(image, alpha):
    """Unmix original background only at fractional edges; preserve all cores."""
    import cv2 as cv
    import numpy as np
    from pymatting import estimate_foreground_ml
    result = image.copy()
    edge = (alpha > 0) & (alpha < 255) & (image[:, :, 3] == 255)
    if not np.any(edge):
        return result
    x0, y0, x1, y1 = bounds(alpha > 0, pad=24)
    rgb = cv.cvtColor(image[y0:y1, x0:x1, :3], cv.COLOR_BGR2RGB).astype(np.float64) / 255
    a = alpha[y0:y1, x0:x1].astype(np.float64) / 255
    fg = estimate_foreground_ml(rgb, a)
    bgr = cv.cvtColor(np.clip(np.round(fg * 255), 0, 255).astype(np.uint8), cv.COLOR_RGB2BGR)
    region = result[y0:y1, x0:x1, :3]
    selected = edge[y0:y1, x0:x1]
    region[selected] = bgr[selected]
    return result


def main():
    if sys.argv[1:] == ["--status"]:
        print(json.dumps(capabilities()))
        return
    import cv2 as cv
    import numpy as np
    cv.setNumThreads(1)
    cv.setRNGSeed(7)
    # Bound CPU parallelism and stay offline even when a model is misconfigured.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["NUMBA_NUM_THREADS"] = "4"
    folder, method = sys.argv[1:3]
    image = cv.imread(str(Path(folder) / "source.png"), cv.IMREAD_UNCHANGED)
    if image.shape[2] == 3:
        image = cv.cvtColor(image, cv.COLOR_BGR2BGRA)
    prior = cv.imread(str(Path(folder) / "prior.png"), cv.IMREAD_GRAYSCALE)
    if method == "foreground":
        result = foreground(image, prior)
        assert cv.imwrite(str(Path(folder) / "foreground.png"), result)
    else:
        seeds = cv.imread(str(Path(folder) / "seeds.png"), cv.IMREAD_GRAYSCALE)
        radius = int(sys.argv[3])
        assert 1 <= radius <= 32 and prior.shape == seeds.shape == image.shape[:2]
        alpha, trimap = estimate_alpha(image, prior, seeds, method, radius)
        assert cv.imwrite(str(Path(folder) / "result.png"), alpha)
        assert cv.imwrite(str(Path(folder) / "trimap.png"), trimap)
        if len(sys.argv) > 4 and sys.argv[4] == "decontaminate":
            assert cv.imwrite(str(Path(folder) / "foreground.png"), foreground(image, alpha))
    print(json.dumps({"method": method}))


if __name__ == "__main__":
    main()

"""Register a generated cutout against original pixels. No models or downloads."""
import json
import math
from pathlib import Path
import sys
import cv2 as cv
import numpy as np


def align(folder, scale):
    cv.setNumThreads(1)
    cv.setRNGSeed(7)
    source = cv.imread(str(folder / 'source.png'), cv.IMREAD_UNCHANGED)
    generated = cv.imread(str(folder / 'generated.png'), cv.IMREAD_UNCHANGED)
    mask = cv.imread(str(folder / 'prior.png'), cv.IMREAD_GRAYSCALE)
    if source is None or generated is None or mask is None or mask.shape != source.shape[:2] or generated.ndim != 3 or generated.shape[2] != 4:
        raise ValueError('invalid registration inputs')
    edge = np.concatenate((generated[0, :, 3], generated[-1, :, 3], generated[:, 0, 3], generated[:, -1, 3]))
    if np.any(edge > 1):
        raise ValueError('opaque or clipped generated image')
    sift = cv.SIFT_create(nfeatures=5000, contrastThreshold=.02)
    source_points, source_desc = sift.detectAndCompute(cv.cvtColor(source[:, :, :3], cv.COLOR_BGR2GRAY), (mask > 0).astype(np.uint8) * 255)
    sprite_points, sprite_desc = sift.detectAndCompute(cv.cvtColor(generated[:, :, :3], cv.COLOR_BGR2GRAY), (generated[:, :, 3] >= 200).astype(np.uint8) * 255)
    if source_desc is None or sprite_desc is None or len(source_desc) < 2:
        raise ValueError('not enough features')
    pairs = cv.BFMatcher().knnMatch(sprite_desc, source_desc, k=2)
    matches = sorted([p[0] for p in pairs if len(p) == 2 and p[0].distance < .72 * p[1].distance], key=lambda m: m.distance)
    used = set()
    unique = []
    for m in matches:
        if m.trainIdx not in used:
            unique.append(m)
            used.add(m.trainIdx)
    matches = unique
    if len(matches) < 12:
        raise ValueError('not enough matches')
    p = np.float32([sprite_points[m.queryIdx].pt for m in matches])
    q = np.float32([source_points[m.trainIdx].pt for m in matches])
    matrix, keep = cv.estimateAffinePartial2D(p, q, method=cv.RANSAC, ransacReprojThreshold=4, maxIters=5000, confidence=.999)
    if matrix is None:
        raise ValueError('no stable transform')
    keep = keep.ravel().astype(bool)
    errors = np.linalg.norm(p[keep] @ matrix[:, :2].T + matrix[:, 2] - q[keep], axis=1)
    yy, xx = np.where(mask > 0)
    extent = np.ptp(q[keep], axis=0)
    coverage = extent / np.array([max(1, np.ptp(xx)), max(1, np.ptp(yy))])
    rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    ratio = int(keep.sum()) / len(matches)
    median = float(np.median(errors))
    p90 = float(np.percentile(errors, 90))
    factor = float(math.hypot(matrix[0, 0], matrix[1, 0]))
    if int(keep.sum()) < 12 or ratio < .35 or median > 3 or p90 > 6 or min(coverage) < .25 or abs(rotation) > 8 or not .03 <= factor <= 20:
        raise ValueError('unreliable alignment')
    # Warp premultiplied color and alpha together, then export straight RGBA.
    pixels = generated.astype(np.float32) / 255
    pixels[pixels[:, :, 3] <= 1/255] = 0
    pixels[:, :, :3] *= pixels[:, :, 3:4]
    height, width = source.shape[:2]
    native = cv.warpAffine(pixels, matrix, (width, height), flags=cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT)
    alpha = native[:, :, 3]
    visible = alpha > 1/255
    if not np.any(visible):
        raise ValueError('empty aligned sprite')
    # Significant content outside the source would be silently cut away.
    sy, sx = np.where(generated[:, :, 3] >= 32)
    core = np.stack((sx, sy), axis=1) @ matrix[:, :2].T + matrix[:, 2]
    if np.any((core[:, 0] < 0) | (core[:, 0] >= width) | (core[:, 1] < 0) | (core[:, 1] >= height)):
        raise ValueError('aligned object outside source')
    yy, xx = np.where(visible)
    left, top, right, bottom = int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1
    fw, fh = right-left, bottom-top
    if fw*fh*scale*scale > 8*1024*1024:
        raise ValueError('aligned asset too large')
    def straight(data):
        a = data[:, :, 3:4]
        rgb = np.divide(data[:, :, :3], a, out=np.zeros_like(data[:, :, :3]), where=a > 1/255)
        result = np.clip(np.rint(np.concatenate((rgb, a), axis=2)*255), 0, 255).astype(np.uint8)
        result[result[:, :, 3] <= 1] = 0
        return result
    native_png = straight(native)
    scaled_matrix = matrix.copy() * scale
    scaled_matrix[:, 2] -= np.array([left, top])*scale
    sprite = straight(cv.warpAffine(pixels, scaled_matrix, (fw*scale, fh*scale), flags=cv.INTER_LINEAR, borderMode=cv.BORDER_CONSTANT))
    cv.imwrite(str(folder/'full.png'), native_png)
    cv.imwrite(str(folder/'result.png'), sprite)
    good_matches = [m for m, ok in zip(matches, keep) if ok][:60]
    visual = cv.drawMatches(generated[:, :, :3], sprite_points, source[:, :, :3], source_points, good_matches, None, flags=cv.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
    cv.imwrite(str(folder/'alignment-matches.png'), visual)
    record = dict(method='features', matches=len(matches), inliers=int(keep.sum()), inlierRatio=ratio, medianError=median, p90Error=p90, coverageX=float(coverage[0]), coverageY=float(coverage[1]), matrix=matrix.flatten().tolist(), frame=dict(x=left,y=top,width=fw,height=fh,sourceWidth=width,sourceHeight=height))
    (folder/'alignment.json').write_text(json.dumps(record))


if __name__ == '__main__':
    align(Path(sys.argv[1]), int(sys.argv[2]))

"""Cut the mascot renders off their cream backdrop -> transparent PNGs.

The art is near-white on near-white, so a global color threshold would eat
the belly. Instead we flood-fill only pixels connected to the image border
that match the sampled background color, then feather the cut edge.

Usage: python scripts/remove-bg.py <in> <out> [--pad 0.04]
"""

import sys
from collections import deque

import numpy as np
from PIL import Image

TOL = 42          # distance from bg color that counts as background
GB_TOL = 12       # green-blue gap: belly is cream-yellow, bg is neutral gray
SOFT_TOL = 14     # extra soft ring outside the fill, feathered by distance


def cut(src: str, dst: str, pad_ratio: float = 0.04) -> None:
    im = Image.open(src).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape

    # Background color = median of the border pixels.
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))

    # Background is light AND neutral; the cream belly is the same lightness
    # but yellow (higher g-b), so it can't be flooded away.
    gb = a[:, :, 1] - a[:, :, 2]
    cand = (dist < TOL) & (gb < GB_TOL)
    seen = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))

    # Soft edge: pixels just outside the fill get partial alpha by distance.
    ring = np.zeros((h, w), bool)
    for _ in range(2):
        shifted = seen.copy()
        shifted[1:] |= seen[:-1]
        shifted[:-1] |= seen[1:]
        shifted[:, 1:] |= seen[:, :-1]
        shifted[:, :-1] |= seen[:, 1:]
        ring |= shifted
    ring &= ~seen

    alpha = np.where(seen, 0, 255).astype(np.float32)
    soft = np.clip((dist - TOL) / SOFT_TOL, 0, 1)
    alpha[ring] = np.minimum(alpha[ring], 255 * (1 - soft[ring]))

    out = np.dstack([np.asarray(im), alpha.astype(np.uint8)])
    img = Image.fromarray(out, "RGBA")

    # Tight crop to the opaque content, plus a small pad.
    ys, xs = np.where(alpha > 8)
    if ys.size:
        pad = int(max(h, w) * pad_ratio)
        y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad)
        x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad)
        img = img.crop((x0, y0, x1, y1))
    img.save(dst)
    print(f"{src} -> {dst} ({img.width}x{img.height})")


if __name__ == "__main__":
    pad = 0.04
    args = sys.argv[1:]
    if "--pad" in args:
        i = args.index("--pad")
        pad = float(args[i + 1])
        args = args[:i] + args[i + 2:]
    cut(args[0], args[1], pad)

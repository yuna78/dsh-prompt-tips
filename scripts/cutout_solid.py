#!/usr/bin/env python3
"""
Body-preserving cutout for the mascot skins (PIL + numpy, no scipy).

Why this exists: the skins use a "pixel dissolve" art style whose outline has
gaps. A plain border flood-fill leaks through those gaps into light-colored
bodies and eats the interior (pixel-chick / pixel-fox / pixel-unicorn shipped
hollow). This pipeline:

  0. mode "chroma" (green-screen): the source was regenerated on one flat
      chroma background, so background = any pixel close to the border-median
      color, with green spill suppressed (despill). No flood, no white-body
      ambiguity — the reliable path once remnants fused with the silhouette;
  1. estimates the background color from the border band (per-channel median);
  2. flood-fills from the image border with a color tolerance (numpy frontier
     dilation — background only);
  3. morphologically CLOSES the subject mask to plug narrow dissolve gaps;
  4. any flood-removed region that becomes enclosed by the closed mask is a
     leaked body interior → restored from the ORIGINAL pixels (alpha 255);
     components smaller than --min-hole stay transparent (bridging specks);
  5. resizes to --height (default 320), crops to the alpha bbox with padding,
     and writes the RGBA PNG.

Usage:
  python3 scripts/cutout_solid.py SRC.png [SRC2.png ...] -o OUTDIR \
      [--tol 40] [--close 25] [--min-hole 2000] [--height 320] [--report]

talk frames are kept identical to idle by convention (see assets/skins).
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def flood_from_border(rgb: np.ndarray, bg: np.ndarray, tol: float) -> np.ndarray:
    """Border-connected background mask via iterative frontier dilation."""
    h, w, _ = rgb.shape
    dist = np.sqrt(((rgb.astype(np.int32) - bg.astype(np.int32)) ** 2).sum(axis=2))
    near = dist <= tol
    visited = np.zeros((h, w), dtype=bool)
    frontier = np.zeros((h, w), dtype=bool)
    frontier[0, :] = near[0, :]
    frontier[-1, :] = near[-1, :]
    frontier[:, 0] |= near[:, 0]
    frontier[:, -1] |= near[:, -1]
    visited |= frontier
    while frontier.any():
        nbr = np.zeros_like(frontier)
        nbr[1:, :] |= frontier[:-1, :]
        nbr[:-1, :] |= frontier[1:, :]
        nbr[:, 1:] |= frontier[:, :-1]
        nbr[:, :-1] |= frontier[:, 1:]
        frontier = nbr & near & ~visited
        visited |= frontier
    return visited


def geodesic_depth(mask: np.ndarray) -> np.ndarray:
    """4-connected geodesic distance from the mask's border-touching pixels.

    Chamfer-style sweeps (2× forward + 2× backward) over the mask; exact for
    the axis-aligned cases these sprites produce and cheap without scipy.
    """
    h, w = mask.shape
    big = h + w
    dist = np.full((h, w), big, dtype=np.int32)
    # seeds: mask pixels on the image border
    dist[0, :] = np.where(mask[0, :], 0, big)
    dist[-1, :] = np.where(mask[-1, :], 0, big)
    dist[:, 0] = np.minimum(dist[:, 0], np.where(mask[:, 0], 0, big))
    dist[:, -1] = np.minimum(dist[:, -1], np.where(mask[:, -1], 0, big))
    m = mask
    for _ in range(2):
        for y in range(h):
            row = dist[y]
            up = dist[y - 1] if y > 0 else None
            for_pass = np.full(w, big, dtype=np.int32)
            np.minimum(for_pass, row, out=for_pass)
            if up is not None:
                np.minimum(for_pass, up + 1, out=for_pass)
            left = for_pass[:-1] + 1
            np.minimum(for_pass[1:], left, out=for_pass[1:])
            dist[y] = np.where(m[y], for_pass, big)
        for y in range(h - 1, -1, -1):
            row = dist[y]
            down = dist[y + 1] if y < h - 1 else None
            back = np.full(w, big, dtype=np.int32)
            np.minimum(back, row, out=back)
            if down is not None:
                np.minimum(back, down + 1, out=back)
            right = back[1:] + 1
            np.minimum(back[:-1], right, out=back[:-1])
            dist[y] = np.where(m[y], back, big)
    return dist


def close_mask(mask: np.ndarray, size: int) -> np.ndarray:
    """Morphological closing (dilate then erode) with an odd square kernel."""
    im = Image.fromarray((mask * 255).astype(np.uint8), "L")
    im = im.filter(ImageFilter.MaxFilter(size)).filter(ImageFilter.MinFilter(size))
    return np.array(im) > 127


def reconstruct(seed: np.ndarray, constraint: np.ndarray) -> np.ndarray:
    """Dilate `seed` inside `constraint` until stable (one multi-seed BFS)."""
    acc = seed & constraint
    frontier = acc.copy()
    while frontier.any():
        nbr = np.zeros_like(frontier)
        nbr[1:, :] |= frontier[:-1, :]
        nbr[:-1, :] |= frontier[1:, :]
        nbr[:, 1:] |= frontier[:, :-1]
        nbr[:, :-1] |= frontier[:, 1:]
        frontier = nbr & constraint & ~acc
        acc |= frontier
    return acc


def label_areas(mask: np.ndarray, min_area: int) -> list[np.ndarray]:
    """Connected components of `mask` with area >= min_area (numpy BFS)."""
    remaining = mask.copy()
    comps: list[np.ndarray] = []
    while remaining.any():
        ys, xs = np.where(remaining)
        y0, x0 = int(ys[0]), int(xs[0])
        comp = np.zeros_like(mask)
        comp[y0, x0] = True
        frontier = comp.copy()
        while frontier.any():
            nbr = np.zeros_like(frontier)
            nbr[1:, :] |= frontier[:-1, :]
            nbr[:-1, :] |= frontier[1:, :]
            nbr[:, 1:] |= frontier[:, :-1]
            nbr[:, :-1] |= frontier[:, 1:]
            frontier = nbr & remaining & ~comp
            comp |= frontier
        remaining &= ~comp
        if int(comp.sum()) >= min_area:
            comps.append(comp)
    return comps


def cutout(src: Path, out: Path, tol: float, close: int, min_hole: int,
           height: int, pad: int, max_depth: int = 0, mode: str = "flood") -> dict:
    im = Image.open(src).convert("RGB")
    rgb = np.array(im)
    h, w, _ = rgb.shape

    # 1) background estimate: per-channel median of the border band
    band = 8
    border = np.concatenate([
        rgb[:band].reshape(-1, 3), rgb[-band:].reshape(-1, 3),
        rgb[:, :band].reshape(-1, 3), rgb[:, -band:].reshape(-1, 3),
    ])
    bg = np.median(border, axis=0)

    if mode == "chroma":
        # 绿幕特化：重绘图背景是单一纯色（border median 即背景色），按色距
        # 二值化即可，无需泛洪——白身与白残块不再需要算法区分。抠完后对
        # 绿色占优的边缘像素做 despill，避免绿边。
        dist_bg = np.sqrt(((rgb.astype(np.int32) - bg.astype(np.int32)) ** 2).sum(axis=2))
        subject = dist_bg > tol
        rgb = rgb.copy()
        r = rgb[..., 0]
        g = rgb[..., 1]
        b = rgb[..., 2]
        spill = g.astype(np.int32) - np.maximum(r, b).astype(np.int32)
        greenish = (spill > 0) & (g > r + 30) & (g > b + 30)
        rgb[..., 1] = np.where(greenish, g - (spill * 0.85).astype(np.uint8), g)
        restore = np.zeros_like(subject)
        kept = []
        core = None
    elif mode == "core-fill":
        # 白底白身特化：背景与身体同为白色、描边在消散区断开，任何泛洪必漏。
        # 改为全局阈值取「彩色核心」（描边/色块/消散粒子），闭运算桥接碎片，
        # 被围住的大片白色区域即身体内部 → 用原图像素整体还原。
        dist_bg = np.sqrt(((rgb.astype(np.int32) - bg.astype(np.int32)) ** 2).sum(axis=2))
        core = dist_bg > tol
        closed = close_mask(core, close) if close > 2 else core
        holes = ~core & closed
        kept = label_areas(holes, min_hole)
        restore = np.zeros((h, w), dtype=bool)
        for comp in kept:
            restore |= comp
        subject = core | restore
    else:
        # 2) border flood fill
        bg_mask = flood_from_border(rgb, bg, tol)
        if max_depth > 0:
            # 泄漏防护：泛洪虽会穿过消散缺口进入身体，但路径必然很深；
            # 只保留测地深度 ≤ max_depth 的泛洪区为背景，深处一律还原为身体。
            depth = geodesic_depth(bg_mask)
            bg_mask &= depth <= max_depth
        subject = ~bg_mask

        # 3+4) plug dissolve gaps, restore leaked interiors from original pixels
        if close > 2:
            closed = close_mask(subject, close)
            holes = bg_mask & closed
            cores = np.array(
                Image.fromarray((holes * 255).astype(np.uint8), "L")
                .filter(ImageFilter.MinFilter(5))
            ) > 127  # drop slivers before reconstruction
            grown = reconstruct(cores, holes)
            kept = label_areas(grown, min_hole)
            restore = np.zeros_like(holes)
            for comp in kept:
                restore |= comp
        else:
            restore = np.zeros_like(subject)
            kept = []
        subject = subject | restore

    alpha = np.where(subject, 255, 0).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])
    info_restore_px = int((subject & ~core).sum()) if mode == "core-fill" else int(restore.sum())
    info_comps = len(kept)

    # 5) resize + bbox crop
    out_im = Image.fromarray(rgba, "RGBA")
    scale = height / out_im.height
    out_im = out_im.resize((max(1, round(out_im.width * scale)), height), Image.LANCZOS)
    a = np.array(out_im.getchannel("A"))
    ys, xs = np.where(a > 8)
    box = (max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad),
           min(out_im.width, int(xs.max()) + pad), min(out_im.height, int(ys.max()) + pad))
    out_im = out_im.crop(box)
    out.parent.mkdir(parents=True, exist_ok=True)
    out_im.save(out)

    return {
        "src": src.name, "out": str(out), "size": out_im.size,
        "bg": [round(float(v), 1) for v in bg],
        "restored_px": info_restore_px,
        "restored_components": info_comps,
        "opaque_pct": round(float((alpha > 0).mean()) * 100, 1),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Body-preserving skin cutout")
    ap.add_argument("sources", nargs="+", type=Path)
    ap.add_argument("-o", "--outdir", type=Path, required=True)
    ap.add_argument("--mode", choices=["flood", "core-fill", "chroma"], default="flood",
                    help="flood=边界泛洪（默认）；core-fill=白底白身特化（全局阈值+闭运算围合还原）；"
                         "chroma=绿幕特化（单一纯背景按色距二值化+despill，tol 建议约 100）")
    ap.add_argument("--tol", type=float, default=40.0)
    ap.add_argument("--close", type=int, default=25)
    ap.add_argument("--min-hole", type=int, default=2000)
    ap.add_argument("--max-depth", type=int, default=0,
                    help="测地深度上限（像素）：>0 时启用泄漏防护，0 关闭")
    ap.add_argument("--height", type=int, default=320)
    ap.add_argument("--pad", type=int, default=6)
    args = ap.parse_args()

    failed = False
    for src in args.sources:
        out = args.outdir / src.name
        try:
            info = cutout(src, out, args.tol, args.close, args.min_hole,
                          args.height, args.pad, args.max_depth, args.mode)
        except Exception as error:  # noqa: BLE001 — report every failure
            print(f"FAIL {src.name}: {error}", file=sys.stderr)
            failed = True
            continue
        print(f"ok  {info['out']}  {info['size'][0]}x{info['size'][1]}"
              f"  bg={info['bg']}  restored={info['restored_px']}px"
              f" ({info['restored_components']} comps)  opaque={info['opaque_pct']}%")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

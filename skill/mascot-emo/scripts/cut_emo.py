#!/usr/bin/env python3
"""Cut a 3x3 mascot emotion sheet into 9 transparent 320px PNG frames.

Usage:
  python3 cut_emo.py --sheet /tmp/emo.png --out assets/skins/<id>/emo \
                     [--cell-clear 96] [--tol 55] [--size 320]

Fills the top-left corner of each cell with white (removes the cell number
label), flood-fills the white background to transparent, crops to content,
and rescales so the height equals --size.
"""
import argparse
import os
from collections import deque

from PIL import Image

DEFAULT_NAMES = ["idle", "excited", "talk", "thinking", "surprised", "sad", "heart", "sleep", "wave"]


def near_white(p, tol):
    r, g, b, a = p
    return r >= 255 - tol and g >= 255 - tol and b >= 255 - tol


def cutout(im, tol):
    px = im.load()
    w, h = im.size
    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        if not seen[y * w + x] and near_white(px[x, y], tol):
            seen[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)
    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)
    return im.crop(im.getbbox())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--names", default=",".join(DEFAULT_NAMES))
    ap.add_argument("--cell-clear", type=int, default=96, help="top-left px to white out (number label)")
    ap.add_argument("--tol", type=int, default=55)
    ap.add_argument("--size", type=int, default=320)
    args = ap.parse_args()

    names = [n for n in args.names.split(",") if n]
    sheet = Image.open(args.sheet).convert("RGBA")
    cell = min(sheet.width // 3, sheet.height // 3)
    os.makedirs(args.out, exist_ok=True)
    from PIL import ImageDraw

    for i, name in enumerate(names):
        gx, gy = (i % 3) * cell, (i // 3) * cell
        tile = sheet.crop((gx, gy, gx + cell, gy + cell)).convert("RGBA")
        dr = ImageDraw.Draw(tile)
        dr.rectangle([0, 0, args.cell_clear, args.cell_clear], fill=(255, 255, 255, 255))
        tile = cutout(tile, args.tol)
        ratio = args.size / tile.height
        tile = tile.resize((max(1, round(tile.width * ratio)), args.size), Image.LANCZOS)
        out = os.path.join(args.out, f"{name}.png")
        tile.save(out, optimize=True)
        print(f"{out}: {tile.size[0]}x{tile.size[1]} {os.path.getsize(out) // 1024}KB")


if __name__ == "__main__":
    main()

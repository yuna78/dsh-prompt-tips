#!/usr/bin/env bash
# One-shot: add a new mascot IP skin (idle artwork + 9 emotion frames).
# Usage: add_mascot.sh <skin-id> "<中文名>" "<English creature description>"
# Result: assets/skins/<skin-id>/{idle.png, talk.png, emo/*.png}
#         (skins/index.json still needs the new entry — printed as a hint.)
set -euo pipefail

ID="${1:?usage: add_mascot.sh <skin-id> \"<中文名>\" \"<English description>\"}"
NAME="${2:?usage: add_mascot.sh <skin-id> \"<中文名>\" \"<English description>\"}"
DESC="${3:?usage: add_mascot.sh <skin-id> \"<中文名>\" \"<English description>\"}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -z "${GPT_IMAGE_BASE_URL:-}" ]; then
  export GPT_IMAGE_BASE_URL="https://model.wochengtv.net:9312/v1"
fi
GPT_IMAGE_SKILL="${GPT_IMAGE_SKILL:-/Users/haitongsun/ClaudeBackups/claude-full-20261014-235247/keep/skills/gpt-image}"
if [ -z "${GPT_IMAGE_API_KEY:-}" ]; then
  export GPT_IMAGE_API_KEY="$(grep '^RELAY_B_WOCHENG_KEY=' "$GPT_IMAGE_SKILL/relays.secret.env" | cut -d= -f2- | tr -d '" ')"
fi

TAIL="Rich details, soft cel shading, thick clean outlines, kawaii style, genderless mascot so any user can relate (no hair, no clothes, not human), full body, front view, centered, plain pure white background, no text, no watermark."

echo "── [1/3] 主立绘 (idle)"
python3 "$GPT_IMAGE_SKILL/scripts/gen_image.py" \
  --prompt "Cute genderless chibi mascot for a desktop pet app: $DESC $TAIL" \
  --output "$WORK/idle-raw.png" --size 1024x1024 --timeout 300 2>&1 | tail -1

echo "── [2/3] 表情 sheet (9 帧)"
bash "$SKILL_DIR/gen_emo_sheet.sh" "$WORK/idle-raw.png" "$WORK/emo-sheet.png"

echo "── [3/3] 抠图裁切落位"
python3 "$SKILL_DIR/cut_emo.py" --sheet "$WORK/emo-sheet.png" --out "$WORK/emo" >/dev/null
python3 - "$WORK/idle-raw.png" "$ROOT/assets/skins/$ID" << 'EOF'
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath("__file__")))
from PIL import Image
from collections import deque
src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(outdir, "emo"), exist_ok=True)
def near_white(p, tol):
    r, g, b, a = p
    return r >= 255 - tol and g >= 255 - tol and b >= 255 - tol
def cutout(im, tol=55):
    px = im.load(); w, h = im.size
    seen = bytearray(w * h); q = deque()
    def push(x, y):
        if not seen[y * w + x] and near_white(px[x, y], tol):
            seen[y * w + x] = 1; q.append((x, y))
    for x in range(w): push(x, 0); push(x, h - 1)
    for y in range(h): push(0, y); push(w - 1, y)
    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h: push(nx, ny)
    return im.crop(im.getbbox())
im = cutout(Image.open(src).convert("RGBA"))
ratio = 320 / im.height
im = im.resize((max(1, round(im.width * ratio)), 320), Image.LANCZOS)
for frame in ("idle.png", "talk.png"):
    im.save(os.path.join(outdir, frame), optimize=True)
    print(f"{outdir}/{frame}: {im.size[0]}x{im.size[1]}")
EOF
cp "$WORK/emo/"*.png "$ROOT/assets/skins/$ID/emo/"
echo "── 完成：assets/skins/$ID/（idle/talk + emo/ 9 帧）"
echo "收尾：把 {\"id\":\"$ID\",\"name\":\"$NAME\",\"dir\":\"$ID\",\"frames\":{\"idle\":\"idle.png\",\"talk\":\"talk.png\"},\"accent\":\"#a78bfa\",\"default\":false} 加进 assets/skins/index.json，然后 npm test。"

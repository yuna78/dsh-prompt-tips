#!/usr/bin/env bash
# Generate a 3x3 emotion/pose sheet for an existing mascot via gpt-image edits.
# Usage: gen_emo_sheet.sh <reference-idle.png> <out-sheet.png> [size]
# Requires the gpt-image skill credentials (its .env is read by gen_image.py).
set -euo pipefail

REF="${1:?usage: gen_emo_sheet.sh <reference-idle.png> <out-sheet.png> [size]}"
OUT="${2:?usage: gen_emo_sheet.sh <reference-idle.png> <out-sheet.png> [size]}"
SIZE="${3:-1024x1024}"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GPT_IMAGE_SKILL="${GPT_IMAGE_SKILL:-/Users/haitongsun/ClaudeBackups/claude-full-20261014-235247/keep/skills/gpt-image}"

# Relay credentials: B (wocheng) is the working route; env may override.
if [ -z "${GPT_IMAGE_BASE_URL:-}" ]; then
  export GPT_IMAGE_BASE_URL="https://model.wochengtv.net:9312/v1"
fi
if [ -z "${GPT_IMAGE_API_KEY:-}" ]; then
  export GPT_IMAGE_API_KEY="$(grep '^RELAY_B_WOCHENG_KEY=' "$GPT_IMAGE_SKILL/relays.secret.env" | cut -d= -f2- | tr -d '" ')"
fi

PROMPT="Using the exact same character from the reference image, draw a 3x3 grid sheet of 9 different expressions and poses of this SAME character, equal-sized cells numbered 1-9: 1 calm gentle smile (idle), 2 excited laughing holding the star up, 3 talking with open mouth, 4 thinking pose with stubby arm on chin, 5 surprised with round O-mouth, 6 teary sad pout with a little tear, 7 making a heart with both stubby arms, 8 sleeping peacefully with a small Zzz bubble, 9 waving hello with one arm raised. Keep the same holographic style, signature accessories and colors in every cell, plain white background in every cell, thick clean outlines, no text except the small numbers."

python3 "$GPT_IMAGE_SKILL/scripts/gen_image.py" \
  --prompt "$PROMPT" \
  --image "$REF" \
  -m "${GPT_IMAGE_MODEL:-gpt-image-2}" --via images \
  --output "$OUT" --size "$SIZE" --timeout 300
echo "sheet saved: $OUT"

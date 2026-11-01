---
name: mascot-emo
description: >-
  为桌宠/吉祥物 IP 生成高清立绘与九宫格表情动作帧的完整管线：输入一句 IP
  描述（或已有立绘作参考图），产出透明底 320px 的主立绘 + 9 个表情状态帧
  （待机/大笑/说话/思考/惊讶/委屈/比心/睡觉/挥手），直接落位到
  dsh-plugin-prompt-tips 的皮肤目录。当用户要"给小精灵加表情 / 加动作 /
  新增一个 IP / 换形象 / 生成表情包帧 / mascot emo"时使用。
  依赖本机 gpt-image skill 的中转凭据（.env，不入库）。
---

# mascot-emo — 吉祥物立绘 + 九宫格表情管线

一条命令给「Prompt 小精灵」新增/更新一个 IP 皮肤：主立绘 + 9 个表情状态帧，
全部透明底 PNG，自动落位 `assets/skins/<id>/` 并可直接被皮肤清单引用。

## 表情状态位（与插件 UI 状态的约定映射）

| 帧名 | 插件状态 |
|---|---|
| idle | 待机（默认） |
| excited | 推荐成功 / 同步成功 |
| talk | 模型生成中（说话） |
| thinking | 同步进行中 / 思考 |
| surprised | 手动捞到一条（惊喜） |
| sad | 同步失败 / 推荐失败 |
| heart | 点击互动（比心） |
| sleep | 免打扰时段（quietHours） |
| wave | 打招呼（启动/点击） |

## 用法

```bash
# 1) 新增 IP：一句描述 → 立绘 + 表情帧，全流程
bash skill/mascot-emo/scripts/add_mascot.sh <skin-id> "<中文备注名>" "<英文形象描述>"

# 2) 只有立绘更新：重出表情 sheet（以现有 idle.png 为参考）
bash skill/mascot-emo/scripts/gen_emo_sheet.sh assets/skins/<id>/idle.png /tmp/emo-<id>.png

# 3) 裁切已有 sheet：3x3 → 9 帧透明 PNG
python3 skill/mascot-emo/scripts/cut_emo.py --sheet /tmp/emo-<id>.png --out assets/skins/<id>/emo

# 4) 收尾：把 <id> 加进 assets/skins/index.json（frames 指 idle.png/talk.png），
#    npm test 回归，docs/skin-<id>.png 更新预览。
```

## 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| skin-id | 皮肤目录名（kebab-case，如 `hologram-drop`） | 必填 |
| 备注名 | 皮肤清单里的中文名 | 必填 |
| 形象描述 | 英文一句：物种/配色/配件/表情基调 | 必填 |
| --size | 表情 sheet 尺寸 | 1024x1024 |

## 硬性约束（生成 prompt 的固定部分，勿删）

- genderless（中性，男女用户都能代入）；NOT human，no hair, no clothes；
- plain pure white background（抠图依赖白底泛洪）；
- full body, front view, centered（裁切与底线对齐依赖）；
- no text except cell numbers（九宫格编号由 cut_emo.py 涂白清除）；
- rich details, soft cel shading, thick clean outlines, kawaii style。

## 依赖

- `gpt-image` skill 的凭据（`.env`：GPT_IMAGE_BASE_URL / GPT_IMAGE_API_KEY）；
  本 skill 脚本默认读该路径，换线路用环境变量覆盖。
- Python3 + Pillow（抠图与裁切）。

## 生成策略（2026-11-01 实测结论）

| 方式 | 一致性 | 结论 |
|---|---|---|
| 九宫格 edits（参考图 + gpt-image-2） | 复杂 IP 普遍漂移（8/9 套漂成人形） | 仅低复杂度 IP 可用（全息水滴成功） |
| **单帧文生图重摇**（IP 文字描述 + 单动作） | **好**（4/4 帧特征保留） | **主推荐**：按帧单独生成，漂了单张重摇 |
| gpt-image edits 微编辑（只改嘴等） | 整图重绘漂移 | 不可用 |

单帧重摇模板（BASE 描述 + 动作覆盖）：

```
BASE = "<物种/配色/配件，从立绘提炼，固定不变>"
POSE = "<本帧动作/表情>"
prompt = "Cute genderless chibi mascot: $BASE $POSE Rich details, soft cel
shading, thick clean outlines, kawaii style, genderless mascot (not human,
no hair, no clothes), full body, front view, centered, plain pure white
background, no text, no watermark."
```

高漂移动作（趴睡等大姿势）不建议用生成帧：用 idle 帧 + 客户端 CSS
（透明度/滤镜/文案）表达即可。

## 已知限制

- talk 帧与 idle 帧差异由表情帧承担；说话动画仍由客户端 CSS bob 表达。
- 表情帧按 320px 高落位，对 132px 显示足够；更大展示位需提高生成尺寸
  （费用相应增加）。
- 单帧文生图对每个 (IP × 动作) 需要独立调用与人工质检，批量补帧时
  建议只做高频帧（excited/thinking/sad/heart），其余用 idle + CSS。

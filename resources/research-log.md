# dsh-prompt-tips 内置 prompt 资源库 — 抓取与整理日志

- 执行者：resources-curator（teammate）
- 会话日期：2026-11-01（沙盒 UTC 时钟核对：`2026-11-01T08:56:48Z`）
- 任务：task_37ef4e4808d8（需求 req_8cfd39ee3e81）
- 原始抓取物保存位置：`/tmp/dsh-prompt-tips-raw/`（项目内不留存任何原始 HTML/文本）
- 抓取方式：`curl --compressed -L`，浏览器 UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/126.0.0.0 Safari/537.36`，逐次记录 HTTP 状态与字节数于 `/tmp/dsh-prompt-tips-raw/fetch-log.txt`

## 0. 站点迁移与重定向备注

| 请求 URL | 实际落地（curl -L） | 说明 |
| --- | --- | --- |
| docs.anthropic.com/llms.txt | platform.claude.com/llms.txt | Anthropic 文档已迁移至 platform.claude.com |
| platform.openai.com/docs/guides/prompt-engineering | developers.openai.com/api/docs/guides/prompt-engineering | OpenAI 文档已迁移至 developers.openai.com，静态渲染，支持 `URL + .md` 取 Markdown 源 |
| cookbook.openai.com/sitemap.xml | developers.openai.com/cookbook/sitemap.xml | 404（HTML 404 页），cookbook 旧 sitemap 不存在 |

## 1. 抓取清单（时间均为 UTC，2026-11-01）

### 探查（未入 fetch-log.txt，手工补记）

| 时间(约) | URL | 状态 | 结果 |
| --- | --- | --- | --- |
| 08:55:2x | https://docs.anthropic.com/llms.txt | 200 | 首次探测 10,949 bytes（截断读取），完整文件 93,771 bytes |
| 08:55:3x | https://platform.openai.com/docs/guides/prompt-engineering | 200 | 探测 109,468 bytes；后续完整抓取 719,508 bytes |
| 08:55:4x | https://cookbook.openai.com/sitemap.xml | 404 | 479,758 bytes HTML 404 页 → 存为 probe.out |

> 事件记录：probe.out 一度遗留在项目根目录，违反「原始抓取不留在项目里」约定；已按 lead 反馈（fb_725edb1de872）移动至 `/tmp/dsh-prompt-tips-raw/probe-openai-cookbook-sitemap-404.html`，项目根目录已复核干净。

### fetch-log.txt 全量记录

```text
2026-11-01T08:57:47Z | https://docs.anthropic.com/llms.txt | HTTP 200 | 93771 bytes | final=https://platform.claude.com/llms.txt
2026-11-01T08:58:00Z | https://platform.claude.com/sitemap.xml | HTTP 200 | 412070 bytes
2026-11-01T08:58:39Z | https://platform.openai.com/docs/guides/prompt-engineering | HTTP 200 | 719508 bytes | final=https://developers.openai.com/api/docs/guides/prompt-engineering
2026-11-01T08:59:10Z | https://developers.openai.com/sitemap.xml | HTTP 404 | 479758 bytes
2026-11-01T09:00:26Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview.md | 200 | 1177 bytes
2026-11-01T09:00:30Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices.md | 200 | 21556 bytes
2026-11-01T09:00:32Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5.md | 200 | 7461 bytes
2026-11-01T09:00:35Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1.md | 200 | 16525 bytes
2026-11-01T09:00:39Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5.md | 200 | 5148 bytes
2026-11-01T09:00:42Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8.md | 200 | 6723 bytes
2026-11-01T09:00:44Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5.md | 200 | 5048 bytes
2026-11-01T09:00:46Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5.md | 200 | 9618 bytes
2026-11-01T09:00:50Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5.md | 200 | 6520 bytes
2026-11-01T09:00:55Z | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5.md | 200 | 8946 bytes
2026-11-01T09:00:58Z | https://platform.claude.com/docs/en/test-and-evaluate/develop-tests.md | 200 | 23603 bytes
2026-11-01T09:00:59Z | https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks.md | 200 | 4645 bytes
2026-11-01T09:01:02Z | https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-prompt-leak.md | 200 | 1621 bytes
2026-11-01T09:01:04Z | https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/increase-consistency.md | 200 | 5136 bytes
2026-11-01T09:01:11Z | https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations.md | 200 | 1854 bytes
2026-11-01T09:01:15Z | https://platform.claude.com/docs/en/release-notes/overview.md | 200 | 32072 bytes
2026-11-01T09:01:17Z | https://developers.openai.com/api/docs/llms.txt | 200 | 11290 bytes
2026-11-01T09:04:03Z | https://developers.openai.com/api/docs/changelog.md | 200 | 19984 bytes
2026-11-01T09:04:07Z | https://developers.openai.com/api/docs/deprecations.md | 200 | 7875 bytes
2026-11-01T09:04:09Z | https://developers.openai.com/api/docs/guides/prompt-engineering.md | 200 | 10823 bytes
2026-11-01T09:04:13Z | https://developers.openai.com/api/docs/guides/prompting.md | 200 | 1503 bytes
2026-11-01T09:04:17Z | https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6.md | 200 | 6886 bytes
2026-11-01T09:04:18Z | https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p5.md | 200 | 3884 bytes
2026-11-01T09:04:22Z | https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p4.md | 200 | 3326 bytes
2026-11-01T09:04:25Z | https://developers.openai.com/api/docs/guides/frontend-prompt.md | 200 | 3331 bytes
2026-11-01T09:04:27Z | https://developers.openai.com/api/docs/guides/latest-model/gpt-5.4.md | 200 | 20306 bytes
2026-11-01T09:04:33Z | https://developers.openai.com/api/docs/guides/latest-model/gpt-5.2.md | 200 | 16341 bytes
2026-11-01T09:04:35Z | https://developers.openai.com/api/docs/guides/live-prompting.md | 200 | 14643 bytes
2026-11-01T09:04:38Z | https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy.md | 200 | 10833 bytes
2026-11-01T09:04:41Z | https://developers.openai.com/api/docs/guides/reasoning-best-practices.md | 200 | 6779 bytes
2026-11-01T09:04:44Z | https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object.md | 200 | 3385 bytes
2026-11-01T09:04:48Z | https://developers.openai.com/api/docs/guides/voice-prompting.md | 200 | 27394 bytes
2026-11-01T09:06:40Z | https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5.md | 200 | 6314 bytes
2026-11-01T09:06:43Z | https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5.md | 200 | 6161 bytes
2026-11-01T09:06:47Z | https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5.md | 200 | 2759 bytes
2026-11-01T09:06:51Z | https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1.md | 200 | 10862 bytes
2026-11-01T09:06:53Z | https://developers.openai.com/api/docs/guides/responses-multi-agent.md | 200 | 9648 bytes
2026-11-01T09:06:58Z | https://developers.openai.com/api/docs/guides/reasoning.md | 200 | 14529 bytes
2026-11-01T09:07:03Z | https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling.md | 200 | 10163 bytes
```

## 2. sourceDate 日期锚定方法与证据

两站文档页面本身均不显示“最后更新时间”，sitemap（platform.claude.com/sitemap.xml）无 `<lastmod>`。因此每条 entry 的 `sourceDate` 均取自**同次抓取的官方日期性页面**，证据引文如下（可回溯复核）：

### Anthropic（日期锚点 = platform.claude.com/docs/en/release-notes/overview，已抓取 32,072 bytes）

| 模型 | Release notes 日期与引文（节选） | 指南 sourceDate |
| --- | --- | --- |
| Opus 4.8 | "### May 29, 2026 … We've launched **Claude Opus 4.8** (claude-opus-4-8), our most capable model." | 2026-05 |
| Fable 5 | "### June 9, 2026 … We've launched **Claude Fable 5** (claude-fable-5), our most capable model open to all customers" | 2026-06 |
| Sonnet 5 | "### June 30, 2026 … We've launched **Claude Sonnet 5** … For behavioral differences and model-specific prompting patterns, see [Prompting Claude Sonnet 5]"（引文直接链接该指南） | 2026-06 |
| Opus 5 | "### July 24, 2026 … We've launched **Claude Opus 5** (claude-opus-5), a step-change improvement over Claude Opus 4.8." | 2026-07 |
| Fable 5.1 | "### September 1, 2026 … We've launched **Claude Fable 5.1** (claude-fable-5-1)" | 2026-09 |
| Opus 5.5 | "### September 22, 2026 … We've launched **Claude Opus 5.5** (claude-opus-5-5)" | 2026-09 |
| Sonnet 5.5 | "### September 28, 2026 … We've launched **Claude Sonnet 5.5** … For model-specific prompting patterns, see [Prompting Claude Sonnet 5.5]"（引文直接链接该指南） | 2026-09 |
| Haiku 5.5 | "### October 7, 2026 … We've launched **Claude Haiku 5.5** … For model-specific prompting patterns, see [Prompting Claude Haiku 5.5]"（引文直接链接该指南） | 2026-10 |

> 取证口径：模型专属 prompting 指南随模型发布（release notes 在发布条目中直接链接 Sonnet 5 / Sonnet 5.5 / Haiku 5.5 的指南页，其余模型指南见于同批 llms.txt 索引）。此为文档页无可见日期时最接近“官方发布月份”的证据；已逐条记录，如需更严口径可复核各指南在发布条目中的链接关系。

### OpenAI（日期锚点 = developers.openai.com/api/docs/changelog 与 deprecations，均已抓取）

| 页面 | 证据引文（节选） | sourceDate |
| --- | --- | --- |
| prompt-guidance-gpt-5p6 | changelog "## July, 2026 … Released the [GPT-5.6 model family](…), including GPT-5.6 Sol for frontier capability …"（GPT-5.6 Sol 专属 prompting guidance 随该家族发布） | 2026-07 |
| live-prompting | changelog "## September, 2026 … [GPT-Live 1](…) is now generally available in the API. … Start with [GPT-Live], [prompting](…/guides/live-prompting), and [migration guidance]"（引文直接链接该指南） | 2026-09 |
| prompt-engineering（主指南） | 页内原文："OpenAI is deprecating reusable prompt objects in the API. Prompt creation will be de-emphasized beginning **June 3, 2026**, and `v1/prompts` is scheduled to shut down on **November 30, 2026**." → 页面最后更新不早于 2026-06；取可证明的最早更新月 | 2026-06 |
| prompting/migrate-from-prompt-object | 页内同一弃用公告 + deprecations.md "### 2026-06-03: Reusable prompts — On June 3, 2026, we notified developers using reusable prompts … See [Migrate from prompt objects]"（引文直接链接该指南） | 2026-06 |

> 取证口径：OpenAI 文档页无可见日期；`sourceDate` 采用“页面内容中可证明的官方日期性事件所在月份”（弃用公告 2026-06-03 / changelog 发布条目）。若某页无任何此类证据则不收录（见第 4 节）。

## 3. 收录条目（22 条）

vendor 分布：OpenAI 9 条、Anthropic 13 条。

| id | sourceDate | 模板取自（章节） | 日期依据 |
| --- | --- | --- | --- |
| openai-developer-message-structure | 2026-06 | prompt-engineering · "Message formatting with Markdown and XML" 示例 | 页内弃用公告（2026-06-03） |
| openai-few-shot-xml-examples | 2026-06 | prompt-engineering · "Few-shot learning" 示例 | 同上 |
| openai-agentic-persistence | 2026-06 | prompt-engineering · "Agentic tasks"（persistence/preamble 模板） | 同上 |
| openai-reasoning-vs-gpt-heuristic | 2026-06 | prompt-engineering · "Prompting reasoning models" | 同上 |
| openai-prompts-as-code | 2026-06 | migrate-from-prompt-object · "What changes" + "Example" | 页内弃用公告（2026-06-03）+ deprecations 同日条目 |
| openai-gpt56-lean-prompt-stack | 2026-07 | prompt-guidance-gpt-5p6 · "Simplify prompts first"（Trim/Keep 清单与量化数据） | changelog GPT-5.6 family（2026-07） |
| openai-gpt56-outcome-first-structure | 2026-07 | 同页 · "Outcome-first prompts and stopping conditions" + "Suggested prompt structure" | 同上 |
| openai-gpt56-autonomy-stop-rules | 2026-07 | 同页 · "Define autonomy and approval boundaries" | 同上 |
| openai-live-voice-prompt-template | 2026-09 | live-prompting · "Recommended prompt structure"（GPT-Live 官方模板） | changelog GPT-Live 1 GA（2026-09，引文链接本指南） |
| anthropic-haiku55-current-date-grounding | 2026-10 | prompting-claude-haiku-5-5 · "Accurate search results" | release notes 2026-10-07（引文链接本指南） |
| anthropic-haiku55-json-with-tools | 2026-10 | 同页 · "Use adaptive thinking with JSON output and your own tools" | 同上 |
| anthropic-chatbot-prompt-adherence | 2026-10 | 同页 · "Keep chatbots to their system prompt" | 同上 |
| anthropic-coding-agent-real-verification | 2026-09 | prompting-claude-sonnet-5-5 · "Verification on coding tasks"（同模板亦见于 Haiku 5.5 页） | release notes 2026-09-28 |
| anthropic-agent-keep-working-scope | 2026-09 | 同页 · "Steer initiative and scope" | 同上 |
| anthropic-opus5-concise-output | 2026-07 | prompting-claude-opus-5 · "Response length and verbosity" + tone_preference 标签示例 | release notes 2026-07-24 |
| anthropic-opus5-subagent-delegation | 2026-07 | 同页 · "Controlling subagent spawning"（并引 Opus 4.8 页同主题模板） | 同上 |
| anthropic-opus48-code-review-coverage | 2026-05 | prompting-claude-opus-4-8 · "Code review harnesses" | release notes 2026-05-29 |
| anthropic-frontend-anti-generic-aesthetics | 2026-05 | 同页 · "Design and frontend defaults"（frontend_aesthetics 标签 + 提案模板） | 同上 |
| anthropic-fable5-progress-audit | 2026-06 | prompting-claude-fable-5 · "Ground progress claims during long runs" + "Rare cases of early stopping" | release notes 2026-06-09 |
| anthropic-opus55-pasted-content-isolation | 2026-09 | prompting-claude-opus-5-5 · "Mark pasted text in user messages" | release notes 2026-09-22 |
| anthropic-opus55-explore-before-acting | 2026-09 | 同页 · "Explore context in multiapp workflows" | 同上 |
| anthropic-opus55-time-budget | 2026-09 | 同页 · "Time signals for multiagent harnesses" | 同上 |

每条 entry 的 `prompt`（中文说明 + 英文模板原文）与 `why` 均转录/概述自上表对应章节的实际抓取正文，全部 `verified: true`；`fetchedAt: 2026-11-01`。

## 4. 已抓取但未收录（宁缺毋滥，含原因）

| 页面 | 原因 |
| --- | --- |
| upgrading-to-gpt-5p5、frontend-prompt（GPT-5.5） | changelog "## April, 2026 … Released GPT-5.5" → 发布月 2026-04，早于 2026-05 下限 |
| upgrading-to-gpt-5p4、latest-model/gpt-5.4 | changelog "## March, 2026 … Released GPT-5.4" → 2026-03，超窗 |
| latest-model/gpt-5.2 | 更早期模型，超窗 |
| voice-prompting（Realtime）、reasoning-best-practices、optimizing-llm-accuracy、prompting（hub 页，1,503 bytes） | 内容已抓到，但页面与站点均无可验证日期（无 frontmatter 日期、无 lastmod、changelog 无对应发布记录）→ 按硬性规则不收 |
| Anthropic prompt-engineering/overview、claude-prompting-best-practices、test-and-evaluate 四页（develop-tests/mitigate-jailbreaks/reduce-prompt-leak/increase-consistency/reduce-hallucinations） | 同上：无可验证日期，未收录 |
| responses-multi-agent、reasoning、tools-programmatic-tool-calling | 可锚定 2026-07（GPT-5.6 changelog 引用），但内容为工具编排/API 功能说明，非可直接复制的 prompt 技巧模板，未精读未收录 |
| Anthropic whats-new ×4（sonnet-5-5 / opus-5-5 / haiku-5-5 / fable-5-1）、migration guides | 已抓取，作为日期与行为佐证材料，未单独成条 |
| prompting-claude-fable-5-1（16,525 bytes） | 已抓取未精读；Anthropic 侧条目已足量，未收录 |

## 5. 校验结果（scripts/validate-resources.mjs）

### 正向（项目内真实文件）

```text
$ node scripts/validate-resources.mjs
resources OK: 22 entries
退出码：0
```

### 负向（/tmp 沙盒副本注入 9 类缺陷：坏 id、超窗日期、tags 不足、why 过短、summary 超长、verified=false、重复 id、非官方 URL、prompt 超长）

```text
resources INVALID: 9 problem(s) found
- entries[22].id must be kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$), got "Bad_ID"
- entries[22].sourceDate 2025-12 is older than the 2026-05 floor (>6 months old content is not allowed)
- entries[22].tags must be an array of 3-5 non-empty strings
- entries[22].why must be 100-500 characters, got 2
- entries[22].summary must be 1-60 characters, got 61
- entries[22].verified must be exactly true (only include entries verified against fetched official pages)
- entries[23].id duplicated: "openai-agentic-persistence"
- entries[23].sourceUrl must be an official http(s) URL, got "https://example.com/x"
- entries[23].prompt length 2001 exceeds the 2000-character limit
退出码：1
```

## 6. 产物与边界声明

- 产出：`resources/index.json`（22 条）、`scripts/validate-resources.mjs`、本日志。
- 项目内未改动其他任何路径；原始抓取物与构建脚本（build-index.mjs）均在 `/tmp/dsh-prompt-tips-raw/`。
- 诚信声明：所有条目内容均转录自上表实际抓取的页面正文；无法验证日期或内容的一律未收录（第 4 节）。

## 7. 数据治理 v2（同日追记，用户反馈三项整改的数据部分）

- 执行者：lead（主会话）；治理脚本 `scripts/clean-prompts-v2.mjs`（幂等、带断言）。
- **promptEn 净化**：6 条混入的中文衔接语/整理注全部移出至框外 `officialNote`
  （few-shot 尾注、gpt56-autonomy「配套要点」、haiku55-date 连接段、
  opus5-concise「官方另提示」、opus48-code-review 中文混排段、lean-prompt-stack
  补回官方英文标题 Trim:/Keep:）。净化后逐条对照 `/tmp/dsh-prompt-tips-raw/`
  的抓取原文核对：lean-prompt-stack 的官方小节标题确为 "Trim:"/"Keep:"；
  opus48 单遍自滤句补为官方原句（含引导语，出自 anth-pe-opus48.md L154）。
- **promptZh 重译**：22 条全部重写为 promptEn 的 1:1 中文翻译（代码块保留原文）。
- **条目替换**：`openai-reasoning-vs-gpt-heuristic`（官方页 "Prompting reasoning
  models" 一节经核对此前抓取正文 oai-pe-guide.md L963-972，确实只有心智模型
  两句比喻、无任何可复制提示词）→ 替换为同页官方样例提示词
  `openai-zero-to-one-webapp-prompt`（"Prompting current models · Zero-to-one
  web apps" 代码块逐字，HTML 实体 `&lt;ONE_SHOT_RUBRIC&gt;` 还原为
  `<ONE_SHOT_RUBRIC>`）。日期锚点沿用该页 2026-06 证据，未新增来源页面。
  reasoning-best-practices 页（第 4 节原判「无可验证日期」）维持不收录。
- `prompt`（合并字段）自此与 `promptEn` 一致；资源库版本 1.0.0 → 1.1.0。
- 复核：`node scripts/validate-resources.mjs` → resources OK: 22 entries
  （校验器同步新增两条硬规则：promptEn 无 CJK、prompt === promptEn）。

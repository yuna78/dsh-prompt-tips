/**
 * Smoke tests for `dsh-plugin-prompt-tips` — pure functions only, no Cordis
 * context, no network. Every failure exits non-zero with a Chinese reason.
 */
import assert from 'node:assert/strict';
import {
  ROUTES, MAX_HISTORY, MIN_SOURCE_MONTH, DEFAULT_SYNC_URL,
  normaliseConfig, validateResources, pickEntry, buildBubble, offlineWhy,
  buildHeadlessPrompt, parseSkins, recentEntryIds, isQuietAt, quietEnd,
  startOfLocalDay, extractJson, resolveStatePath, resolveSyncedResourcesPath,
  headlessOverlayPath, hostPatchPath, extractLlmPatchEntries, childHeadlessEnv,
  lastFinalText, friendlyHeadlessError, normaliseWhy, backfillSplitFields,
} from '../index.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error?.stack ?? error);
    process.exit(1);
  }
};

const goodEntry = (overrides = {}) => ({
  id: 'anthropic-xml-tags',
  title: '用 XML 标签给模型分区',
  sourceVendor: 'anthropic',
  sourceUrl: 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/xml-tags',
  sourceDate: '2026-08',
  fetchedAt: '2026-11-01',
  tags: ['结构化', 'XML标签'],
  prompt: '把背景放在 <context> 标签里，把任务放在 <task> 标签里……',
  why: '标签让模型清楚哪段是什么，输出更稳。',
  summary: '用 XML 标签分区，减少指令混淆。',
  verified: true,
  ...overrides,
});
const goodIndex = (entries = [goodEntry(), goodEntry({ id: 'openai-few-shot', title: '少样本示例', sourceVendor: 'openai' })]) => ({
  version: '1.0.0',
  generatedAt: '2026-11-01T00:00:00.000Z',
  sources: [{ name: 'Anthropic Docs', url: 'https://docs.anthropic.com' }],
  entries,
});

// --- surface ---------------------------------------------------------------
test('ROUTES 覆盖 6 条路由且前缀统一', () => {
  for (const key of ['state', 'pick', 'dismiss', 'asset', 'skin', 'sync']) {
    assert.ok(ROUTES[key]?.startsWith('/api/dsh-prompt-tips.'), key);
  }
});
test('MAX_HISTORY = 10 且 normaliseConfig 钳制在 10 以内', () => {
  assert.equal(MAX_HISTORY, 10);
  assert.equal(normaliseConfig({ maxHistory: 50 }).maxHistory, 10);
  assert.equal(normaliseConfig({}).maxHistory, 10);
});
test('默认配置与钳制', () => {
  const cfg = normaliseConfig({});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.everySeconds, 3600);
  assert.deepEqual(cfg.quietHours, [2, 8]);
  assert.equal(cfg.headless, true);
  assert.equal(cfg.syncUrl, DEFAULT_SYNC_URL);
  assert.equal(normaliseConfig({ everySeconds: 1 }).everySeconds, 60);
  assert.equal(normaliseConfig({ everySeconds: null }).everySeconds, 3600);
});
test('状态与同步资源落盘路径可用 env 覆盖', () => {
  const env = { DSH_PROMPT_TIPS_STATE: '/tmp/a.json', DSH_PROMPT_TIPS_RESOURCES: '/tmp/b.json' };
  assert.equal(resolveStatePath(env), '/tmp/a.json');
  assert.equal(resolveSyncedResourcesPath(env), '/tmp/b.json');
});

// --- time helpers ----------------------------------------------------------
test('isQuietAt 处理跨午夜窗口', () => {
  const at = (h) => new Date(2026, 10, 1, h, 0);
  assert.equal(isQuietAt(at(3), [2, 8]), true);
  assert.equal(isQuietAt(at(9), [2, 8]), false);
  assert.equal(isQuietAt(at(23), [22, 7]), true);
  assert.equal(isQuietAt(at(12), [22, 7]), false);
  assert.equal(isQuietAt(at(3), [4, 4]), false);
});
test('quietEnd 指向窗口结束时刻', () => {
  const end = quietEnd(new Date(2026, 10, 1, 3, 30), [2, 8]);
  assert.equal(end.getHours(), 8);
  assert.equal(end.getMinutes(), 0);
});
test('startOfLocalDay 归零', () => {
  const d = new Date(2026, 10, 1, 15, 42, 9);
  assert.deepEqual(new Date(startOfLocalDay(d)), new Date(2026, 10, 1, 0, 0, 0, 0));
});

// --- resource validation ---------------------------------------------------
test('MIN_SOURCE_MONTH 为 2026-05（太老的不要）', () => {
  assert.equal(MIN_SOURCE_MONTH, '2026-05');
});
test('合法资源库通过校验', () => {
  assert.deepEqual(validateResources(goodIndex()), []);
});
test('缺字段 / 旧日期 / 重复 id / verified=false 全部被拒', () => {
  const problems = validateResources(goodIndex([
    goodEntry({ sourceDate: '2025-01' }),                       // 太老
    goodEntry({ id: 'anthropic-xml-tags' }),                    // 重复 id
    goodEntry({ id: 'no-verified', verified: false }),          // 未核实
    goodEntry({ id: 'no-why', why: '' }),                       // 理由为空
    goodEntry({ id: 'bad-url', sourceUrl: 'ftp://x' }),         // URL 非法
  ]));
  assert.equal(problems.length, 5, problems.join('；'));
  assert.match(problems.join('\n'), /早于下限/);
  assert.match(problems.join('\n'), /id 重复/);
});
test('根节点不是对象 / entries 非数组 / 空库 被拒', () => {
  assert.ok(validateResources(null).length >= 1);
  assert.ok(validateResources({ entries: 'x' }).length >= 1);
  assert.ok(validateResources({ version: '1', entries: [] }).length >= 1);
});
test('promptZh/promptEn 可选字段：齐备通过，空值拒绝', () => {
  const ok = goodIndex([goodEntry({ promptZh: '中文翻译', promptEn: 'EN template' })]);
  assert.deepEqual(validateResources(ok), []);
  const emptyZh = goodIndex([goodEntry({ promptZh: '' })]);
  assert.ok(validateResources(emptyZh).length >= 1);
  const emptyEn = goodIndex([goodEntry({ promptEn: '  ' })]);
  assert.ok(validateResources(emptyEn).length >= 1);
  const emptyNote = goodIndex([goodEntry({ officialNote: '' })]);
  assert.ok(validateResources(emptyNote).length >= 1, 'officialNote 空值应拒绝');
  const okNote = goodIndex([goodEntry({ officialNote: '官方说明正文', officialNoteEn: 'note' })]);
  assert.deepEqual(validateResources(okNote), [], 'officialNote/officialNoteEn 非空应通过');
});

// --- picking ---------------------------------------------------------------
test('pickEntry 避开最近推荐，全在最近时回落全库', () => {
  const entries = [goodEntry(), goodEntry({ id: 'b' }), goodEntry({ id: 'c' })];
  const pick = pickEntry(entries, ['anthropic-xml-tags', 'b'], 0);
  assert.equal(pick.entry.id, 'c');
  const fallback = pickEntry(entries, ['anthropic-xml-tags', 'b', 'c'], 0);
  assert.ok(entries.some((e) => e.id === fallback.entry.id));
  assert.equal(pickEntry([], []), null);
});
test('recentEntryIds 只取最近 N 条且去非字符串', () => {
  const bubbles = Array.from({ length: 12 }, (_, i) => ({ entryId: `e${i}` }));
  assert.equal(recentEntryIds(bubbles).length, 7);
  assert.deepEqual(recentEntryIds([{ entryId: 'x' }, {}, null]), ['x']);
});

// --- bubble ----------------------------------------------------------------
test('buildBubble 逐字保留 prompt 并记录字数与模式', () => {
  const entry = goodEntry();
  const bubble = buildBubble(entry, offlineWhy(entry), 'offline', new Date('2026-11-01T12:00:00Z'));
  assert.equal(bubble.prompt, entry.prompt);
  assert.equal(bubble.mode, 'offline');
  assert.equal(bubble.entryId, entry.id);
  assert.equal(bubble.chars, [...entry.prompt].length);
  assert.equal(bubble.read, false);
  assert.ok(bubble.id.startsWith(`${entry.id}-`));
});
test('buildBubble 透传资源库的中英拆分字段（非空才带）', () => {
  const split = goodEntry({ promptZh: '中文翻译', promptEn: 'EN template', officialNote: '官方说明正文' });
  const withSplit = buildBubble(split, offlineWhy(split), 'offline');
  assert.equal(withSplit.promptZh, '中文翻译');
  assert.equal(withSplit.promptEn, 'EN template');
  assert.equal(withSplit.officialNote, '官方说明正文');
  assert.ok(!('officialNoteEn' in withSplit), '条目没有的字段不得产生空键');
  const plain = buildBubble(goodEntry(), offlineWhy(goodEntry()), 'offline');
  assert.ok(!('promptZh' in plain), '无拆分数据的条目不得产生空 promptZh 键');
  assert.ok(!('promptEn' in plain), '无拆分数据的条目不得产生空 promptEn 键');
  assert.ok(!('officialNote' in plain), '无官方说明的条目不得产生空 officialNote 键');
  const blank = buildBubble(goodEntry({ promptZh: '  ' }), offlineWhy(goodEntry()), 'offline');
  assert.ok(!('promptZh' in blank), '空白拆分字段不透传');
});
test('backfillSplitFields 按 entryId 回填旧气泡缺失的拆分字段', () => {
  const entries = [
    goodEntry({ id: 'e1', promptZh: '中文翻译', promptEn: 'EN template', officialNote: '注释', officialNoteEn: 'note' }),
    goodEntry({ id: 'e2' }),
  ];
  const bubbles = [{ entryId: 'e1', prompt: 'p' }, { entryId: 'e2' }, { entryId: 'ghost' }, null];
  const filled = backfillSplitFields(bubbles, entries);
  assert.equal(filled, 4, 'e1 补齐四个字段，其余不补');
  assert.equal(bubbles[0].promptZh, '中文翻译');
  assert.equal(bubbles[0].promptEn, 'EN template');
  assert.equal(bubbles[0].officialNote, '注释');
  assert.equal(bubbles[0].officialNoteEn, 'note');
  assert.ok(!('promptZh' in bubbles[1]), '资源库无拆分数据的条目不回填');
  // promptZh 语义已改为「EN 模板的 1:1 中文翻译」：旧值一律以资源库覆盖；
  // 其余字段已有值保持不覆盖（只增不删）。
  const keep = [{ entryId: 'e1', promptZh: '旧讲解', officialNote: '旧注' }];
  backfillSplitFields(keep, entries);
  assert.equal(keep[0].promptZh, '中文翻译', 'promptZh 以资源库现值覆盖');
  assert.equal(keep[0].officialNote, '旧注', 'officialNote 已有值不覆盖');
});
test('offlineWhy 使用资料库预写理由并截断到 500', () => {
  assert.equal(offlineWhy(goodEntry()), '标签让模型清楚哪段是什么，输出更稳。');
  const long = goodEntry({ why: '好'.repeat(600) });
  assert.equal(offlineWhy(long).length, 500);
});

// --- headless prompt -------------------------------------------------------
test('buildHeadlessPrompt 内嵌条目原文并约束只输出 JSON', () => {
  const entry = goodEntry();
  const prompt = buildHeadlessPrompt(entry, { businessContext: '独立开发者', recentTitles: ['旧条目'] });
  assert.match(prompt, /逐字保留/);
  assert.ok(prompt.includes(entry.prompt));
  assert.ok(prompt.includes('独立开发者'));
  assert.ok(prompt.includes('- 旧条目'));
  assert.match(prompt, /"why"/);
});
test('extractJson 能从围栏与闲话中抠出 JSON', () => {
  assert.deepEqual(extractJson('前言```json\n{"why":"x"}\n```后记'), { why: 'x' });
  assert.equal(extractJson('没有对象'), null);
});

// --- skins -----------------------------------------------------------------
test('parseSkins 合法清单原样保留，非法回落默认皮肤', () => {
  const manifest = { skins: [
    { id: 'pixel-ghost', name: '像素小幽灵', dir: 'pixel-ghost', accent: '#5eead4', frames: { idle: 'idle.svg', talk: 'talk.svg' } },
    { id: 'broken', dir: 'broken', frames: null },
  ] };
  const skins = parseSkins(manifest);
  assert.equal(skins.length, 1);
  assert.equal(skins[0].id, 'pixel-ghost');
  const fallback = parseSkins(null);
  assert.equal(fallback[0].id, 'hologram-drop');
  assert.equal(fallback[0].default, true);
});

// --- headless bridge (T4) --------------------------------------------------
test('profile 默认 headless，可通过配置覆盖', () => {
  assert.equal(normaliseConfig({}).profile, 'headless');
  assert.equal(normaliseConfig({ profile: 'mine' }).profile, 'mine');
});
test('extractLlmPatchEntries 只取 llm 相关顶层块', () => {
  const patch = [
    '- id: dsh-prompt-tips',
    '  name: dsh-plugin-prompt-tips',
    '  config:',
    '    enabled: true',
    '',
    '- id: agent-default-model',
    '  name: x',
    '  config:',
    '    model: deepseek-chat',
    '',
    "- id: provider",
    "  name: '@deepseek-ai/dsh-llm-deepseek-api-key'",
    '  config:',
    '    apiKeyEnv: DEEPSEEK_API_KEY',
  ].join('\n');
  const entries = extractLlmPatchEntries(patch);
  assert.equal(entries.length, 2);
  assert.match(entries[0], /agent-default-model/);
  assert.match(entries[1], /apiKeyEnv: DEEPSEEK_API_KEY/);
  assert.equal(extractLlmPatchEntries('没有顶层块').length, 0);
});
test('childHeadlessEnv 从凭据 refs 补齐缺失的 apiKeyEnv', () => {
  const env = { HOME: '/tmp/home', DEEPSEEK_API_KEY: 'explicit' };
  const overlay = '- id: p\n  config:\n    apiKeyEnv: DEEPSEEK_API_KEY\n    apiKeyEnv: OPENAI_API_KEY';
  const child = childHeadlessEnv(overlay, env);
  assert.equal(child.DEEPSEEK_API_KEY, 'explicit'); // 显式 env 优先
  assert.equal(child.DSH_PROMPT_TIPS_CHILD, '1');
});
test('lastFinalText 保留最后一个 final 事件', () => {
  const stream = [
    '{"type":"text","text":"第一段"}',
    '不是 JSON 的行',
    '{"type":"final","text":"最终答案"}',
  ].join('\n');
  assert.equal(lastFinalText(stream), '最终答案');
  assert.equal(lastFinalText(''), '');
});
test('normaliseWhy 拒绝过短理由、截断过长理由', () => {
  assert.equal(normaliseWhy('太短'), '');
  assert.equal(normaliseWhy('这条理由足够长，可以用来展示为什么值得学。').length >= 10, true);
  assert.equal(normaliseWhy('好'.repeat(600)).length, 500);
});
test('friendlyHeadlessError 给出可操作的修复提示', () => {
  assert.match(friendlyHeadlessError('x MISSING_CREDENTIAL y'), /Models 页/);
  assert.match(friendlyHeadlessError('spawn dsh ENOENT'), /dshBin/);
  assert.equal(friendlyHeadlessError('其他错误'), '其他错误');
});
test('headlessOverlayPath 与 hostPatchPath 遵循 env', () => {
  const env = { DSH_HOME: '/tmp/dsh-home', DSH_PROFILE: 'web' };
  assert.equal(headlessOverlayPath(env), '/tmp/dsh-home/storages/dsh-prompt-tips.headless-overlay.yml');
  assert.equal(hostPatchPath(env), '/tmp/dsh-home/profiles/web/cordis.patch.yml');
  assert.equal(hostPatchPath({ DSH_PROFILE_DIR: '/tmp/prof' }), '/tmp/prof/cordis.patch.yml');
});

console.log(`\nsmoke OK: ${passed} tests passed`);

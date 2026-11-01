/**
 * Host half of `dsh-plugin-prompt-tips` — 「Prompt 小精灵」.
 *
 * Responsibilities:
 *   - keep one durable snapshot: which prompt entries were recommended, the
 *     sprite skin in use, and when the next hourly recommendation fires;
 *   - every hour, pick one entry from the bundled (or synced-over) resource
 *     library and turn it into a bubble: the verbatim prompt, why it is worth
 *     learning, and where it comes from. The library — not the model — owns the
 *     prompt text; a headless model call only personalises the "why" (v0.2),
 *     and any failure degrades to the library's own pre-written reason,
 *     clearly labelled `offline`;
 *   - expose same-origin routes the Web client polls: state / pick / dismiss /
 *     asset / skin / sync;
 *   - `sync` pulls a newer manifest from the project's published URL, validates
 *     every field, and only then atomically replaces the local copy — a bad
 *     remote payload never touches disk.
 *
 * Only Node builtins are imported: this package must load from a profile's
 * node_modules without resolving any DSH-internal module.
 */
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const name = 'dsh-prompt-tips';
// `connection` gives us same-origin HTTP routes; `timer` is what makes
// `ctx.timeout()` available — Cordis refuses the property without the inject.
export const inject = ['connection', 'timer'];

/** Route namespace; the Web client polls these. */
export const ROUTES = {
  state: '/api/dsh-prompt-tips.state',
  pick: '/api/dsh-prompt-tips.pick',
  dismiss: '/api/dsh-prompt-tips.dismiss',
  asset: '/api/dsh-prompt-tips.asset',
  skin: '/api/dsh-prompt-tips.skin',
  sync: '/api/dsh-prompt-tips.sync',
};

const PET_NAME = 'Prompt 小精灵';
const DAY = 86400000;
/** Hard client-side history budget (需求 6：上一条/下一条最多 10 条). */
export const MAX_HISTORY = 10;
/** Recent entry ids kept out of the next pick, so hours never repeat. */
const RECENT_PICK_WINDOW = 7;
/** The 9 emotion frames every full skin ships under `emo/` (mascot-emo skill). */
export const EMO_FRAMES = ['idle', 'excited', 'talk', 'thinking', 'surprised', 'sad', 'heart', 'sleep', 'wave'];

/** Where the published library lives by default; overridable in config. */
export const DEFAULT_SYNC_URL =
  'https://raw.githubusercontent.com/yuna78/dsh-prompt-tips/main/resources/index.json';

export class PromptTipsError extends Error {}

// ---------------------------------------------------------------------------
// Pure helpers (exported so `verify/` can test them without a Cordis context)
// ---------------------------------------------------------------------------

/** Normalise user configuration; every field has a safe default. */
export function normaliseConfig(config) {
  const raw = config && typeof config === 'object' ? config : {};
  const int = (value, fallback, min, max) => {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const quiet = Array.isArray(raw.quietHours) && raw.quietHours.length === 2
    ? [int(raw.quietHours[0], 2, 0, 23), int(raw.quietHours[1], 8, 0, 23)]
    : [2, 8];
  return {
    enabled: raw.enabled !== false,
    everySeconds: int(raw.everySeconds, 3600, 60, 7 * 24 * 3600),
    firstDelaySeconds: int(raw.firstDelaySeconds, 90, 1, 3600),
    quietHours: quiet,
    maxHistory: int(raw.maxHistory, MAX_HISTORY, 1, MAX_HISTORY),
    dailyLimit: int(raw.dailyLimit, 24, 0, 500),
    headless: raw.headless !== false,
    dshBin: typeof raw.dshBin === 'string' && raw.dshBin.trim() ? raw.dshBin.trim() : 'dsh',
    profile: typeof raw.profile === 'string' && raw.profile.trim() ? raw.profile.trim() : 'headless',
    timeoutMs: int(raw.timeoutMs, 120000, 10000, 900000),
    syncUrl: typeof raw.syncUrl === 'string' && raw.syncUrl.trim() ? raw.syncUrl.trim() : DEFAULT_SYNC_URL,
    syncTimeoutMs: int(raw.syncTimeoutMs, 30000, 5000, 300000),
    businessContext: typeof raw.businessContext === 'string' ? raw.businessContext.trim() : '',
    skinId: typeof raw.skinId === 'string' ? raw.skinId.trim() : '',
  };
}

export function resolveDshHome(env = process.env) {
  if (env.DSH_HOME && env.DSH_HOME.trim()) return env.DSH_HOME.trim();
  return join(env.HOME || homedir() || process.cwd(), '.dsh');
}

/** Durable snapshot location; overridable for tests and isolated profiles. */
export function resolveStatePath(env = process.env) {
  const override = env.DSH_PROMPT_TIPS_STATE;
  if (override && override.trim()) return override.trim();
  return join(resolveDshHome(env), 'storages', 'dsh-prompt-tips.json');
}

/** Where a synced-over library is stored, ahead of the bundled copy. */
export function resolveSyncedResourcesPath(env = process.env) {
  const override = env.DSH_PROMPT_TIPS_RESOURCES;
  if (override && override.trim()) return override.trim();
  return join(resolveDshHome(env), 'storages', 'dsh-prompt-tips.resources.json');
}

/** Local wall-clock hour, used only for the quiet window. */
export function isQuietAt(date, [start, end]) {
  const hour = date.getHours();
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** The next moment after `date` at which the quiet window ends. */
export function quietEnd(date, [start, end]) {
  const at = new Date(date.getTime());
  if (start === end) return at;
  const hour = at.getHours();
  const inWindow = start < end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!inWindow) return at;
  at.setMinutes(0, 0, 0);
  at.setHours(end);
  if (inWindow && start > end && hour < end) {
    // Wrapped window (e.g. 22→7), early morning: end is today.
    at.setDate(at.getDate());
  }
  return at;
}

/** Start of the local calendar day, used for the per-day cap. */
export function startOfLocalDay(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Pull the first JSON object out of a model answer (fences, chatter, etc.).
 * Every field is still validated by the caller, so a greedy slice is safe.
 */
export function extractJson(text) {
  const source = String(text ?? '');
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : source;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const VENDORS = ['openai', 'anthropic'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Entries older than this month are rejected outright (需求 3：太老的不要). */
export const MIN_SOURCE_MONTH = '2026-05';
const monthKey = (value) => String(value ?? '').slice(0, 7);

/**
 * Validate a resource-library payload. Used both when loading the bundled
 * library and — crucially — before anything fetched by `sync` may touch disk.
 * Returns a list of human-readable problems; empty means valid.
 */
export function validateResources(index) {
  const errors = [];
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    return ['资源库根节点必须是对象'];
  }
  if (typeof index.version !== 'string' || !index.version.trim()) {
    errors.push('缺少 version 字符串');
  }
  if (!Array.isArray(index.entries)) {
    errors.push('缺少 entries 数组');
    return errors;
  }
  if (index.entries.length < 1) errors.push('entries 为空');
  const seen = new Set();
  index.entries.forEach((entry, i) => {
    const at = `entries[${i}]`;
    const fail = (msg) => errors.push(`${at}: ${msg}`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail('条目必须是对象');
    const id = typeof entry.id === 'string' ? entry.id : '';
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return fail(`id 非法：${clip(id, 40)}`);
    if (seen.has(id)) return fail(`id 重复：${id}`);
    seen.add(id);
    if (typeof entry.title !== 'string' || !entry.title.trim()) fail('title 为空');
    if (!VENDORS.includes(entry.sourceVendor)) fail(`sourceVendor 必须是 ${VENDORS.join('/')}`);
    if (typeof entry.sourceUrl !== 'string' || !/^https?:\/\/\S+$/.test(entry.sourceUrl)) fail('sourceUrl 非法');
    if (!MONTH_RE.test(entry.sourceDate ?? '')) fail('sourceDate 必须是 YYYY-MM');
    else if (monthKey(entry.sourceDate) < MIN_SOURCE_MONTH) fail(`sourceDate 早于下限 ${MIN_SOURCE_MONTH}（太老的不要）`);
    if (typeof entry.fetchedAt !== 'string' || !entry.fetchedAt.trim()) fail('fetchedAt 为空');
    if (!Array.isArray(entry.tags) || entry.tags.length < 1) fail('tags 为空');
    else if (entry.tags.some((t) => typeof t !== 'string' || !t.trim())) fail('tags 含空标签');
    const promptLen = typeof entry.prompt === 'string' ? entry.prompt.length : 0;
    if (promptLen < 1) fail('prompt 为空');
    else if (promptLen > 2000) fail(`prompt 超长（${promptLen} > 2000）`);
    // Optional zh/en split (produced by scripts/split-prompt-zh-en.mjs) and
    // the official note (scripts/split-official-note.mjs): when present the
    // values must be non-empty so the client can toggle views / render the
    // note outside the prompt box.
    for (const key of ['promptZh', 'promptEn', 'officialNote', 'officialNoteEn']) {
      const v = entry[key];
      if (v !== undefined && (typeof v !== 'string' || !v.trim())) fail(`${key} 存在时必须非空`);
    }
    const whyLen = typeof entry.why === 'string' ? entry.why.length : 0;
    if (whyLen < 1) fail('why 为空');
    else if (whyLen > 500) fail(`why 超长（${whyLen} > 500）`);
    if (typeof entry.summary !== 'string' || !entry.summary.trim()) fail('summary 为空');
    else if (entry.summary.length > 60) fail('summary 超长（> 60）');
    if (entry.verified !== true) fail('verified 必须为 true');
  });
  return errors;
}

/** Rotate through the library, skipping everything recently recommended. */
export function pickEntry(entries, recentIds = [], seed = Date.now()) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const recent = new Set(recentIds.filter((id) => typeof id === 'string'));
  const fresh = entries.filter((entry) => entry && typeof entry.id === 'string' && !recent.has(entry.id));
  const pool = fresh.length ? fresh : entries;
  const cursor = Math.abs(Math.trunc(Number(seed) || 0)) % pool.length;
  return { entry: pool[cursor], index: cursor, total: pool.length };
}

/** The library's own pre-written reason — the offline fallback, never faked. */
export function offlineWhy(entry) {
  return clip(entry?.why, 500) || '这条来自官方资料库，值得直接抄用。';
}

/** Assemble one bubble from a library entry + a reason in the given mode. */
export function buildBubble(entry, why, mode, now = new Date()) {
  const prompt = String(entry?.prompt ?? '');
  const bubble = {
    id: `${entry.id}-${now.getTime().toString(36)}`,
    at: now.toISOString(),
    entryId: entry.id,
    title: clip(entry.title, 60),
    vendor: entry.sourceVendor,
    sourceUrl: entry.sourceUrl,
    sourceDate: entry.sourceDate,
    tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 5) : [],
    prompt,
    why: clip(why, 500),
    mode: mode === 'headless' ? 'headless' : 'offline',
    read: false,
    chars: [...prompt].length,
  };
  // 中英拆分（scripts/clean-prompts-v2.mjs 的治理产物）：promptEn=纯官方
  // 可复制提示词，promptZh=它的 1:1 中文翻译。非空才透传，客户端据此渲染
  // 「中文翻译 / EN 模板」切换；缺失时保持无键（切换自动隐藏）。
  // officialNote/officialNoteEn 由数据治理拆出——官方说明不是提示词本体，
  // 客户端把它渲染在提示词框外。
  for (const key of ['promptZh', 'promptEn', 'officialNote', 'officialNoteEn']) {
    if (typeof entry?.[key] === 'string' && entry[key].trim()) bubble[key] = entry[key];
  }
  return bubble;
}

/**
 * 旧气泡回填：拆分字段晚于部分已生成的推荐，boot 时按 entryId 从资源库
 * 补齐缺失的 promptEn/officialNote/officialNoteEn（只增不删）。promptZh
 * 例外：它的语义已改为「EN 模板的 1:1 中文翻译」（v0.2 数据治理），旧气泡
 * 存的是中文讲解，因此一律以资源库现值覆盖——资源库是唯一事实源。
 * 返回回填数。
 */
export function backfillSplitFields(bubbles, entries) {
  if (!Array.isArray(bubbles) || !Array.isArray(entries)) return 0;
  const byId = new Map(entries.filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  let filled = 0;
  for (const bubble of bubbles) {
    if (!bubble || typeof bubble.entryId !== 'string') continue;
    const entry = byId.get(bubble.entryId);
    if (!entry) continue;
    for (const key of ['promptEn', 'officialNote', 'officialNoteEn']) {
      if (bubble[key] === undefined && typeof entry[key] === 'string' && entry[key].trim()) {
        bubble[key] = entry[key];
        filled += 1;
      }
    }
    if (typeof entry.promptZh === 'string' && entry.promptZh.trim() && bubble.promptZh !== entry.promptZh) {
      bubble.promptZh = entry.promptZh;
      filled += 1;
    }
  }
  return filled;
}

/**
 * The headless prompt used by the v0.2 personaliser: the library text is
 * quoted verbatim inside the prompt and the model may only rephrase `why`.
 */
export function buildHeadlessPrompt(entry, options = {}) {
  const { businessContext = '', recentTitles = [] } = options;
  const context = businessContext
    ? `用户的工作背景：${businessContext}`
    : '用户是一位使用 AI 编程工具的开发者。';
  const recent = recentTitles.length
    ? `最近已经推荐过（不要重复其角度）：\n${recentTitles.map((t) => `- ${t}`).join('\n')}`
    : '暂无最近推荐。';
  return [
    '你是「Prompt 小精灵」，每小时向用户推荐一条来自官方资料的 prompt 技巧。',
    context,
    recent,
    '本次要推荐的条目（Prompt 正文与标题必须逐字保留，不得改写）：',
    `标题：${entry.title}`,
    `来源：${entry.sourceVendor} · ${entry.sourceUrl} · ${entry.sourceDate}`,
    `Prompt 正文：\n${entry.prompt}`,
    `资料库预写理由：${entry.why}`,
    [
      '请只输出一个 JSON 对象（不要多余文字）：',
      '{"why":"<80-200字，结合用户背景说明为什么这条技巧现在值得学、怎么用得上；可重写资料库理由但不得编造条目里没有的内容>"}',
    ].join('\n'),
  ].join('\n\n');
}

/** Parse and sanity-check the skins manifest; never throw — fall back instead. */
export function parseSkins(manifest) {
  const fallback = [{
    id: 'hologram-drop', name: '全息水滴', dir: 'hologram-drop', accent: '#60a5fa',
    frames: { idle: 'idle.png', talk: 'talk.png' }, default: true,
  }];
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.skins)) return fallback;
  const skins = manifest.skins.filter((s) => s && typeof s.id === 'string'
    && typeof s.dir === 'string'
    && s.frames && typeof s.frames.idle === 'string' && typeof s.frames.talk === 'string')
    .map((s) => ({
      id: s.id, name: clip(s.name, 20) || s.id, dir: s.dir,
      accent: typeof s.accent === 'string' ? s.accent : '#a78bfa',
      frames: { idle: s.frames.idle, talk: s.frames.talk },
      default: s.default === true,
    }));
  return skins.length ? skins : fallback;
}

/** Ids of entries recommended recently, newest first — for pick-avoidance. */
export function recentEntryIds(bubbles, window = RECENT_PICK_WINDOW) {
  return (Array.isArray(bubbles) ? bubbles.slice(0, window) : [])
    .map((b) => (b && typeof b.entryId === 'string' ? b.entryId : null))
    .filter(Boolean);
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const text = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
});

async function readBody(request) {
  try {
    const raw = await request.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** fetch with a hard timeout; aborts are reported as friendly Chinese text. */
export async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
  } catch (error) {
    if (error?.name === 'AbortError') throw new PromptTipsError(`同步超时（${timeoutMs}ms）：${url}`);
    throw new PromptTipsError(`同步请求失败：${clip(error?.message ?? error, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

// --- host-profile → headless child: llm config bridge -----------------------
// The hourly child runs `dsh --profile <profile>`, whose bundled patch carries
// no llm provider — so on a fresh install it always dies with MISSING_CREDENTIAL
// unless the user exported a global DEEPSEEK_API_KEY. The host process *does*
// have a working model stack (that is what the GUI renders with): its profile
// patch declares `agent-default-model` and the provider plugins. Bridging is a
// verbatim copy of the llm entries into a `--patch` overlay handed to the child
// at spawn time (same scheme dsh-maoxuan-pet v0.2.3 ships).

/** The overlay file handed to every headless child (idempotent, inspectable). */
export function headlessOverlayPath(env = process.env) {
  return join(resolveDshHome(env), 'storages', 'dsh-prompt-tips.headless-overlay.yml');
}

/** Where the host profile's own patch layer lives, or null if unknown. */
export function hostPatchPath(env = process.env) {
  const dir = env.DSH_PROFILE_DIR?.trim();
  if (dir) return join(dir, 'cordis.patch.yml');
  const home = resolveDshHome(env);
  const profile = env.DSH_PROFILE?.trim();
  if (profile) return join(home, 'profiles', profile, 'cordis.patch.yml');
  return null;
}

/**
 * Copy the llm-related top-level entries out of a profile patch, verbatim.
 * "Parsing" is slicing top-level `- ` blocks by column-0 boundaries; profile
 * patches are machine-written simple YAML and the output is applied by dsh
 * itself, exactly like the original layer. Anything unmatched is left out.
 */
export function extractLlmPatchEntries(patchText) {
  const lines = String(patchText ?? '').split('\n');
  const starts = [];
  lines.forEach((line, index) => {
    if (/^- /.test(line)) starts.push(index);
  });
  return starts
    .map((start, i) => lines.slice(start, starts[i + 1] ?? lines.length).join('\n').replace(/\s+$/, ''))
    .filter((block) => /- id: agent-default-model\b/.test(block)
      || /^\s*name:\s+["']?@deepseek-ai\/dsh-llm-pi-ai["']?\s*$/m.test(block)
      || /^\s*name:\s+["']?@deepseek-ai\/dsh-llm-deepseek-api-key["']?\s*$/m.test(block));
}

/**
 * Write the overlay if its content changed; return the path, or '' when the
 * host patch had no llm entries (an existing overlay is then kept — a stale
 * bridge still beats a child with no model config at all).
 */
export async function syncHeadlessOverlay(env = process.env) {
  const target = headlessOverlayPath(env);
  let text = '';
  const source = hostPatchPath(env);
  if (source) {
    try {
      const entries = extractLlmPatchEntries(await readFile(source, 'utf8'));
      if (entries.length) {
        text = [
          '# Auto-generated by dsh-plugin-prompt-tips.',
          "# The host profile's llm entries, bridged verbatim so the hourly",
          '# headless child uses the same model stack as the GUI. Safe to delete:',
          '# the plugin rewrites it on every generation attempt.',
          ...entries,
          '',
        ].join('\n');
      }
    } catch { /* unreadable host patch → no bridge this run */ }
  }
  let existing = '';
  try { existing = await readFile(target, 'utf8'); } catch { /* absent */ }
  if (existing === text) return text ? target : '';
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, target);
  return text ? target : '';
}

/**
 * Read the machine-local credential refs file the web Models page writes
 * (`$DSH_HOME/.credentials.yaml`, top-level `refs:` block only). Returns
 * name → value, {} when absent/unreadable — callers treat any error as
 * "no bridge" and fall back to the honest offline reason.
 */
export function readCredentialRefs(env = process.env) {
  try {
    const file = join(resolveDshHome(env), '.credentials.yaml');
    const text = readFileSync(file, 'utf8');
    const refs = {};
    let inRefs = false;
    for (const line of text.split('\n')) {
      if (/^refs:/.test(line)) { inRefs = true; continue; }
      if (inRefs && /^[A-Za-z0-9_]+:/.test(line)) break; // next top-level block
      const match = inRefs && /^  ([A-Za-z0-9_]+): (.+)$/.exec(line);
      if (match) refs[match[1]] = match[2].trim();
    }
    return refs;
  } catch {
    return {};
  }
}

/**
 * The child env for one generation: the host env plus every `apiKeyEnv` the
 * bridged overlay names but the child env does not have, sourced from the
 * credential refs. Injecting only missing names keeps explicit user-provided
 * env values authoritative; anything unknown is simply not injected, so the
 * child fails with the honest MISSING_CREDENTIAL.
 */
export function childHeadlessEnv(overlayText, childEnv = process.env) {
  const env = { ...childEnv, DSH_PROMPT_TIPS_CHILD: '1' };
  const names = new Set(
    (String(overlayText ?? '').match(/^\s*apiKeyEnv:\s*([A-Za-z0-9_]+)\s*$/gm) ?? [])
      .map((line) => line.replace(/^\s*apiKeyEnv:\s*/, '').trim()),
  );
  if (!names.size) return env;
  const refs = readCredentialRefs(childEnv);
  for (const name of names) {
    if (env[name]) continue;
    const value = refs[name];
    if (value) env[name] = value;
  }
  return env;
}

/** Parse the `--json` NDJSON stream and keep the terminal `final` text. */
export function lastFinalText(stream) {
  let output = '';
  for (const line of String(stream ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event?.type === 'final' && typeof event.text === 'string' && event.text.trim()) output = event.text;
      else if (event?.type === 'text' && typeof event.text === 'string' && event.text.trim()) output = event.text;
    } catch { /* ignore malformed lines */ }
  }
  return output;
}

/** Translate a raw child-process failure into something a user can act on. */
export function friendlyHeadlessError(message) {
  if (/MISSING_CREDENTIAL/i.test(message)) {
    return `${clip(message, 160)}——修复：打开 Web 界面的 Models 页保存一个可用模型的 API Key（插件默认跟随宿主 profile，宿主能用它就能用）；或在插件配置里显式指定 profile / dshBin。`;
  }
  if (/无法启动 headless|ENOENT/.test(message)) {
    return `${clip(message, 160)}——多数是 PATH 里没有 dsh 命令，可在插件配置里把 dshBin 指到 dsh 的绝对路径。`;
  }
  return message;
}

/** The personalised `why` must stay inside this budget, like the library's. */
export function normaliseWhy(raw, max = 500) {
  const text = clip(typeof raw === 'string' ? raw : '', max);
  return text.length >= 10 ? text : '';
}

/** Atomically write text to `path` (tmp file + rename). */
async function atomicWrite(path, payload) {
  const dir = dirname(path);
  const tmp = `${path}.tmp`;
  await mkdir(dir, { recursive: true });
  await writeFile(tmp, payload, 'utf8');
  await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const cfg = normaliseConfig(config);
  const here = dirname(fileURLToPath(import.meta.url));
  const assetsDir = join(here, 'assets');
  const skinsManifestPath = join(assetsDir, 'skins', 'index.json');
  const bundledResourcesPath = join(here, 'resources', 'index.json');
  const statePath = resolveStatePath();
  const syncedResourcesPath = resolveSyncedResourcesPath();

  const log = (level, message) => {
    try {
      const logger = ctx.logger;
      if (logger && typeof logger[level] === 'function') logger[level](`[prompt-tips] ${message}`);
    } catch { /* logging must never break the sprite */ }
  };

  // --- durable state -------------------------------------------------------
  const state = {
    version: 1,
    cursor: 0,
    bubbles: [],
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    skinId: cfg.skinId,
    resourceSet: null, // { source, version, count, updatedAt }
  };
  let running = false;      // in-memory only: a restarted host is not "running"
  let pendingTimer = null;
  let saveChain = Promise.resolve();

  let skins = parseSkins(null);
  let skinError = null;
  const emoExisting = new Map(); // "<skinId>:<frame>" -> boolean (scanned at boot)
  let resources = { entries: [], version: null, source: 'bundled', updatedAt: null };
  let resourcesError = null;

  const currentSkin = () => skins.find((s) => s.id === state.skinId)
    ?? skins.find((s) => s.default) ?? skins[0];

  // 资源缓存穿透：皮肤 PNG 会在不换代码的情况下被替换（重绘/重摇/换素材），
  // 而资源 URL 是稳定的 query 串，浏览器会永久缓存旧图——URL 带上全部皮肤
  // 立绘的最新 mtime 作版本号，页面刷新即可拿到新图，无需强刷。
  // 30s 记忆化：snapshot 每 20s 轮询一次，不必每次都扫盘。
  let assetVer = { at: 0, value: '0' };
  const assetVersion = () => {
    const now = Date.now();
    if (now - assetVer.at < 30_000) return assetVer.value;
    let latest = 0;
    try {
      for (const s of skins) {
        for (const f of ['idle.png', 'talk.png']) {
          try {
            const m = statSync(join(assetsDir, 'skins', s.dir, f)).mtimeMs;
            if (m > latest) latest = m;
          } catch { /* absent frame */ }
        }
      }
    } catch { /* keep previous version */ }
    if (latest > 0) assetVer = { at: now, value: String(Math.round(latest)) };
    return assetVer.value;
  };

  const assetUrl = (frame) => `${ROUTES.asset}?skin=${encodeURIComponent(currentSkin().id)}&frame=${frame}&v=${assetVersion()}`;

  const snapshot = () => {
    const now = new Date();
    const unread = state.bubbles.filter((b) => !b.read);
    const todayRuns = state.bubbles.filter((b) => {
      const at = Date.parse(b.at);
      return Number.isFinite(at) && at >= startOfLocalDay(now);
    }).length;
    const skin = currentSkin();
    return {
      version: 1,
      pet: { name: PET_NAME },
      enabled: cfg.enabled,
      running,
      mode: cfg.headless ? 'headless' : 'offline',
      everySeconds: cfg.everySeconds,
      now: now.toISOString(),
      lastRunAt: state.lastRunAt,
      nextRunAt: state.nextRunAt,
      lastError: state.lastError,
      unread: unread.length,
      todayRuns,
      dailyLimit: cfg.dailyLimit,
      maxHistory: cfg.maxHistory,
      current: unread.length ? unread[0] : null,
      history: state.bubbles,
      resource: {
        source: resources.source,
        version: resources.version,
        count: resources.entries.length,
        updatedAt: resources.updatedAt,
        minSourceMonth: MIN_SOURCE_MONTH,
        error: resourcesError,
      },
      skin: {
        id: skin.id,
        name: skin.name,
        accent: skin.accent,
        frames: { idle: assetUrl('idle'), talk: assetUrl('talk') },
        // Only expose emotion frames that actually exist on disk — a missing
        // file would 404 and flip the client into its emoji fallback.
        emo: Object.fromEntries(EMO_FRAMES
          .filter((f) => emoExisting.get(`${skin.id}:${f}`))
          .map((f) => [f, assetUrl(`emo-${f}`)])),
      },
      skins: skins.map((s) => ({
        id: s.id, name: s.name, accent: s.accent, current: s.id === skin.id,
        preview: `${ROUTES.asset}?skin=${encodeURIComponent(s.id)}&frame=idle&v=${assetVersion()}`,
      })),
      skinError,
      quietHours: cfg.quietHours,
    };
  };

  /** History is capped at MAX_HISTORY (需求 6) no matter the config. */
  const trim = () => {
    state.bubbles.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (state.bubbles.length > cfg.maxHistory) state.bubbles.length = cfg.maxHistory;
  };

  const persist = () => {
    saveChain = saveChain.then(async () => {
      try {
        await atomicWrite(statePath, JSON.stringify({
          version: 1,
          cursor: state.cursor,
          bubbles: state.bubbles,
          lastRunAt: state.lastRunAt,
          nextRunAt: state.nextRunAt,
          lastError: state.lastError,
          skinId: state.skinId,
        }));
      } catch (error) {
        log('warn', `状态写入失败：${error?.message ?? error}`);
      }
    }).catch(() => { /* keep the chain alive */ });
    return saveChain;
  };

  const loadState = async () => {
    try {
      const saved = JSON.parse(await readFile(statePath, 'utf8'));
      state.cursor = Number.isFinite(Number(saved?.cursor)) ? Number(saved.cursor) : 0;
      state.lastRunAt = typeof saved?.lastRunAt === 'string' ? saved.lastRunAt : null;
      state.nextRunAt = typeof saved?.nextRunAt === 'string' ? saved.nextRunAt : null;
      state.lastError = saved?.lastError && typeof saved.lastError === 'object' ? saved.lastError : null;
      state.bubbles = Array.isArray(saved?.bubbles)
        ? saved.bubbles.filter((b) => b && typeof b === 'object'
          && typeof b.id === 'string' && typeof b.at === 'string'
          && typeof b.prompt === 'string' && typeof b.why === 'string')
        : [];
      if (typeof saved?.skinId === 'string' && saved.skinId) state.skinId = saved.skinId;
      trim();
    } catch { /* first run: an absent or unreadable file opens empty */ }
  };

  const loadSkins = async () => {
    try {
      skins = parseSkins(JSON.parse(await readFile(skinsManifestPath, 'utf8')));
      skinError = null;
    } catch (error) {
      skins = parseSkins(null);
      skinError = clip(error?.message ?? error, 200);
      log('warn', `皮肤清单加载失败，使用内置默认：${skinError}`);
    }
    // Which emotion frames actually exist on disk (scanned once at boot).
    for (const s of skins) {
      for (const f of EMO_FRAMES) {
        let exists = false;
        try { exists = (await stat(join(assetsDir, 'skins', s.dir, 'emo', `${f}.png`))).size > 0; } catch { /* absent */ }
        emoExisting.set(`${s.id}:${f}`, exists);
      }
    }
  };

  /** Validate + activate a library object; returns error text or null. */
  const adoptResources = (index, source) => {
    const errors = validateResources(index);
    if (errors.length) return errors.slice(0, 5).join('；');
    resources = {
      entries: index.entries,
      version: index.version,
      source,
      updatedAt: typeof index.generatedAt === 'string' ? index.generatedAt : new Date().toISOString(),
    };
    resourcesError = null;
    state.resourceSet = { source, version: index.version, count: index.entries.length, updatedAt: resources.updatedAt };
    return null;
  };

  const loadResources = async () => {
    // Synced-over copy wins; the bundled copy is the always-present baseline.
    for (const [path, source] of [[syncedResourcesPath, 'synced'], [bundledResourcesPath, 'bundled']]) {
      try {
        const error = adoptResources(JSON.parse(await readFile(path, 'utf8')), source);
        if (error) throw new PromptTipsError(error);
        resourcesError = null;
        return;
      } catch (error) {
        if (source === 'synced') {
          log('warn', `同步资源库不可用（${clip(error?.message ?? error, 160)}），回落内置资源`);
        } else {
          resourcesError = clip(error?.message ?? error, 300);
          log('warn', `内置资源库加载失败：${resourcesError}`);
        }
      }
    }
  };

  const ready = Promise.all([loadState(), loadSkins(), loadResources()])
    .then(() => {
      // 数据治理晚于部分已生成的推荐：按 entryId 回填拆分字段（只增不删）。
      const filled = backfillSplitFields(state.bubbles, resources?.entries);
      if (filled > 0) {
        log('info', `已为 ${filled} 个旧气泡回填 promptZh/promptEn`);
        void persist();
      }
    })
    .catch((error) => {
      log('warn', `初始化失败：${error?.message ?? error}`);
    });

  // --- recommendation pipeline ---------------------------------------------
  /** Run one headless dsh conversation and return the final text, or throw.
   *  The llm bridge must not kill generation if it fails: worst case the child
   *  errors with MISSING_CREDENTIAL and the offline fallback kicks in. */
  const runHeadless = (prompt) => new Promise(async (resolvePromise, reject) => {
    await syncHeadlessOverlay().catch(() => '');
    let overlayText = '';
    try { overlayText = await readFile(headlessOverlayPath(), 'utf8'); } catch { /* none */ }
    const args = ['--profile', cfg.profile];
    if (overlayText.trim()) args.push('--patch', headlessOverlayPath());
    args.push('--json', prompt);
    let proc;
    try {
      proc = spawn(cfg.dshBin, args, {
        cwd: homedir(),
        env: childHeadlessEnv(overlayText),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new PromptTipsError(`无法启动 headless：${error?.message ?? error}`));
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolvePromise(value);
    };
    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* already gone */ }
      finish(new PromptTipsError(`headless 超时（${Math.round(cfg.timeoutMs / 1000)}s）`));
    }, cfg.timeoutMs);
    timer.unref?.();
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    proc.on('error', (error) => finish(new PromptTipsError(`headless 启动失败：${error?.message ?? error}`)));
    proc.on('close', (code) => {
      const finalText = lastFinalText(stdout);
      if (code === 0 && finalText) { finish(null, finalText); return; }
      const detail = clip(stderr || stdout || '无输出', 300);
      finish(new PromptTipsError(`headless 退出码 ${code}：${detail}`));
    });
  });

  /** Personalise the reason with the model; ANY failure degrades honestly to
   *  the library's own pre-written `why`, labelled offline in the bubble. */
  const personalise = async (entry) => {
    if (!cfg.headless) return { why: offlineWhy(entry), mode: 'offline' };
    try {
      const prompt = buildHeadlessPrompt(entry, {
        businessContext: cfg.businessContext,
        recentTitles: state.bubbles.slice(0, 6).map((b) => b.title).filter(Boolean),
      });
      const answer = await runHeadless(prompt);
      const why = normaliseWhy(extractJson(answer)?.why);
      if (!why) throw new PromptTipsError(`模型输出无法解析为约定 JSON（${clip(answer, 120)}）`);
      return { why, mode: 'headless' };
    } catch (error) {
      const message = friendlyHeadlessError(String(error?.message ?? error));
      log('warn', `降级为资料库预写理由：${message}`);
      return { why: offlineWhy(entry), mode: 'offline', failure: message };
    }
  };

  const runOnce = async (reason) => {
    if (running) return { ok: false, running: true, bubble: null, error: '上一次推荐还在进行中' };
    running = true;
    try {
      await ready;
      if (!resources.entries.length) throw new PromptTipsError(`资源库为空${resourcesError ? `：${resourcesError}` : ''}`);
      const picked = pickEntry(resources.entries, recentEntryIds(state.bubbles), state.cursor + Date.now());
      if (!picked) throw new PromptTipsError('资源库中没有可推荐的条目');
      const entry = picked.entry;
      const { why, mode, failure } = await personalise(entry);
      if (failure) state.lastError = { at: new Date().toISOString(), message: clip(failure, 300) };
      else if (state.lastError) state.lastError = null;
      const bubble = buildBubble(entry, why, mode);
      state.bubbles = [bubble, ...state.bubbles];
      state.cursor = (state.cursor + 1) % Math.max(1, resources.entries.length);
      state.lastRunAt = bubble.at;
      trim();
      await persist();
      log('info', `已推荐 prompt（${reason} · ${bubble.mode} · ${bubble.title}）`);
      return { ok: true, running: false, bubble };
    } catch (error) {
      // Never leave `running` stuck — it would freeze timer and button both.
      state.lastError = { at: new Date().toISOString(), message: clip(error?.message ?? error, 300) };
      await persist().catch(() => {});
      return { ok: false, running: false, bubble: null, error: String(error?.message ?? error) };
    } finally {
      running = false;
    }
  };

  // --- sync (需求 4)：remote manifest → validate → atomic replace -----------
  const syncNow = async () => {
    await ready;
    const fromVersion = resources.version;
    try {
      const response = await fetchWithTimeout(cfg.syncUrl, cfg.syncTimeoutMs);
      if (!response.ok) throw new PromptTipsError(`远端返回 ${response.status}：${cfg.syncUrl}`);
      const payload = await response.json();
      const error = validateResources(payload);
      if (error.length) throw new PromptTipsError(`远端数据未通过校验，拒绝落盘：${error.slice(0, 3).join('；')}`);
      const toVersion = payload.version;
      await atomicWrite(syncedResourcesPath, JSON.stringify(payload));
      const adoptError = adoptResources(payload, 'synced');
      if (adoptError) throw new PromptTipsError(adoptError);
      log('info', `资源库已同步：${fromVersion ?? '无'} → ${toVersion}（${payload.entries.length} 条）`);
      return {
        ok: true, fromVersion, toVersion, count: payload.entries.length,
        added: payload.entries.length - resources.entries.length + 0,
      };
    } catch (error) {
      const message = clip(error?.message ?? error, 300);
      log('warn', `同步失败：${message}`);
      return { ok: false, fromVersion, toVersion: fromVersion, error: message };
    }
  };

  // --- scheduler -----------------------------------------------------------
  const later = (fn, ms) => {
    if (typeof ctx.timeout === 'function') return ctx.timeout(fn, ms);
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return () => clearTimeout(handle);
  };

  const clearPending = () => {
    if (typeof pendingTimer === 'function') {
      try { pendingTimer(); } catch { /* already disposed */ }
    }
    pendingTimer = null;
  };

  const arm = () => {
    clearPending();
    if (!cfg.enabled) { state.nextRunAt = null; return; }
    const now = Date.now();
    let target = state.nextRunAt ? Date.parse(state.nextRunAt) : NaN;
    if (!Number.isFinite(target)) {
      target = now + cfg.firstDelaySeconds * 1000;
    } else if (target <= now) {
      // Overdue slot (host was down): run soon, not at the worst boot moment.
      target = now + Math.min(cfg.firstDelaySeconds, 20) * 1000;
    }
    state.nextRunAt = new Date(target).toISOString();
    pendingTimer = later(() => { void tick(); }, Math.max(0, target - Date.now()));
  };

  const tick = async () => {
    pendingTimer = null;
    const now = new Date();
    if (isQuietAt(now, cfg.quietHours)) {
      state.nextRunAt = quietEnd(now, cfg.quietHours).toISOString();
      await persist();
      arm();
      return;
    }
    const runsToday = state.bubbles.filter((b) => {
      const at = Date.parse(b.at);
      return Number.isFinite(at) && at >= startOfLocalDay(now);
    }).length;
    if (cfg.dailyLimit > 0 && runsToday >= cfg.dailyLimit) {
      state.nextRunAt = new Date(Math.max(now.getTime() + 60000, startOfLocalDay(now) + DAY)).toISOString();
      await persist();
      arm();
      return;
    }
    await runOnce('schedule');
    state.nextRunAt = new Date(Date.now() + cfg.everySeconds * 1000).toISOString();
    await persist();
    arm();
  };

  ctx.effect(() => () => { clearPending(); }, 'prompt-tips.timer');

  // --- transport -----------------------------------------------------------
  ctx.inject?.(['connection'], (scope) => {
    const routes = [
      {
        path: ROUTES.state,
        methods: ['GET'],
        // Without an explicit body mode the bridge builds a GET request with a
        // stream body and Node throws — surfaced by the Host as a 400.
        requestBody: 'buffered',
        fetch: async () => { await ready; return json(snapshot()); },
      },
      {
        path: ROUTES.pick,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          await ready;
          // 需求 7：手动捞一条（同一个管道，即时执行）。
          const result = await runOnce('manual');
          if (!result.ok) return json(result, result.running ? 202 : 500);
          return json(result, 200);
        },
      },
      {
        path: ROUTES.dismiss,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          await ready;
          const body = await readBody(request);
          const target = typeof body.id === 'string' && body.id
            ? state.bubbles.find((b) => b.id === body.id)
            : state.bubbles.find((b) => !b.read);
          if (target && !target.read) {
            target.read = true;
            await persist();
          }
          return json({ ok: true, unread: state.bubbles.filter((b) => !b.read).length });
        },
      },
      {
        path: ROUTES.asset,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          await ready;
          let skinId = currentSkin().id;
          let frame = 'idle';
          try {
            const params = new URL(request.url).searchParams;
            if (params.get('skin')) skinId = params.get('skin');
            if (params.get('frame')) frame = params.get('frame');
          } catch { /* keep defaults */ }
          const skin = skins.find((s) => s.id === skinId) ?? currentSkin();
          // `emo-<name>` serves the 9 emotion frames (mascot-emo skill).
          let file;
          if (frame.startsWith('emo-')) {
            const emoName = frame.slice(4);
            if (!EMO_FRAMES.includes(emoName)) return text(`未知表情帧：${clip(emoName, 40)}`, 404);
            file = join(assetsDir, 'skins', skin.dir, 'emo', `${emoName}.png`);
          } else {
            const frameKey = frame === 'talk' ? 'talk' : 'idle';
            file = join(assetsDir, 'skins', skin.dir, skin.frames[frameKey]);
          }
          try {
            const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
            if (!info.size) throw new PromptTipsError('空文件');
            const type = file.endsWith('.png')
              ? 'image/png'
              : 'image/svg+xml; charset=utf-8';
            return new Response(bytes, {
              headers: { 'content-type': type, 'cache-control': 'public, max-age=3600' },
            });
          } catch {
            return text(`缺少素材：${file}`, 404);
          }
        },
      },
      {
        path: ROUTES.skin,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          await ready;
          const body = await readBody(request);
          const id = typeof body.id === 'string' ? body.id : '';
          const skin = skins.find((s) => s.id === id);
          if (!skin) return json({ ok: false, error: `没有这套皮肤：${clip(id, 40)}` }, 400);
          state.skinId = skin.id;
          await persist();
          log('info', `皮肤已切换：${skin.name}`);
          return json({ ok: true, skin: { id: skin.id, name: skin.name, accent: skin.accent } });
        },
      },
      {
        path: ROUTES.sync,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => {
          if (running) return json({ ok: false, error: '推荐进行中，稍后再同步' }, 409);
          const result = await syncNow();
          return json(result, result.ok ? 200 : 502);
        },
      },
    ];
    const disposers = routes.map((route) => scope.connection.fetch.register(route));
    scope.effect(() => () => {
      for (const dispose of disposers) {
        try { dispose?.(); } catch { /* already gone */ }
      }
    }, 'prompt-tips.routes');
  });

  // Start the clock only after the persisted snapshot is loaded.
  void ready.then(() => {
    if (!cfg.enabled) return;
    arm();
  });

  // Exposed for tests and for the client's first paint.
  return { snapshot, runOnce, syncNow, config: cfg };
}

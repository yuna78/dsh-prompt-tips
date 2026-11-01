/**
 * Host integration tests: drive `apply()` with a mock Cordis context and a
 * mocked global fetch. Covers the sync contract (valid / bad JSON / schema
 * violation / timeout — a bad remote payload must never touch disk), the
 * pick pipeline (verbatim prompt, offline mode, history capped at 10), and
 * the skin route. Runs against a temp DSH home via env overrides.
 */
process.env.DSH_PROMPT_TIPS_STATE = '';
process.env.DSH_PROMPT_TIPS_RESOURCES = '';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const home = mkdtempSync(join(tmpdir(), 'pt-test-'));
process.env.DSH_PROMPT_TIPS_STATE = join(home, 'storages', 'state.json');
process.env.DSH_PROMPT_TIPS_RESOURCES = join(home, 'storages', 'resources.json');

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error?.stack ?? error);
    cleanup();
    process.exit(1);
  }
};
const cleanup = () => { try { rmSync(home, { recursive: true, force: true }); } catch { /* temp */ } };

const { ROUTES, apply, fetchWithTimeout, PromptTipsError } = await import('../index.js');

const entry = (id, overrides = {}) => ({
  id,
  title: `条目 ${id}`,
  sourceVendor: id.startsWith('openai') ? 'openai' : 'anthropic',
  sourceUrl: `https://docs.anthropic.com/x/${id}`,
  sourceDate: '2026-09',
  fetchedAt: '2026-11-01',
  tags: ['测试'],
  prompt: `PROMPT-正文-${id}：请一步步思考再回答。`,
  why: '这条测试理由足够长，可以当作资料库预写理由使用。',
  summary: '测试条目。',
  verified: true,
  ...overrides,
});
const validIndex = (version) => ({
  version,
  generatedAt: '2026-11-01T00:00:00.000Z',
  sources: [{ name: 'test', url: 'https://example.com' }],
  entries: [entry('a-xml'), entry('b-few-shot'), entry('c-cot')],
});

// --- mock cordis context ----------------------------------------------------
const routes = [];
const ctx = {
  effect: () => {},
  inject(names, fn) {
    if (names.includes('connection')) {
      fn({
        effect: () => {},
        connection: { fetch: { register: (route) => { routes.push(route); return () => {}; } } },
      });
    }
  },
  logger: { info: () => {}, warn: () => {} },
};
const api = apply(ctx, { enabled: false, headless: false }); // no timer, no model spawn

const callRoute = async (key, method = 'GET', body) => {
  const route = routes.find((r) => r.path === ROUTES[key]);
  assert.ok(route, `route ${key} 未注册`);
  const request = new Request(`http://localhost${ROUTES[key]}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await route.fetch(request);
  return { status: response.status, payload: await response.json().catch(() => null) };
};

let realFetch = globalThis.fetch;
const useFetch = (impl) => { globalThis.fetch = impl; };
const restoreFetch = () => { globalThis.fetch = realFetch; };
const jsonResponse = (payload) => new Response(JSON.stringify(payload), { status: 200 });

await test('mock ctx 下六条路由全部注册', async () => {
  assert.equal(routes.length, 6);
  assert.ok(routes.every((r) => r.requestBody === 'buffered'));
});

await test('内置资源存在时正常加载：source=bundled、≥15 条、无错误', async () => {
  const { status, payload } = await callRoute('state');
  assert.equal(status, 200);
  assert.equal(payload.resource.source, 'bundled');
  assert.ok(payload.resource.count >= 15, `应 ≥15 条，实际 ${payload.resource.count}`);
  assert.equal(payload.resource.error, null);
  assert.equal(payload.history.length, 0);
});

await test('同步合法数据：写入落盘、切换生效、返回版本变化', async () => {
  useFetch(async () => jsonResponse(validIndex('1.0.0-test')));
  try {
    const result = await api.syncNow();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.toVersion, '1.0.0-test');
    assert.equal(result.count, 3);
    assert.ok(existsSync(process.env.DSH_PROMPT_TIPS_RESOURCES));
    const { payload } = await callRoute('state');
    assert.equal(payload.resource.source, 'synced');
    assert.equal(payload.resource.version, '1.0.0-test');
    assert.equal(payload.resource.count, 3);
    assert.equal(payload.resource.error, null);
  } finally { restoreFetch(); }
});

await test('捞一条：prompt 逐字来自资源库，模式为 offline，未读 +1', async () => {
  const { status, payload } = await callRoute('pick', 'POST', {});
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.bubble.mode, 'offline');
  const ids = validIndex('x').entries.map((e) => e.id);
  assert.ok(ids.some((id) => payload.bubble.prompt.includes(id)), 'prompt 应含条目原文');
  const { payload: state } = await callRoute('state');
  assert.equal(state.unread, 1);
  assert.equal(state.current.entryId, payload.bubble.entryId);
});

await test('非法 JSON：拒绝落盘，本地数据保持不变', async () => {
  const before = readFileSync(process.env.DSH_PROMPT_TIPS_RESOURCES, 'utf8');
  useFetch(async () => new Response('not-json-at-all', { status: 200 }));
  try {
    const result = await api.syncNow();
    assert.equal(result.ok, false);
    assert.ok(result.error, '必须返回错误原因');
    assert.equal(readFileSync(process.env.DSH_PROMPT_TIPS_RESOURCES, 'utf8'), before);
  } finally { restoreFetch(); }
});

await test('schema 违规（旧日期）：拒绝落盘并说明原因', async () => {
  const before = readFileSync(process.env.DSH_PROMPT_TIPS_RESOURCES, 'utf8');
  const bad = validIndex('9.9.9-bad');
  bad.entries[0] = entry('a-xml', { sourceDate: '2025-01' });
  useFetch(async () => jsonResponse(bad));
  try {
    const result = await api.syncNow();
    assert.equal(result.ok, false);
    assert.match(result.error, /校验|早于下限/);
    assert.equal(readFileSync(process.env.DSH_PROMPT_TIPS_RESOURCES, 'utf8'), before);
  } finally { restoreFetch(); }
});

await test('超时/断网：fetchWithTimeout 抛出可读错误', async () => {
  // A mock that never settles but honours the abort signal, like a hung socket.
  useFetch((url, opts) => new Promise((resolve, reject) => {
    opts?.signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  }));
  try {
    await assert.rejects(
      () => fetchWithTimeout('https://example.invalid/x', 1000),
      (error) => error instanceof PromptTipsError && /超时/.test(error.message),
    );
  } finally { restoreFetch(); }
});

await test('历史硬上限 10：连捞 12 条后只留最近 10 条', async () => {
  for (let i = 0; i < 11; i += 1) await callRoute('pick', 'POST', {});
  const { payload } = await callRoute('state');
  assert.equal(payload.history.length, 10);
  assert.equal(payload.maxHistory, 10);
});

await test('换肤：切到存在的皮肤生效并持久化，未知皮肤 400', async () => {
  const good = await callRoute('skin', 'POST', { id: 'hologram-drop' }); // 默认主力皮肤
  assert.equal(good.status, 200);
  assert.equal(good.payload.ok, true);
  const { payload } = await callRoute('state');
  assert.equal(payload.skin.id, 'hologram-drop');
  assert.match(payload.skin.frames.idle, /skin=hologram-drop/);
  const bad = await callRoute('skin', 'POST', { id: 'no-such-skin' });
  assert.equal(bad.status, 400);
});

await test('dismiss：未读减一且该条标记已读', async () => {
  await callRoute('pick', 'POST', {});
  const { payload: before } = await callRoute('state');
  const target = before.current;
  const { payload } = await callRoute('dismiss', 'POST', { id: target.id });
  assert.equal(payload.ok, true);
  assert.equal(payload.unread, before.unread - 1);
  const { payload: after } = await callRoute('state');
  assert.equal(after.history.find((b) => b.id === target.id)?.read, true);
});

cleanup();
console.log(`\nhost OK: ${passed} tests passed`);

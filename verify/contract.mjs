/**
 * Contract tests: the Web client and the host must agree on routes.
 * - every `/api/dsh-prompt-tips.*` URL the client touches must exist in the
 *   host's ROUTES (a typo here surfaces as a silent 404 in the GUI);
 * - every route the host registers must be reachable from the client (no dead
 *   surface) — except `asset`, which the client uses as an <img> src;
 * - GET/POST usage must match the route's declared methods.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROUTES } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, '..', 'client.js'), 'utf8');

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

const routeValues = Object.values(ROUTES);
const routeKeys = Object.keys(ROUTES);
const clientUrls = [...client.matchAll(/\/api\/dsh-prompt-tips\.[a-z]+/g)].map((m) => m[0]);
const clientKeys = [...client.matchAll(/API\.([a-z]+)/g)].map((m) => m[1]);

test('host ROUTES 均以统一前缀开头', () => {
  for (const url of routeValues) assert.match(url, /^\/api\/dsh-prompt-tips\.[a-z]+$/, url);
});

test('client 引用的每个路由都存在于 host ROUTES', () => {
  for (const url of new Set(clientUrls)) {
    assert.ok(routeValues.includes(url), `client 引用了未注册路由：${url}`);
  }
});

test('client API 键与 host 路由键一致', () => {
  for (const key of new Set(clientKeys)) {
    assert.ok(routeKeys.includes(key), `client API.${key} 在 host ROUTES 中不存在`);
  }
  for (const key of routeKeys) {
    if (key === 'asset') {
      // asset 不经 API.* 调用：snapshot 直接给出带 skin/frame 的 <img src> URL。
      assert.match(client, /frames|preview/, 'asset 路由应由 snapshot 的 frames/preview URL 接入');
      continue;
    }
    assert.ok(clientKeys.includes(key), `host 路由 ${key} 客户端未接入（死路由）`);
  }
});

test('GET/POST 使用方式与 host 声明一致', () => {
  // getJSON only for state; everything else goes through postJSON or <img src>.
  const getUses = [...client.matchAll(/getJSON\((API\.[a-z]+)\)/g)].map((m) => m[1]);
  for (const use of getUses) assert.equal(use, 'API.state', `getJSON 只能用于 state，实际：${use}`);
  const postUses = [...client.matchAll(/postJSON\(API\.([a-z]+)/g)].map((m) => m[1]);
  for (const use of postUses) {
    assert.ok(['pick', 'dismiss', 'skin', 'sync'].includes(use), `postJSON 用在非 POST 路由：${use}`);
  }
  assert.match(client, /src:\s*spriteSrc\(\)/, '精灵帧必须走 <img src>（asset 路由）');
});

test('history 渲染来自 state.history 且上限 10 由服务端钳制', () => {
  assert.match(client, /data\?\.history \|\| \[\]/);
  const host = readFileSync(join(here, '..', 'index.js'), 'utf8');
  assert.match(host, /MAX_HISTORY = 10/);
  assert.match(host, /state\.bubbles\.length > cfg\.maxHistory/);
});

test('client 具备四个需求按钮、中英切换与复制跟随视图', () => {
  assert.match(client, /捞一条/);
  assert.match(client, /同步/);
  assert.match(client, /换肤/);
  assert.match(client, /中文翻译/);
  assert.match(client, /EN 模板/);
  assert.match(client, /promptView/);
  assert.match(client, /clipboard\.writeText\(promptText\)/, '复制必须跟随当前视图');
  assert.match(client, /已复制/);
});

console.log(`\ncontract OK: ${passed} tests passed`);

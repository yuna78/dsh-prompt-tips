/**
 * Render check: actually EXECUTE the Pet component's render path with a
 * minimal React/DOM stub — catches TDZ/undefined errors that `node --check`
 * and grep-based contract tests cannot see (e.g. a deps array referencing a
 * later-defined const, which blanked the whole sprite in the field once).
 *
 * Case 1 renders the first-paint state twice; case 2 renders the open card
 * with the skin panel shown against a populated snapshot and asserts the
 * panel's position and contents (regression guard: the panel once moved into
 * the scrollable body, where a scrolled card made it invisible).
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientUrl = pathToFileURL(join(here, '..', 'client.js'));

const SNAPSHOT = {
  history: [{
    id: 'b1', at: new Date().toISOString(), title: '标题', prompt: 'p',
    promptZh: '中文翻译', promptEn: 'EN template', why: '理由', vendor: 'openai',
    officialNote: '这是官方注释，放在框外。',
    read: true, mode: 'offline',
  }],
  unread: 0,
  running: false,
  skin: { id: 'hologram-drop', name: '全息水滴', accent: '#60a5fa', frames: { idle: '/i.png', talk: '/t.png' }, emo: {} },
  // 九套皮肤，与真机 skins/index.json 的面板数据同构。
  skins: Array.from({ length: 9 }, (_, i) => ({
    id: `skin-${i}`, name: `皮肤${i}`, accent: '#a78bfa', current: i === 0, preview: `/p${i}.png`,
  })),
};

/**
 * Boot a fresh copy of client.js with a seedable useState (hooks are keyed by
 * call order: 0=data 1=error 2=open 3=pinned 4=busy 5=syncing 6=copiedId
 * 7=toast 8=showSkins …) and return the registered Pet component.
 */
async function boot(seeds = {}) {
  let callIdx = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: Symbol.for('react.fragment'),
    useState: (init) => {
      const i = callIdx++;
      const value = i in seeds ? seeds[i] : (typeof init === 'function' ? init() : init);
      return [value, (next) => { seeds[i] = typeof next === 'function' ? next(value) : next; }];
    },
    useEffect: () => {},
    useRef: (v) => ({ current: v === undefined ? null : v }),
    useCallback: (fn) => fn,
  };
  const requireMock = (name) => {
    if (name === 'react') return React;
    throw new Error(`unexpected require: ${name}`);
  };
  globalThis.window = {
    __ModuleLoader__: { load: (def) => { globalThis.__api = def.factory(requireMock); } },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    innerWidth: 1400, innerHeight: 900,
    addEventListener: () => {}, removeEventListener: () => {},
  };
  globalThis.document = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
  });

  // Query string busts the ESM cache so each case evaluates a fresh module.
  await import(`${clientUrl.href}?case=${callIdx}-${Math.random()}`);
  const ctx = {
    effect: () => {},
    slots: {
      inject: (_slot, fn) => fn(),
      register: (_meta, Comp) => { globalThis.__Pet = Comp; },
    },
  };
  globalThis.__api.apply(ctx);
  assert.equal(typeof globalThis.__Pet, 'function', 'Pet 组件未注册进 shell.overlay');
  return globalThis.__Pet;
}

/** Depth-first walk over the stubbed vdom. */
function walk(node, fn, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 60) return;
  if (Array.isArray(node)) { for (const child of node) walk(child, fn, depth + 1); return; }
  fn(node, depth);
  if (node.children) walk(node.children, fn, depth + 1);
}

/** createElement 收到的数组子节点会整组嵌套，先拍平再筛。 */
function flattenChildren(xs) {
  return (xs ?? []).flatMap((x) => (Array.isArray(x) ? flattenChildren(x) : [x]));
}

// ── Case 1: first paint (data=null) — throws on any TDZ. ────────────────────
{
  const Pet = await boot();
  Pet();
  Pet();
  console.log('  ok  Pet 渲染路径执行无运行时错误（TDZ 防护）');
}

// ── Case 2: open card + showSkins=true + populated snapshot. ────────────────
{
  const seeds = { 0: SNAPSHOT, 2: true, 8: true };
  const Pet = await boot(seeds);
  const tree = Pet();

  const card = (() => {
    let found = null;
    walk(tree, (n) => { if (n.props?.className === 'pt-card') found = n; });
    return found;
  })();
  assert.ok(card, '开卡状态下找不到 pt-card');

  const [head, panel, body, foot] = card.children;
  assert.equal(head?.props?.className, 'pt-head', 'pt-card 首子节点应是 pt-head');
  assert.equal(panel?.props?.className, 'pt-skins', '换肤面板应是 pt-card 直属（head 下固定一排），不能落进滚动区');
  assert.equal(body?.props?.className, 'pt-body', '面板之后应是滚动区 pt-body');
  assert.equal(foot?.props?.className, 'pt-foot', 'pt-card 末子节点应是 pt-foot');

  // 提示词框结构：框头（标签 + 中英切换）+ 纯正文；官方说明在框外。
  const wrap = (() => { let found = null; walk(body, (n) => { if (n.props?.className === 'pt-promptwrap') found = n; }); return found; })();
  assert.ok(wrap, '找不到提示词框 pt-promptwrap');
  const promptHead = wrap.children[0];
  assert.equal(promptHead?.props?.className, 'pt-prompthead', '框头应是 pt-prompthead');
  assert.equal(promptHead.children?.[0]?.children?.[0], '提示词', '框头应有「提示词」标签');
  let viewBtnCount = 0;
  walk(promptHead, (n) => { if (n.props?.className === 'pt-chip pt-view') viewBtnCount += 1; });
  assert.equal(viewBtnCount, 2, '框头应有中英两个切换 chip');
  const pre = wrap.children[1];
  assert.equal(pre?.props?.className, 'pt-prompt', '框体应是 pt-prompt');
  const code = flattenChildren(pre.children)[0];
  assert.equal(code?.children?.[0], '中文翻译', '框体只显示当前视图的提示词本体');
  let noteRow = null;
  walk(body, (n) => { if (n.props?.className === 'pt-note') noteRow = n; });
  assert.ok(noteRow, 'officialNote 存在时应有框外官方说明行');
  assert.equal(noteRow.children?.[0]?.children?.[0], '官方说明 ');
  walk(body, (n) => {
    if (n.props?.className === 'pt-prompt' && flattenChildren(n.children).some((c) => typeof c?.children?.[0] === 'string' && /官方/.test(c.children[0]))) {
      throw new Error('官方说明不得出现在提示词框内');
    }
  });

  // createElement 收到的数组子节点会整组嵌套在 children[0]，先拍平再数。
  const skinButtons = flattenChildren(panel.children || []).filter((c) => c?.props?.className === 'pt-skin');
  assert.equal(skinButtons.length, 9, `换肤面板应有 9 个皮肤按钮，实际 ${skinButtons.length}`);

  // head 按钮 SVG 图标化断言：图标为内联 svg，中文语义只留 aria-label。
  let skinBtn = null, syncBtn = null;
  walk(head, (n) => {
    const cls = typeof n.props?.className === 'string' ? n.props.className : '';
    if (!cls.includes('pt-headbtn')) return;
    if (n.props['aria-label'] === '换肤') skinBtn = n;
    if (n.props['aria-label'] === '更新') syncBtn = n;
  });
  assert.ok(skinBtn, 'head 里找不到「换肤」按钮（aria-label）');
  assert.ok(syncBtn, 'head 里找不到「更新」按钮（aria-label）');
  assert.equal(skinBtn.children?.[0]?.type, 'svg', '换肤按钮应是内联 svg 图标');
  assert.equal(syncBtn.children?.[0]?.type, 'svg', '更新按钮应是内联 svg 图标');
  for (const btn of [skinBtn, syncBtn]) {
    for (const child of btn.children || []) {
      const text = typeof child === 'string' ? child : '';
      assert.doesNotMatch(text, /[\u4e00-\u9fff]/, `head 按钮不得渲染中文文案，实际「${text}」`);
    }
  }
  assert.equal(typeof skinBtn.props.onClick, 'function', '换肤按钮缺 onClick');
  assert.equal(skinBtn.props['data-on'], 'on', '面板打开时「换肤」按钮应有 data-on=on 按下态');

  // 点击首个皮肤按钮：onClick 可调用且不抛错（数据 POST 由 host.test 覆盖）。
  assert.equal(typeof skinButtons[0].props.onClick, 'function', '皮肤按钮缺 onClick');
  console.log('  ok  换肤面板固定在 head 下（不进滚动区），9 个皮肤按钮齐全；更新/换肤为 SVG 图标且有按下态');
}

console.log('\nrender OK: 2 tests passed');

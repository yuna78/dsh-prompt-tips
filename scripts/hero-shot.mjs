// 拍真实的 README 界面截图：在隔离 DSH_HOME 的 dsh web 实例 + headless
// Chrome（--remote-debugging-port=9333）里渲染插件本体，裁出 宠物+气泡。
//
// 前置：1) 隔离实例已装本插件并播种状态；2) headless Chrome：
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
//     --disable-gpu --remote-debugging-port=9333 --window-size=1600,1000 \
//     --user-data-dir=<isolated> about:blank
// 用法：node scripts/hero-shot.mjs "http://127.0.0.1:PORT/?token=…" docs/screenshots
// 拍三张：hero（默认中文翻译视图）/ en-template（EN 模板视图）/ skins（换肤面板）。
// 不进 CI；截图只含插件卡片区域，不携带宿主页面其他内容。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) throw new Error('用法：node scripts/hero-shot.mjs <url-with-token> <outDir>');
mkdirSync(outDir, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
log('cdp: version →');
const v = await (await fetch('http://127.0.0.1:9333/json/version')).json();
log('cdp: ws 连接 →');
const ws = new WebSocket(v.webSocketDebuggerUrl);
let id = 1;
const pending = new Map();
const send = (m, q = {}, s) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: q, sessionId: s })); });
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const x = pending.get(m.id); pending.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
// 看门狗：任何一步卡死都在 90s 强制退出，不让调用方无限等待
process.on('exit', () => { try { ws.close(); } catch { /* already closed */ } });
setTimeout(() => { console.error('WATCHDOG: 90s 未完成，强制退出'); process.exit(1); }, 90000).unref?.();
log('cdp: target →');
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
log('cdp: enable →');
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false }, sessionId);
log('emulation →');
// 关掉动效：呼吸/摇摆动画在截图里应是静止帧。
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);

const ev = async (x) => {
  const res = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300));
  return res.result?.value;
};

const dismissNotice = async () => {
  console.log('notice:', await ev(`(() => {
    const primary = [...document.querySelectorAll('button')].find((b) => /Continue|继续|Got it|知道了/.test(b.textContent));
    if (primary) { primary.click(); return 'dismissed-primary'; }
    // 次选：所有对话框里的关闭按钮（× / aria-label），绝不触碰 Sign in / Add API Key
    const closables = [...document.querySelectorAll('[role="dialog"] button')].filter((b) => {
      const t = (b.getAttribute('aria-label') || '') + ' ' + b.textContent;
      return /close|关闭|dismiss|×|✕/i.test(t);
    });
    if (closables.length) { closables.forEach((b) => b.click()); return 'dismissed-close x' + closables.length; }
    return 'none';
  })()`));
};

await send('Page.navigate', { url }, sessionId);
log('navigate#1 →', url.slice(0, 30));
await new Promise((r) => setTimeout(r, 8000));
// 首次启动的 Notice 弹窗：点掉并让它记住
await dismissNotice();
await new Promise((r) => setTimeout(r, 400));
// 给精灵播种一个干净坐标（远离宿主页面左缘的杂件），再刷新加载
await ev(`localStorage.setItem('dsh-prompt-tips.pos', JSON.stringify({ x: 1010, y: 560 })); 'seeded'`);
await send('Page.navigate', { url }, sessionId);
await new Promise((r) => setTimeout(r, 8000));
await dismissNotice();
await new Promise((r) => setTimeout(r, 400));

// 打开气泡（挂载时不会自动打开已存在的旧气泡），并把提示词框滚回顶部
console.log('open card:', await ev(`(() => {
  const pet = document.querySelector('.pt-pet');
  if (pet) pet.click();
  const box = document.querySelector('.pt-prompt');
  if (box) box.scrollTop = 0;
  return document.querySelectorAll('[role="dialog"]').length;
})()`));
await new Promise((r) => setTimeout(r, 900));

const cropCard = () => ev(`(() => {
  const card = document.querySelector('.pt-card');
  const pet = document.querySelector('.pt-pet');
  if (!card || !pet) return null;
  const a = card.getBoundingClientRect();
  const b = pet.getBoundingClientRect();
  const pad = 18;
  const x = Math.max(0, Math.min(a.left, b.left) - pad);
  const y = Math.max(0, Math.min(a.top, b.top) - pad);
  const right = Math.min(window.innerWidth, Math.max(a.right, b.right) + pad);
  const bottom = Math.min(window.innerHeight, Math.max(a.bottom, b.bottom) + pad + 34);
  return { x, y, width: right - x, height: bottom - y };
})()`);

async function shot(name) {
  const rect = await cropCard();
  if (!rect) throw new Error('card/pet 未渲染');
  const data = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 },
    captureBeyondViewport: false,
  }, sessionId);
  const out = join(outDir, name);
  writeFileSync(out, Buffer.from(data.data, 'base64'));
  console.log('saved', out, Math.round(rect.width) + 'x' + Math.round(rect.height), '@2x');
  const assert = await ev(`(() => {
    const card = document.querySelector('.pt-card');
    const r = card.getBoundingClientRect();
    const txt = card.textContent;
    return JSON.stringify({
      cardInViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      hasPrompt: txt.includes('提示词'),
      chinese: /[\u4e00-\u9fff]/.test(txt),
      petSize: (() => { const p = document.querySelector('.pt-pet img'); return p ? [p.naturalWidth, p.naturalHeight] : null; })(),
    });
  })()`);
  console.log('assert:', name, assert);
  return rect;
}

// 1) hero：默认视图（中文翻译）
await shot('hero.png');

// 2) EN 模板视图
console.log('toggle EN:', await ev(`(() => {
  const btn = [...document.querySelectorAll('.pt-view')].find((b) => b.textContent.trim() === 'EN 模板');
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
})()`));
await new Promise((r) => setTimeout(r, 400));
await shot('en-template.png');

// 3) 换肤面板
console.log('toggle skins:', await ev(`(() => {
  const btn = [...document.querySelectorAll('.pt-headbtn')].find((b) => b.getAttribute('aria-label') === '换肤');
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
})()`));
await new Promise((r) => setTimeout(r, 500));
await shot('skins.png');

ws.close();
console.log('DONE');

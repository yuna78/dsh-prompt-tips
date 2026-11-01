#!/usr/bin/env node
/**
 * 白名单构建公开仓（SOP：开发内容 ≠ 公开内容）。
 *
 * 只把白名单文件拷进 dist/public（独立 git 仓库的目录），然后跑隐私扫描：
 * 真实密钥格式 / 本机绝对路径 / 中转商与节点关键字 → 0 命中才放行，
 * 任何命中直接退出 1。绝不手工往 dist/public 拷文件。
 *
 * 用法：node scripts/build-public-bundle.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { cpSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// 输出目录：默认 dist/public；可用 PT_PUBLIC_DIR 指到公开仓的持久克隆。
// 经验教训：本工作区路径下 git init 可能静默失败（.git 落不了盘），导致
// 后续 git add/commit/push 落到上级仓——公开仓的 git 操作请在工作区外的
// 克隆里做（PT_PUBLIC_DIR=/path/to/clone node scripts/build-public-bundle.mjs）。
const out = process.env.PT_PUBLIC_DIR?.trim()
  ? join(process.env.PT_PUBLIC_DIR.trim())
  : join(root, 'dist', 'public');

/** 公开仓白名单：目录递归、文件逐个列。`.dsh-dev/`、`__pycache__`、dist 永不入选。 */
const FILES = [
  'index.js', 'client.js', 'cordis.patch.yml', 'package.json',
  'README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE',
];
const DIRS = [
  'assets',
  'resources',
  'docs',
  'verify',
  ['skill', ['mascot-emo']],
  ['scripts', ['cutout_solid.py', 'validate-resources.mjs', 'update-resources.mjs', 'clean-prompts-v2.mjs', 'build-public-bundle.mjs']],
];

const PRIVACY_PATTERNS = [
  [/\b(sk|ghp|gho|ghu|github_pat)[-_][A-Za-z0-9_]{16,}/, '疑似 API/token 字面量'],
  [/(?<![A-Za-z0-9_/])[A-Za-z0-9]{32,}(?![A-Za-z0-9_/])/, '疑似超长凭据串（32+ 连续字母数字）'],
  [/BEGIN [A-Z ]*PRIVATE KEY/, '私钥块'],
  [/\/Users\/[A-Za-z0-9_]+\//, '本机绝对路径'],
  [/(wocheng|wochengtv|autodl|ssh\s+\S+@)/i, '中转商 / 节点 / 远程主机'],
  [/(password|passwd|secret)\s*[:=]\s*['"][^'"]{6,}['"]/i, '明文口令'],
];
// 已知误报白名单（逐行放行，注释在案）
const LINE_ALLOW = [
  /DEEPSEEK_API_KEY:\s*'explicit'/,   // verify/smoke.mjs 的测试夹具
  /ssh\\s\+\\S\+@/,                   // 本文件 PRIVACY_PATTERNS 定义行（正则源码自指）
];

// 重建输出目录：**绝不能动 .git**——公开仓是跨版本持久存在的独立 git 仓库
// （SOP：第一次提交起历史，后续 release 增量提交）。教训：曾整目录 rmSync
// 连 .git 一起删，下一次 git add 落到上级工作区仓库（已回滚修复）。这里只
// 清空 .git 以外的条目；.git 不存在时提示先按 SOP 初始化。
const gitDir = join(out, '.git');
if (existsSync(out)) {
  for (const entry of readdirSync(out)) {
    if (entry === '.git') continue;
    rmSync(join(out, entry), { recursive: true, force: true });
  }
} else {
  mkdirSync(out, { recursive: true });
}
if (!existsSync(gitDir)) {
  console.error(`提示：${out} 还不是 git 仓库。首建按 SOP：`);
  console.error('  cd dist/public && git init -b main && git remote add origin <public-url> && git fetch origin main && git reset --soft FETCH_HEAD');
  console.error('（之后本脚本只增量更新工作区，git 提交由发布流程执行）');
}

const copied = [];
for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) continue; // README.en.md 等可选
  cpSync(src, join(out, f));
  copied.push(f);
}
for (const dir of DIRS) {
  const [name, only] = Array.isArray(dir) ? dir : [dir, null];
  const src = join(root, name);
  if (!existsSync(src)) continue;
  cpSync(src, join(out, name), {
    recursive: true,
    filter: (s) => {
      const base = s.split('/').pop();
      if (base === '.DS_Store' || base === '__pycache__') return false;
      if (only && s === src) return true;
      if (only) {
        const rel = relative(src, s);
        return rel === '' || only.some((o) => rel === o || rel.startsWith(o + '/'));
      }
      return true;
    },
  });
  copied.push(name + '/');
}

writeFileSync(join(out, '.gitignore'), '.DS_Store\nnode_modules/\ndist/\n');

// ---- 隐私扫描：0 命中才放行 ------------------------------------------------
let hits = 0;
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const rel = relative(out, p);
      if (e.size > 2_000_000) continue; // PNG 等二进制大图不扫文本
      if (!/\.(js|mjs|py|json|md|yml|svg|txt|html|css)$/.test(e.name)) continue;
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (LINE_ALLOW.some((re) => re.test(line))) return;
        for (const [re, label] of PRIVACY_PATTERNS) {
          if (re.test(line)) {
            console.error(`HIT  ${label}  ${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
            hits += 1;
          }
        }
      });
    }
  }
};
walk(out);

console.log(`白名单构建：${copied.length} 项 → ${out}`);
if (hits > 0) {
  console.error(`\n隐私扫描 ${hits} 命中——拒绝放行。逐条处理后重跑。`);
  process.exit(1);
}
console.log('隐私扫描：0 命中，放行。');
console.log('下一步：在目标目录执行 git add -A && git commit && git push。');

#!/usr/bin/env node
/**
 * Repository-side packager for the prompt resource library (需求 4).
 *
 * Run this after editing resources/index.json to:
 *   1. validate every entry against the same rules the plugin enforces at
 *      sync time (a library that fails here would be rejected by users too);
 *   2. bump the version (patch by default, `--minor` for content batches);
 *   3. stamp generatedAt;
 *   4. print a per-entry content hash list for the CHANGELOG.
 *
 * The published artifact IS resources/index.json itself — the plugin's
 * syncUrl points at its GitHub raw URL, so "push to main" is the release.
 *
 * Usage:
 *   node scripts/update-resources.mjs           # validate + bump patch
 *   node scripts/update-resources.mjs --minor   # validate + bump minor
 *   node scripts/update-resources.mjs --check   # validate only, no write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateResources } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'resources', 'index.json');
const mode = process.argv[2] ?? '';

const bump = (version) => {
  const parts = String(version ?? '0.0.0').split('.').map((n) => Number.parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (mode === '--minor') {
    parts[1] += 1;
    parts[2] = 0;
  } else {
    parts[2] += 1;
  }
  return parts.join('.');
};

let index;
try {
  index = JSON.parse(readFileSync(target, 'utf8'));
} catch (error) {
  console.error(`读取失败：${error?.message ?? error}`);
  process.exit(1);
}

const errors = validateResources(index);
if (errors.length) {
  console.error(`resources/index.json 未通过校验，拒绝打包：`);
  for (const line of errors) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(`校验通过：${index.entries.length} 条条目`);
const byVendor = {};
for (const entry of index.entries) byVendor[entry.sourceVendor] = (byVendor[entry.sourceVendor] ?? 0) + 1;
for (const [vendor, count] of Object.entries(byVendor)) console.log(`  ${vendor}: ${count} 条`);

if (mode === '--check') {
  console.log('--check：不写回。');
  process.exit(0);
}

const fromVersion = index.version;
index.version = bump(fromVersion);
index.generatedAt = new Date().toISOString();
writeFileSync(target, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

console.log(`\n版本：${fromVersion} → ${index.version}`);
console.log('条目内容哈希（写 CHANGELOG 用）：');
for (const entry of index.entries) {
  const hash = createHash('sha256').update(entry.prompt).digest('hex').slice(0, 8);
  console.log(`  ${hash}  ${entry.id}  ${entry.sourceDate}  ${entry.title}`);
}
console.log('\n下一步：git add resources/index.json && git commit && git push —— 用户端点「同步」即可拉到新版（GitHub raw 缓存约 5 分钟）。');

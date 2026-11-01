#!/usr/bin/env node
// Validates resources/index.json for the dsh-prompt-tips plugin.
// Uses Node built-in modules only (node:fs / node:path / node:url).
// Exit 1 with reasons on any failure; prints "resources OK: N entries" and exits 0 when valid.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(HERE, "..", "resources", "index.json");

// Only official vendor domains count as traceable sources.
const OFFICIAL_HOSTS = new Set([
  "openai.com",
  "platform.openai.com",
  "developers.openai.com",
  "help.openai.com",
  "cookbook.openai.com",
  "anthropic.com",
  "docs.anthropic.com",
  "platform.claude.com",
  "docs.claude.com",
  "claude.com",
]);

const MIN_SOURCE_DATE = "2026-05"; // inclusive floor for the 6-month window
const FETCHED_AT_REQUIRED = "2026-11-01";

const errors = [];
const fail = (msg) => errors.push(msg);

function isOfficialHttpUrl(u) {
  if (typeof u !== "string") return false;
  let url;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return OFFICIAL_HOSTS.has(url.hostname);
}

let data;
try {
  data = JSON.parse(readFileSync(TARGET, "utf8"));
} catch (e) {
  console.error(`FATAL: cannot read/parse ${TARGET}: ${e.message}`);
  process.exit(1);
}

// ---- top level ----
if (!/^\d+\.\d+\.\d+$/.test(data.version ?? '')) {
  fail(`version must be semver (major.minor.patch), got ${JSON.stringify(data.version)}`);
}
if (typeof data.generatedAt !== "string" || Number.isNaN(Date.parse(data.generatedAt))) {
  fail("generatedAt must be an ISO-8601 time string");
}

if (!Array.isArray(data.sources) || data.sources.length === 0) {
  fail("sources must be a non-empty array of {name, url}");
} else {
  data.sources.forEach((s, i) => {
    if (!s || typeof s.name !== "string" || !s.name.trim()) fail(`sources[${i}].name must be a non-empty string`);
    if (!isOfficialHttpUrl(s?.url)) fail(`sources[${i}].url must be an official http(s) URL, got ${JSON.stringify(s?.url)}`);
  });
}

if (!Array.isArray(data.entries)) {
  fail("entries must be an array");
} else {
  if (data.entries.length < 15) {
    fail(`entries must contain at least 15 items, got ${data.entries.length}`);
  }

  const seenIds = new Set();
  data.entries.forEach((e, i) => {
    const at = `entries[${i}]`;

    if (typeof e?.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) {
      fail(`${at}.id must be kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$), got ${JSON.stringify(e?.id)}`);
    } else if (seenIds.has(e.id)) {
      fail(`${at}.id duplicated: "${e.id}"`);
    } else {
      seenIds.add(e.id);
    }

    if (typeof e?.title !== "string" || !e.title.trim()) {
      fail(`${at}.title must be a non-empty string (中文标题)`);
    }

    if (e?.sourceVendor !== "openai" && e?.sourceVendor !== "anthropic") {
      fail(`${at}.sourceVendor must be "openai" or "anthropic", got ${JSON.stringify(e?.sourceVendor)}`);
    }

    if (!isOfficialHttpUrl(e?.sourceUrl)) {
      fail(`${at}.sourceUrl must be an official http(s) URL, got ${JSON.stringify(e?.sourceUrl)}`);
    }

    if (typeof e?.sourceDate !== "string" || !/^\d{4}-\d{2}$/.test(e.sourceDate)) {
      fail(`${at}.sourceDate must match "YYYY-MM", got ${JSON.stringify(e?.sourceDate)}`);
    } else if (e.sourceDate < MIN_SOURCE_DATE) {
      fail(`${at}.sourceDate ${e.sourceDate} is older than the ${MIN_SOURCE_DATE} floor (>6 months old content is not allowed)`);
    }

    if (e?.fetchedAt !== FETCHED_AT_REQUIRED) {
      fail(`${at}.fetchedAt must be "${FETCHED_AT_REQUIRED}", got ${JSON.stringify(e?.fetchedAt)}`);
    }

    if (
      !Array.isArray(e?.tags) ||
      e.tags.length < 3 ||
      e.tags.length > 5 ||
      !e.tags.every((t) => typeof t === "string" && t.trim().length > 0)
    ) {
      fail(`${at}.tags must be an array of 3-5 non-empty strings`);
    }

    if (typeof e?.prompt !== "string" || e.prompt.trim().length === 0) {
      fail(`${at}.prompt must be a non-empty string（=纯官方可复制提示词，与 promptEn 一致）`);
    } else if (e.prompt.length > 2000) {
      fail(`${at}.prompt length ${e.prompt.length} exceeds the 2000-character limit`);
    }

    // 提示词框契约（v1.1 数据治理）：promptEn 必须是纯官方提示词（无 CJK），
    // promptZh 必须是它的 1:1 中文翻译（有 CJK）。
    if (typeof e?.promptEn === "string") {
      if (/[\u4e00-\u9fff]/.test(e.promptEn)) fail(`${at}.promptEn 含中文——提示词框必须只保留可复制的官方提示词`);
      if (e.prompt !== e.promptEn) fail(`${at}.prompt 必须与 promptEn 一致`);
    }
    if (typeof e?.promptZh === "string" && !/[\u4e00-\u9fff]/.test(e.promptZh)) {
      fail(`${at}.promptZh 必须是中文翻译（检测不到 CJK 字符）`);
    }

    if (typeof e?.why !== "string" || e.why.length < 100 || e.why.length > 500) {
      fail(`${at}.why must be 100-500 characters, got ${e?.why?.length ?? "non-string"}`);
    }

    if (typeof e?.summary !== "string" || e.summary.length === 0 || e.summary.length > 60) {
      fail(`${at}.summary must be 1-60 characters, got ${e?.summary?.length ?? "non-string"}`);
    }

    if (e?.verified !== true) {
      fail(`${at}.verified must be exactly true (only include entries verified against fetched official pages)`);
    }
  });
}

if (errors.length > 0) {
  console.error(`resources INVALID: ${errors.length} problem(s) found`);
  for (const m of errors) console.error(`- ${m}`);
  process.exit(1);
}

console.log(`resources OK: ${data.entries.length} entries`);
process.exit(0);

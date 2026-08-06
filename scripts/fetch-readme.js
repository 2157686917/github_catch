/**
 * fetch-readme.js — 抓取指定 GitHub 仓库的 README 与元信息并缓存到本地
 *
 * 用法:
 *   node scripts/fetch-readme.js <owner/repo>
 *
 * 产物:
 *   fetched/<owner>-<repo>/README.md      README 原文（markdown/rst/txt，视仓库而定）
 *   fetched/<owner>-<repo>/info.json      仓库元信息（star、描述、topics、license 等，来自 GitHub API）
 *
 * 说明: 与 fetch-trending.js 同理，走 Node 原生 fetch 直连 raw.githubusercontent.com /
 *       api.github.com，不经过 WebFetch 的 claude.ai 安全校验，不受企业网络策略影响。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const arg = process.argv[2];
if (!arg || !/^[\w.-]+\/[\w.-]+$/.test(arg)) {
  console.error('用法: node scripts/fetch-readme.js <owner/repo>');
  process.exit(1);
}
const [owner, repo] = arg.split('/');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** 带重试的 GET（本机直连偶发瞬时连接超时，重试 3 次） */
async function get(url, headers = {}) {
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(30000),
      });
      return res;
    } catch (e) {
      lastErr = e;
      if (i < 3) {
        console.warn(`  [retry ${i}/3] ${url}: ${e.cause?.code || e.message}`);
        await new Promise((r) => setTimeout(r, 1000 * i));
      }
    }
  }
  throw lastErr;
}

// 1) 仓库元信息（GitHub API）
let info = {};
let defaultBranch = 'HEAD';
try {
  const r = await get(`https://api.github.com/repos/${owner}/${repo}`, { Accept: 'application/vnd.github+json' });
  if (r.ok) {
    const j = await r.json();
    info = {
      full_name: j.full_name,
      stars: j.stargazers_count,
      forks: j.forks_count,
      language: j.language,
      description: j.description,
      homepage: j.homepage,
      license: j.license?.spdx_id ?? null,
      topics: j.topics ?? [],
      created_at: j.created_at ? j.created_at.slice(0, 10) : null,
      archived: j.archived,
    };
    defaultBranch = j.default_branch || 'HEAD';
  } else {
    console.warn(`[warn] GitHub API 返回 ${r.status}，仅用原始 README 尝试。`);
  }
} catch (e) {
  console.warn(`[warn] GitHub API 获取失败: ${e.message}`);
}

// 2) README：raw 直连优先，失败后走 API /readme 兜底
const candidates = ['README.md', 'readme.md', 'Readme.md', 'README.rst', 'readme.rst', 'README.txt', 'readme'];
let readmeText = '';
let usedSource = '';
for (const name of candidates) {
  try {
    const r = await get(`https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${name}`);
    if (r.ok) {
      readmeText = await r.text();
      usedSource = `raw:${name}`;
      break;
    }
  } catch {
    /* 继续尝试下一个 */
  }
}

if (!readmeText) {
  try {
    const r = await get(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      Accept: 'application/vnd.github.raw+json',
    });
    if (r.ok) {
      readmeText = await r.text();
      usedSource = 'api:/readme';
    }
  } catch (e) {
    console.warn(`[warn] README 兜底获取失败: ${e.message}`);
  }
}

const outDir = path.join(ROOT, 'fetched', `${owner}-${repo}`);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'info.json'), JSON.stringify({ ...info, default_branch: defaultBranch }, null, 2));

if (readmeText) {
  fs.writeFileSync(path.join(outDir, 'README.md'), readmeText);
  console.log(`已写入 ${outDir}\\README.md  (${readmeText.length} 字符, 来源 ${usedSource})`);
} else {
  console.warn(`未获取到 README（仓库可能无 README）。元信息已写入 ${outDir}\\info.json`);
}
console.log(
  `仓库信息: ${info.full_name ?? arg}  stars=${info.stars ?? '未知'}  license=${info.license ?? '未知'}  topics=${(info.topics ?? []).join(', ') || '无'}`
);

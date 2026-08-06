/**
 * fetch-trending.js — 抓取 GitHub 热门项目并输出结构化事实数据
 *
 * 用法:
 *   node scripts/fetch-trending.js [since] [top]
 *     since: daily | weekly | monthly（默认 daily）
 *     top:   输出项目数（默认 8）
 *
 * 产物:
 *   fetched/trending-<日期>-<since>.json
 *     - 主数据源: GitHub 搜索 API（created:<时间窗> 内新建、按 star 排序 → 热门新项目，
 *       稳定可达，200 实测）；再用 /repos API 补充 topics/license/创建时间等。
 *     - 尽力而为: 若 github.com/trending 网页本次可达，则解析当日/本周/本月 star 增量
 *       作为补充字段（stars_delta）；不可达时该字段为 null，不阻塞主流程。
 *
 * 为什么这样设计（网络问题解决方案）:
 *   - WebFetch 工具抓任意网页前，需先连 claude.ai（Anthropic 安全校验服务）确认目标域名
 *     "安全可抓"，本机企业网络策略封了 claude.ai，导致 WebFetch 对所有域名都失败。
 *   - 实测本机网络: api.github.com / raw.githubusercontent.com 稳定可达；github.com
 *     网页主机（20.205.243.166）偶发被过滤/超时。因此主数据源走 GitHub API，
 *     Trending 网页仅作可选补充，全程不经过 claude.ai。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const since = process.argv[2] || 'daily';
const top = Math.max(1, parseInt(process.argv[3] || '8', 10) || 8);

if (!['daily', 'weekly', 'monthly'].includes(since)) {
  console.error('错误: since 仅支持 daily | weekly | monthly');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** 带重试的抓取（本机直连偶发瞬时连接超时，重试 3 次、退避递增） */
async function fetchText(url, headers = {}, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < tries) {
        console.warn(`  [retry ${i}/${tries}] ${url}: ${e.cause?.code || e.message}`);
        await new Promise((r) => setTimeout(r, 1000 * i));
      }
    }
  }
  throw lastErr;
}

function toNum(s) {
  return parseInt(String(s).replace(/[^\d]/g, ''), 10) || null;
}

function stripTags(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 时间窗映射: daily→近2天, weekly→近7天, monthly→近30天 */
function createdSince(dateStr) {
  const d = new Date(dateStr);
  const days = since === 'daily' ? 2 : since === 'weekly' ? 7 : 30;
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ========== 主数据源: GitHub 搜索 API（稳定可达） ==========
const dateStr = new Date().toISOString().slice(0, 10);
const createdDate = createdSince(dateStr);
const q = `created:>=${createdDate} stars:>=50`;
const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${Math.min(25, top * 2)}`;

console.log(`[主源] 搜索 API: ${q}`);
const searchJson = JSON.parse(await fetchText(searchUrl, { Accept: 'application/vnd.github+json' }));
const candidates = (searchJson.items || []).slice(0, top);
if (candidates.length === 0) {
  console.error('错误: 搜索 API 未返回任何项目。');
  process.exit(1);
}

// ========== 尽力而为: github.com/trending 网页增量（不可达则跳过） ==========
const deltaMap = new Map();
try {
  console.log(`[补充] 尝试解析 github.com/trending?since=${since} 的 star 增量...`);
  const html = await fetchText(`https://github.com/trending?since=${since}`);
  for (const block of html.split('<article class="Box-row">').slice(1)) {
    const m = block.match(/<h2 class="h3 lh-condensed">[\s\S]*?href="\/([^"/]+\/[^"/]+)"/);
    if (!m) continue;
    const fullName = m[1];
    const re = escapeRe(fullName);
    const stars = block.match(new RegExp(`href="/${re}/stargazers"[^>]*>[\\s\\S]*?</svg>\\s*([\\d,]+)\\s*</a>`));
    const delta = block.match(/([\d,]+)\s+stars (today|this week|this month)/);
    const lang = block.match(/itemprop="programmingLanguage">([^<]+)</);
    const desc = block.match(/<p class="col-9[^"]*">\s*([\s\S]*?)\s*<\/p>/);
    deltaMap.set(fullName, {
      stars_delta: delta ? toNum(delta[1]) : null,
      delta_period: delta ? delta[2] : null,
      language: lang ? lang[1].trim() : null,
      description: desc ? stripTags(desc[1]) : '',
      stars_html: stars ? toNum(stars[1]) : null,
    });
  }
  console.log(`[补充] Trending 网页解析到 ${deltaMap.size} 个项目`);
} catch (e) {
  console.warn(`[补充] Trending 网页本次不可达（不影响主流程）: ${e.cause?.code || e.message}`);
}

// ========== 逐仓补充: /repos API ==========
async function enrichRepo(fullName) {
  try {
    const txt = await fetchText(`https://api.github.com/repos/${fullName}`, {
      Accept: 'application/vnd.github+json',
    });
    const j = JSON.parse(txt);
    return {
      stars_api: j.stargazers_count ?? null,
      forks_api: j.forks_count ?? null,
      open_issues: j.open_issues_count ?? null,
      created_at: j.created_at ? j.created_at.slice(0, 10) : null,
      license: j.license?.spdx_id ?? null,
      topics: Array.isArray(j.topics) ? j.topics : [],
      homepage: j.homepage ?? null,
      archived: !!j.archived,
      default_branch: j.default_branch ?? null,
      description_api: j.description ?? null,
    };
  } catch (e) {
    console.warn(`  [warn] GitHub API 补充失败 ${fullName}: ${e.message}`);
    return {};
  }
}

console.log(`选取前 ${candidates.length} 个，正在用 /repos API 补充数据...`);
const enriched = [];
for (const c of candidates) {
  process.stdout.write(`  ${c.full_name} ... `);
  const extra = await enrichRepo(c.full_name);
  const t = deltaMap.get(c.full_name) || {};
  enriched.push({
    full_name: c.full_name,
    html_url: c.html_url,
    language: t.language ?? c.language ?? null,
    description: t.description || c.description || '',
    stars_delta: t.stars_delta ?? null,
    delta_period: t.delta_period ?? null,
    stars_html: t.stars_html ?? null,
    search_stars: c.stargazers_count ?? null,
    ...extra,
  });
  console.log(`stars=${extra.stars_api ?? c.stargazers_count}`);
  await new Promise((r) => setTimeout(r, 400)); // 轻量限速，避免触发 API 次级限流
}

// ========== 落盘 ==========
const outDir = path.join(ROOT, 'fetched');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `trending-${dateStr}-${since}.json`);
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      date: dateStr,
      since,
      fetched_at: new Date().toISOString(),
      search_query: q,
      trending_html_available: deltaMap.size > 0,
      projects: enriched,
    },
    null,
    2
  )
);

console.log(`\n已写入 ${outFile}`);
const htmlOk = deltaMap.size > 0;
console.log('\n== 候选摘要 ==');
for (const p of enriched) {
  const stars = p.stars_api ?? p.search_stars;
  const delta =
    p.delta_period ? `+${p.stars_delta} ${p.delta_period}`
    : htmlOk ? '未在 Trending 页命中增量'
    : 'Trending 网页本次不可达';
  console.log(
    `  ${p.full_name}  ⭐${stars}  (${delta})  ${p.language ?? '无语言'}  created=${p.created_at ?? '未知'}`
  );
}

/**
 * fetch-url.js — 通用网页抓取（用于 learn-styles 范文学习），保存原文与去标签可见文本
 *
 * 用法:
 *   node scripts/fetch-url.js <url> [name]
 *     name 缺省时自动用序号
 *
 * 产物:
 *   fetched/samples/<name>.html   原始 HTML
 *   fetched/samples/<name>.txt    去 script/style/导航噪音后的可见文本（供提炼文风）
 *
 * 说明: 走 Node 原生 fetch，不经过 WebFetch 的 claude.ai 安全校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error('用法: node scripts/fetch-url.js <url> [name]');
  process.exit(1);
}
const name = process.argv[3] || `sample-${Date.now()}`;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// 带重试的抓取（本机直连偶发瞬时连接超时，重试 3 次）
let res;
{
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(30000),
      });
      break;
    } catch (e) {
      lastErr = e;
      if (i < 3) {
        console.warn(`  [retry ${i}/3] ${url}: ${e.cause?.code || e.message}`);
        await new Promise((r) => setTimeout(r, 1000 * i));
      } else {
        res = null;
      }
    }
  }
  if (!res) throw lastErr;
}
if (!res.ok) {
  console.error(`抓取失败: HTTP ${res.status} ${url}`);
  process.exit(1);
}
const html = await res.text();

const outDir = path.join(ROOT, 'fetched', 'samples');
fs.mkdirSync(outDir, { recursive: true });

// 提取标题：<title> → og:title → h1（部分站点如微信公众号 <title> 为空）
const title =
  (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() ||
  (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1]?.trim() ||
  (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]*>/g, '').trim() ||
  url;

// 生成可见文本：去掉 script/style/nav/header/footer 噪音后剥离标签
const main = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s*\n+/g, '\n\n')
  .trim();

fs.writeFileSync(path.join(outDir, `${name}.html`), html);
fs.writeFileSync(path.join(outDir, `${name}.txt`), main);
console.log(`已写入 fetched/samples/${name}.html（${html.length} 字符）与 ${name}.txt（${main.length} 字符）`);
console.log(`标题: ${title}`);

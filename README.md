# github_catch_trae

GitHub 热门项目自动挖掘、撰文与审核工作流（Trae/Agent 编排版）。

流程：抓取 GitHub 热门新项目 → 深度解析产出项目简报 → 按文风知识库撰写介绍文章 → 主编多轮审核 → 归档为「可发布」成品。全部环节由 Agent 按 [workflow.md](workflow.md) 编排执行。

## 为什么抓取层用 Node 脚本

原方案（Claude Code 的 WebFetch）抓取任意网页前需先连接 claude.ai 安全校验服务；在企业网络策略封禁 claude.ai 的环境中，WebFetch 对所有域名都会失败。

因此本项目的抓取层剥离为独立 Node 脚本（原生 fetch + 3 次重试）：主数据源走稳定可达的 GitHub API（搜索 API + `/repos` 详情），Trending 网页仅作「尽力而为」的 star 增量补充，全程不经过 claude.ai，无需代理。

## 目录结构

| 路径 | 作用 |
|---|---|
| `agents/` | 三角色系统提示词：project-miner（挖掘解析）/ content-writer（撰文重构）/ chief-editor（审核 + 知识库维护） |
| `scripts/` | 抓取脚本（Node 原生 fetch，零外部依赖） |
| `briefs/<日期>/` | 项目简报（shortlist.md，候选短名单） |
| `learned_oldest.md` | 文风知识库（learn 工作流增量维护） |
| `可发布文章/` | 审核通过并归档的文章 |
| `fetched/` | 抓取缓存（已 gitignore，运行脚本自动生成） |

## 快速开始

要求：Node.js ≥ 18（内置全局 `fetch`）。

```bash
# 抓取热门新项目（近 2 天创建、star >= 50，取前 8）
node scripts/fetch-trending.js daily 8

# 抓取某个仓库的 README 详情
node scripts/fetch-readme.js firecrawl/anydoc

# 抓取任意网页（learn 工作流范文学习用）
node scripts/fetch-url.js https://example.com my-sample
```

产物统一落在 `fetched/` 目录。

## 三个工作流

1. **discover（发现短名单）**：抓取热门 → 逐仓解析 → 产出 `briefs/<日期>/shortlist.md` → 用户挑选一个项目进入 publish。
2. **publish（写文 + 审核 + 归档）**：按简报 + README 写初稿 → 主编按 `learned_oldest.md` 审核（≤5 轮）→ 通过后归档到 `可发布文章/<项目名>/<日期>/`。
3. **learn（范文学习）**：用户提交范文链接（单次 ≤2 篇）→ 提炼文笔语气/结构/词汇 → 去重后增量写入 `learned_oldest.md`。

详细规则见 [workflow.md](workflow.md) 与 [需求文档.md](需求文档.md)。

## 数据真实性约定

- 所有 star 数、命令、版本等事实一律以 `fetched/` 脚本产物为准，禁止编造；缺失数据如实标注「未知」。
- 本仓库不含任何第三方版权内容：范文样本属抓取缓存，不随仓库分发。

## License

[MIT](LICENSE)

# GitHub 热门项目自动撰文与审核工作流 — Trae 编排手册

> 本目录（`github_catch_trae`）是原 `github_catch`（Claude Code 版）的 Trae 重构版。核心差异：**抓取层从 WebFetch 剥离为独立脚本**，绕开被企业网络策略拦截的 claude.ai 安全校验通道。

## 0. 网络问题与解决方案（先读这段）

**原问题**：Claude Code 的 WebFetch 工具抓任意网页前，必须先连 `claude.ai`（Anthropic 安全校验服务）确认目标域名"安全可抓"。本机企业网络策略封了 `claude.ai`，导致 WebFetch 对所有域名返回 `Unable to verify if domain is safe to fetch`，抓取 GitHub Trending 全部失败。

**实测网络画像**（本机直连，无代理）：
- `api.github.com`、`raw.githubusercontent.com`：**稳定可达**（200）
- `github.com` 网页主机（20.205.243.x）：**不稳定**，偶发连接超时/被过滤
- `claude.ai`：被企业策略拦截

**解决方案**：全部联网改为 `scripts/` 下的 Node 脚本，用原生 fetch 直连（带 3 次重试），主数据源走稳定可达的 GitHub API，Trending 网页仅作尽力而为的增量补充。全程不经过 claude.ai，无需代理、无需换网络。

## 1. 目录结构

```
github_catch_trae/
├── agents/                        # 三角色系统提示词（Trae 编排时按角色执行）
│   ├── project-miner.md           # Agent A：项目挖掘与解析
│   ├── content-writer.md          # Agent C：内容撰写与重构
│   └── chief-editor.md            # Agent B：主编审核 + 知识库维护
├── scripts/                       # 抓取层（Node 原生 fetch，不依赖 claude.ai）
│   ├── fetch-trending.js          # 抓取热门项目 → fetched/trending-<日期>-<since>.json
│   ├── fetch-readme.js            # 抓取仓库 README → fetched/<owner>-<repo>/README.md + info.json
│   └── fetch-url.js               # 通用抓取（范文学习）→ fetched/samples/<name>.html/.txt
├── learned_oldest.md              # 文风知识库（根目录，全局唯一）
├── briefs/<日期>/shortlist.md      # 项目简报（project-miner 产出）
├── fetched/                       # 抓取产物缓存（JSON / README / 范文样本）
├── <项目名>/<日期>/文章.md          # 归档文章（frontmatter: status: 可发布）
├── workflow.md                    # 本文档（编排手册）
└── 需求文档.md                     # PRD（与原项目一致）
```

## 2. 通用执行约定（Trae 编排）

- 每个角色执行前，先读 `agents/<角色>.md` 作为系统提示词。
- **禁止使用 WebFetch / WebSearch**；联网一律用 `node scripts/*.js`（RunCommand）。
- 所有数据以 `fetched/` 缓存为准，禁止编造；缺失数据如实标注"未知"。
- 日期格式 `YYYY-MM-DD`，不传时取当日。

## 3. 工作流 1：发现短名单（discover）

1. 运行 `node scripts/fetch-trending.js daily 8`（since 可换 weekly/monthly，top 可调）。
2. 读 `fetched/trending-<日期>-<since>.json`，按热度增量/受众/部署复杂度筛选候选。
3. 对候选逐个运行 `node scripts/fetch-readme.js <owner>/<repo>`，读 README 深度解析。
4. 以 project-miner 角色写 `briefs/<日期>/shortlist.md`（中文 Markdown，默认前 5）。
5. 向用户展示短名单，由用户挑选一个项目进入 publish。

## 4. 工作流 1：写文 + 审核 + 归档（publish）

1. 取简报：从 `briefs/<日期>/shortlist.md` 按项目名匹配；没有则重跑 discover 现场补。
2. 确保 README 缓存存在（缺失则 `node scripts/fetch-readme.js <owner>/<repo>`）。
3. 以 content-writer 角色写初稿（基于简报 + README 缓存，默认框架：痛点引入 → 效果演示 → 核心功能 → 部署步骤 → 总结评估；若 `learned_oldest.md` 有规则则严格遵循）。
4. 以 chief-editor 角色审核 → 判定 `pass`/`revise`（附具体意见）：
   - `pass` → 进入归档；`revise` → content-writer 按意见重构 → 回到 4。
   - **上限 5 轮**；达上限仍未通过 → 不归档，输出"未通过审核（已达轮次上限）"。
5. 归档：创建 `./<项目名>/<当日日期>/`，写 `<项目名>-介绍.md`，frontmatter：
   ```markdown
   ---
   title: "XXXX 项目介绍"
   date: YYYY-MM-DD
   status: 可发布
   ---
   ```

## 5. 工作流 2：范文学习（learn）

1. 入参：范文链接 `urls`（**单次 ≤2 篇**）。
2. 逐个运行 `node scripts/fetch-url.js <url> <name>` → 读 `fetched/samples/<name>.txt`。
3. 以 chief-editor 角色提炼：文笔语气 / 介绍逻辑与结构 / 高频亮点词汇与修辞偏好。
4. 读 `learned_oldest.md` 全量内容做语义/规则级查重。
5. 只把新增规则增量追加到 `learned_oldest.md`（保持格式、不覆盖）；全部重复则跳过写入。

## 6. 规则与边界（沿用 PRD）

| 规则 | 约束 |
|---|---|
| 审核循环 | ≤5 轮，超限不归档 |
| 范文链接 | learn 单次 ≤2 篇 |
| 知识库兜底 | `learned_oldest.md` 缺失/为空 → 默认主编标准，不报错 |
| 数据真实性 | 全部以脚本产物为准，禁止编造；来源与日期写入简报/文章 |
| 归档标记 | frontmatter 必须含 `status: 可发布` |
| 触发方式 | 全部由 Trae 按本手册编排执行（手动触发，无定时） |

## 7. 明确不做（YAGNI，沿用原设计）

- 不做多项目批量并发撰文（单次一篇）。
- 不做文章自动发布到外部平台（仅本地归档）。
- 不做定时任务调度（手动触发）。

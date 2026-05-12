<p align="center">
  <h1 align="center">SentiRoute</h1>
  <p align="center"><strong>别再跟降智模型吵架了。</strong></p>
  <p align="center">
    <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a>
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node.js >=18">
  <img src="https://img.shields.io/badge/typescript-6.0-blue" alt="TypeScript 6.0">
  <img src="https://img.shields.io/badge/tests-535%20passed-success" alt="535 Tests Passed">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
</p>

---

SentiRoute 是一个**本地 HTTP 代理**，部署在你的 AI 编程工具和上游 LLM 提供商之间。它**实时分析对话的情绪基调**——当你开始骂模型、重复发同样的话、指责模型"降智"时，它会悄悄把你切到备用上游，不浪费你哪怕一个 token 在跟退化模型较劲上。

与基于配额/余额切换的 [9router](https://github.com/decolua/9router.git) 不同，SentiRoute 基于**情绪**切换。代理架构借鉴了 9router 的本地上游适配器设计，SSE 格式翻译参考了 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的流式状态机模式。同样的地基，不同的切换哲学。

## 赞助

感谢 **[RemixCodes](https://remix.codes/)** 对本项目的赞助！

RemixCodes 是一家可靠高效的 API 中转服务商，提供 Claude 和 GPT 全系模型的统一 API 接入。充值 1:1 人民币兑美元，Claude 低至 0.5 倍率，GPT-5.5 低至 0.3 倍率。无需海外信用卡，无地域封锁。

## 快速开始

```bash
# 全局安装
npm install -g sentiroute

# 启动代理 —— 首次运行自动在运行目录创建 sentiroute.yaml 并填入默认配置
sentiroute

# 把编程工具配置为 http://127.0.0.1:3000
```

首次运行时，SentiRoute 会在当前目录创建 `sentiroute.yaml`，预配置好 Claude Opus、Sonnet、Haiku 三个模型槽位，全部指向 Anthropic API。把 `sk-ant-your-key-here` 替换成你的真实 API key，或者在浏览器中打开 Dashboard 配置一切。

也可以从源码启动：

```bash
git clone <repo-url> && cd sentiroute && npm install
npm run build && npm start
```

### Dashboard

服务启动后，打开 **http://127.0.0.1:3000/dashboard/** 进入浏览器配置面板：

- **Config 标签** — 编辑上游端点、API key、模型映射、代理鉴权
- **Sentiment 标签** — 各槽位分数条，实时自动刷新
- **History 标签** — 切换事件时间线，含时间戳和原因
- **运行时参数** — 阈值、衰减率、冷却时间滑块（热更新，无需重启）

## 工作原理

```
┌──────────────┐     Anthropic SSE      ┌──────────────┐    原生/翻译后        ┌──────────────┐
│  Claude Code │ ──── POST /v1/ ──────→ │  SentiRoute  │ ──── HTTP fetch ────→ │   上游服务   │
│  Codex 等    │ ←─── messages   ────── │  :3000       │ ←─── SSE 流  ──────── │   提供商     │
└──────────────┘                        └──────┬───────┘                       └──────────────┘
                                               │
                                          ┌────▼────┐
                                          │  情绪分析  │  "这破玩意又坏了，你个傻逼"
                                          │  引擎    │  ──→  分数: 0.87  ──→  切换到备用
                                          └────────────┘
```

每个请求经过三个子系统协同处理：

### 1. 情绪检测引擎

通过**6 个信号维度**对用户消息进行关键词/启发式打分：

| 信号 | 权重 | 检测内容 |
|------|------|---------|
| **降智** | 0.9 | "降智", "dumb", "downgraded", "lobotomized", "nerfed", "变笨了" |
| **脏话** | 0.8 | "fuck", "shit", "垃圾", "废物", "useless", "傻逼", "tmd" |
| **重复** | 0.6 | 同一条消息连续发送 3 次以上（Jaccard 相似度） |
| **命令式** | 0.4 | "stop", "don't", "wrong", "fix this", "不对", "错了" |
| **大写** | 0.3 | 大写字母占比 > 50%（在吼你） |
| **简短** | 0.2 | 长对话后的极短消息（放弃挣扎） |

权重完全可配置。分数随**指数时间衰减**——你冷静下来，分数自然下降。新信号与历史积累按 70/30 比例融合，过渡平滑。

分析引擎原生支持中英文挫败信号——零 NLP 依赖，零模型开销，零额外延迟。

### 2. 自动切换逻辑

```
分数 > 阈值 (0.6) 且在主线？
  ├─ 是 → 切换到备用，开始冷却
  │        冷却 = 基础 × 2^触发次数（指数退避，最长 1 小时）
  │        防抖锁：60 秒内禁止再次切换
  ├─ 否 + 已在备用 + 冷却过期？
  │        → 切回主线（"情绪已恢复"）
  └─ 否 → 保持不动
```

配置 3 个以上上游时，系统逐级升级：主线 → 备用-1 → 备用-2。恢复始终回到主线。切换事件记录到控制台并持久化到磁盘。

### 3. 格式翻译

SentiRoute 支持 Anthropic Messages API 与 OpenAI Chat Completions API 之间的**双向翻译**——包括 SSE 流式传输：

| 方向 | 请求 | 响应（非流式） | 流式（SSE） |
|------|------|---------------|------------|
| Anthropic → OpenAI | `system` → system message，`tool_use` → `tool_calls` | Content blocks → ChatCompletion | 逐事件状态机（6 种事件类型映射） |
| OpenAI → Anthropic | System message → 顶层 `system`，`tool_calls` → `tool_use` | ChatCompletion → Content blocks | 逐块状态机（工具调用索引追踪） |

仅当客户端格式与上游格式不同时才激活翻译。同格式请求直接透传，零开销。

## 配置参考

完整的 `sentiroute.yaml` 及所有可用选项：

```yaml
server:
  host: '127.0.0.1'     # 绑定地址
  port: 3000             # 绑定端口
  # api_key: 'your-secret-key'  # 调用代理时需要提供此 key。留空或删除则禁用鉴权。

model_slots:
  # 槽位键 = 你在编程工具里怎么称呼这个模型
  opus:
    model: claude-opus-4-7       # 编程工具发送的官方模型 ID
    upstreams:
      - name: Primary            # 日志用的可读名称
        endpoint: 'https://api.anthropic.com/v1'
        api_key: 'sk-ant-...'
        upstream_model: claude-opus-4-7   # 实际请求的模型名
        format: anthropic                  # 'anthropic' 或 'openai'
        timeoutMs: 120000                  # 默认: 120000

      - name: Backup             # 情绪触发时切换到这里
        endpoint: 'https://api.openai.com/v1'
        api_key: 'sk-or-...'
        upstream_model: gpt-5
        format: openai

      # 可以配任意多个备用上游
      - name: Emergency
        endpoint: 'https://alternative.api/v1'
        api_key: 'sk-...'
        upstream_model: claude-sonnet-4-6
        format: anthropic

  sonnet:
    model: claude-sonnet-4-6
    upstreams:
      # ... 同样结构

  haiku:
    model: claude-haiku-4.5
    upstreams:
      # ... 同样结构

# 可选：自定义情绪检测
sentiment:
  threshold: 0.6        # 触发切换的分数阈值 (0.0–1.0)
  decayRate: 0.1         # 累积分数每小时衰减比例
  cooldownMs: 300000     # 重试主线前的最小等待时间（毫秒，默认: 5分钟）
  antiFlapMs: 60000      # 两次切换之间的最小间隔（毫秒，默认: 1分钟）
  weights:               # 各信号权重（全部可选，0.0–1.0）
    degradation: 0.9
    profanity: 0.8
    repetition: 0.6
    imperatives: 0.4
    caps: 0.3
    brevity: 0.2
```

### 模型 ID 映射

SentiRoute 使用**模糊匹配**模型 ID。你的编程工具发送 `claude-haiku-4-5-20251001`（完整变体 ID），它会自动匹配到 `haiku` 槽位。你不需要配置精确的模型字符串——用人类可读的槽位键就行。

## CLI

```bash
# 启动服务
sentiroute

# 查看所有槽位的情绪状态
sentiroute status
```

`sentiroute status` 输出示例：

```
SentiRoute v0.1.0
Config: /home/user/.sentiroute/sentiroute.yaml

opus → claude-opus-4.7
  Score:       0.23 / 1.00  (threshold: 0.6)
  Upstream:    Primary  (#1 of 3)
  Cooldown:    none
  Triggers:    1
  History:
    2026-05-11 20:15:32  #0→#1  score:0.72  exceeded threshold
    2026-05-11 20:45:01  #1→#0  score:0.31  recovered

sonnet → claude-sonnet-4-6
  Score:       0.05 / 1.00  (threshold: 0.6)
  Upstream:    Primary  (#1 of 2)
  Cooldown:    none
  Triggers:    0
```

## API 端点

SentiRoute 提供标准的 LLM 代理接口：

| 端点 | 格式 | 说明 |
|------|------|------|
| `POST /v1/messages` | Anthropic Messages API | 主要端点，供 Claude Code、Cursor 等使用 |
| `POST /v1/chat/completions` | OpenAI Chat Completions API | 供 OpenAI 格式的客户端使用 |
| `GET /health` | JSON | 运行时间、配置、当前上游状态 |

两个 POST 端点均支持**流式传输（SSE）**，并在需要时自动翻译格式。

### 代理鉴权

在 `sentiroute.yaml` 中设置 `server.api_key` 后，所有代理端点（`/v1/messages`、`/v1/chat/completions`）均需鉴权。客户端需通过以下方式之一提供密钥：

- `Authorization: Bearer <key>` 请求头，或
- `x-api-key: <key>` 请求头

`/health`、`/dashboard/` 和 `/api/dashboard/` 端点免鉴权，始终可公开访问。

如果未设置 `server.api_key` 或为空，则禁用鉴权（所有请求直接通过）。

响应头：

| 响应头 | 值 |
|--------|------|
| `X-SentiRoute-Upstream` | 处理本次请求的模型槽位键 |
| `X-SentiRoute-Score` | 当前模型槽位的情绪分数 (0.00–1.00) |

## 请求日志

每个请求在 stdout 输出一行简洁摘要：

```
2026-05-11T20:15:32.123Z  POST /v1/messages  opus  Primary  200  2341ms
```

发生切换时，额外打印一行：

```
2026-05-11T20:16:01.456Z  SWITCH  opus  sentiment threshold exceeded (score: 0.78, threshold: 0.60)
```

结构化 JSONL 日志写入配置目录，供程序化消费。

## 架构

```
src/
├── config/           # YAML 加载、Zod schema 校验、路径解析
├── proxy/            # 模型槽位路由、上游 HTTP 执行器（原生 fetch）
├── server/
│   ├── routes/       # Fastify 路由处理（messages、chat、health）
│   └── middleware/    # 请求日志（pino JSONL）
├── translation/      # Anthropic ↔ OpenAI 双向格式翻译
│   ├── request/      # 请求体翻译器
│   ├── response/     # 响应 + SSE 流式状态机
│   └── sse-parser.ts  # SSE 行协议解析器
├── sentiment/        # 情绪分析 + 自动切换
│   ├── signals.ts    # 关键词词典、加权打分引擎
│   ├── state.ts      # 基于 conf 的持久化状态 + 序列化写队列
│   └── switch.ts     # 切换决策逻辑（阈值、冷却、防抖）
└── index.ts          # 入口、CLI 路由、优雅关闭
```

### 关键设计决策

**零 NLP 开销。** 情绪分析器是操作关键词词典的纯函数。无 ONNX 模型，无自然语言库，无 GPU。一个请求通过分析器的时间 < 1ms。

**提供商无关。** 每个上游通过 URL、API key 和格式配置。无内置提供商集成。无 OAuth 流程。自带 key。

**Conf 库做状态持久化。** `conf` 库提供原子写入和跨平台文件路径（Linux: `~/.config/sentiroute/`，macOS: `~/Library/Preferences/sentiroute/`）。序列化写队列防止并发请求下的数据损坏。

**完整请求头透传。** 所有客户端请求头（包括 `anthropic-beta`、`anthropic-dangerous-direct-browser-access` 等）原样转发到上游。仅鉴权头被替换为配置的 API key。这能防止上游服务检测到代理的存在。

## 开发

```bash
git clone https://github.com/user/sentiroute.git
cd sentiroute
npm install

# 开发服务器（热重载）
npm run dev

# 类型检查
npm run typecheck

# 运行测试
npm test

# 生产构建
npm run build      # tsup 打包 → dist/
npm start          # 运行 dist/index.js
```

### 环境要求

- Node.js >= 18（已在 Node 24 测试通过）
- TypeScript 6.0

### 技术栈

| 层 | 选择 | 理由 |
|------|------|------|
| HTTP 服务 | Fastify 5 | JSON 序列化比 Express 快 3 倍，一流的流式支持 |
| HTTP 客户端 | 原生 `fetch` | 零依赖，ReadableStream 支持，Node 18+ 内置 |
| 配置 | YAML + Zod 4 | 人类可编辑配置，运行时类型推导，清晰的错误提示 |
| 日志 | Pino 10 | Node 生态最快的 JSON logger，结构化输出 |
| 状态 | Conf 15 | 原子写入，跨平台路径，无需数据库 |
| 测试 | Vitest 4 | 原生 ESM，TS 源码支持，速度快 |

## 对比

| 特性 | SentiRoute | 9router |
|------|-----------|---------|
| 切换触发 | 用户情绪 / 挫败感 | 配额 / 余额耗尽 |
| 检测方式 | 关键词启发式（零延迟） | Token 计数 |
| 切换行为 | 情绪阈值 + 冷却 + 退避 | 基于余额的降级 |
| 格式翻译 | 双向 Anthropic ↔ OpenAI + SSE | Anthropic ↔ OpenAI |
| 状态持久化 | 原子 JSON（conf） | JSON 文件 |
| 每槽位上游数 | 无限，带可读名称 | 主线 + 备用 |

SentiRoute 基于与 9router 相同的代理架构，但将路由引擎从配额驱动替换为情绪驱动。如果你的主要困扰是模型质量退化而非 token 预算，SentiRoute 就是你要的工具。

## 致谢

### 代理架构

- **[9router](https://github.com/decolua/9router.git)** —— 开创了本地上游适配器代理架构的先驱项目。9router 处理多 API 提供商之间的配额降级。SentiRoute 采用其配置驱动的模型槽位设计、请求头透传策略和上游执行模型，将路由引擎替换为情绪驱动切换。

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** —— 基于 Go 的代理，具有生产级的双向 Anthropic ↔ OpenAI 格式翻译。CLIProxyAPI 的内容块生命周期翻译的 SSE 流式状态机模式，是 SentiRoute TypeScript 流式翻译器的直接参考。事件映射逻辑（content_block_start/stop/delta → OpenAI chunks，工具调用索引追踪）借鉴了 CLIProxyAPI 的做法。

### 情绪检测

SentiRoute 的情绪检测引擎站在几十年开源 NLP 研究的肩膀上。以下项目的具体技术和词典条目被融入本项目：

- **[VADER Sentiment Analysis](https://github.com/cjhutto/vaderSentiment)** by C.J. Hutto —— 基于价态感知规则的方法是 SentiRoute 放大器系统的直接灵感来源。经验得出的强度标量（`B_INCR = 0.293`、`C_INCR = 0.733`、`N_SCALAR = -0.74`）、增强/减弱词列表、3 词窗口内的否定处理、标点强调机制全部改编自 VADER 论文（Hutto & Gilbert, ICWSM-14）。没有 VADER，SentiRoute 会把"这模型笨"和"这模型非常笨"当作同一回事。

- **[NRC Emotion Lexicon](https://github.com/DemetersSon83/NRCLex)** (Saif Mohammad, NRC Canada) —— NRC 词-情绪关联词典中的愤怒和厌恶类别启发了我们的降智关键词字典。虽然我们没有打包完整词典（仅限研究使用许可），但其将词语映射到离散情绪类别的概念框架塑造了我们的信号分类。

- **[List of Dirty, Naughty, Obscene, and Otherwise Bad Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)** (Shutterstock, 3.4k★) —— 作为参考扩充英文脏话词典，仅保留与挫败感相关的词。我们刻意排除了性和歧视类术语（与编程场景无关），只精选了表达用户对模型愤怒的词汇。

- **[google-profanity-words](https://github.com/coffee-and-fun/google-profanity-words)** —— 交叉参考补充了代码挫败语境中常见的轻度英文脏话（如 "damnit"、"crappy"、"screwed up"）。

- **[funNLP](https://github.com/fighting41love/funNLP)** (80k★) —— 这个庞大的中文 NLP 资源集合中的情感词典和中文网络俚语语料启发了我们的中文降智关键词（拉胯、摆烂、离谱、逆天、卧槽、tmd 等）和中文增强/否定词列表（非常、极其、不、没等）。

### 开发工作流

- **[GSD (Get Shit Done)](https://github.com/gsd-build/get-shit-done/)** —— 面向 AI 辅助编程的结构化软件开发工作流。SentiRoute 的整个开发生命周期——需求收集、阶段规划、架构设计、执行和验证——均通过 GSD 的阶段式工作流系统进行管理，集成了研究、规划和质量验证关卡。

## 社区支持

- [LinuxDO](https://linux.do)

## 开源协议

MIT

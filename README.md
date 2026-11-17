# 余烬之后 · Aftermath Survival

**一个以可验证世界规则、连续行动和可靠存档为核心的单人生存游戏原型。**

**A single-player survival game prototype centered on verifiable world rules, coherent actions, and dependable saves.**

本仓库是独立发布的脱敏源码快照，源自私有开发分支 `codex/g0-001`（源提交 `193e188`，2026-10-27）。它保留应用源码、自动化测试、工程配置及选取的产品规格；不会包含私有 Git 历史、内部评审与证据记录、会话材料或部署凭据。

This is a sanitized source snapshot published with a clean Git history. It contains application code, automated tests, project configuration, and selected product specifications. Private commit history, internal review/evidence records, session material, and deployment credentials are excluded.

## 项目目标 / What this project is

玩家在末日后的场景中观察、移动、检查和搜索，与 NPC 接触并管理物品。游戏规则由 TypeScript 核心逻辑裁定；界面呈现结果，不能直接改写世界状态。当前仓库重点在一栋建筑内的互动闭环和逐步完善的存档协议，不代表完整开放世界或正式发行版本。

The player observes, moves, inspects, and searches a post-disaster setting, meets NPCs, and manages items. TypeScript core rules determine outcomes; the UI presents them without direct authority to rewrite world state. The current work focuses on a building-scale interaction loop and an evolving save protocol, not a complete open world or a production release.

## 当前能力 / Current scope

- 确定性世界状态、行动与事件记录；可重复的本地规则测试。
- 建角、场景观察与移动、柜内搜索、拾取与物品转移、NPC 接触和历史记录等切片。
- 浏览器界面及本地持久化、存档导入/导出和恢复相关模块仍在开发中；具体验收边界见 [项目状态](docs/STATUS.md) 与规格文档。
- 不依赖在线大模型才能裁定核心世界规则；当前源码快照不提供托管服务或生产部署配置。

- Deterministic world state, actions, and event records, with repeatable local rule tests.
- Implemented slices include character creation, scene observation and movement, cabinet searches, item pickup and transfer, NPC contact, and history.
- Browser UI, local persistence, save import/export, and recovery are still evolving; see [project status](docs/STATUS.md) and the specifications for acceptance boundaries.
- Core world rules do not require a hosted LLM to decide outcomes. This snapshot does not provide hosted services or production deployment configuration.

## 技术与结构 / Technology and layout

- TypeScript + Vite；Zod 用于数据结构校验。
- `src/core/`：世界状态、规则、事件与可重复模拟。
- `src/application/`：会话用例、时钟、存档、迁移、导入/导出和恢复流程。
- `src/ui/`：浏览器界面与用户交互。
- `src/tests/`：核心、应用、持久化和界面相关的自动化测试及固定样本。
- `docs/`：产品原则、世界/行动约定、存档协议、架构、路线门槛与测试矩阵。

Stack: TypeScript and Vite, with Zod for data validation. The source is organized into `src/core/` (world rules and events), `src/application/` (session and save workflows), `src/ui/` (browser interface), and `src/tests/` (automated checks and fixtures). Product and engineering specifications live in `docs/`.

## 本地开发 / Local development

需要 Node.js `>=24.0.0 <25`（见 `package.json`）。

Node.js `>=24.0.0 <25` is required by the package engine declaration.

```bash
npm ci
npm run dev
```

常用检查命令：

Useful project scripts:

```bash
npm run typecheck
npm test -- --run
npm run build
```

脚本只检查本地源码，不会连接私有服务。此公开快照没有附带可部署的服务端密钥或托管环境。

These scripts operate on the local source. They do not connect to a private service; this public snapshot includes no hosted deployment credentials or environment.

## 进度与限制 / Status and limitations

项目进度按随源码公开的规格记录，最新事实日期为 **2026-10-27**：部分 G2 存档切片已验收，但**完整 G2 仍为 Partial，最新完整 Gate 为 G1**。这不是对 2026-10-27 之后进度的实时声明，也不代表这次文档更新重新运行了历史验证。详见 [docs/STATUS.md](docs/STATUS.md)。

The latest status recorded by the included project documents is **2026-10-27**: some G2 save/recovery slices are marked accepted, while **the full G2 gate remains Partial and the latest complete gate is G1**. This is not a live claim about progress after that date, and this documentation update did not rerun historical verification. See [docs/STATUS.md](docs/STATUS.md).

## 文档导航 / Documentation

| 文档 | 内容 |
|---|---|
| [产品宪章 / Product principles](docs/00_PRODUCT_CONSTITUTION.md) | 设计原则与不可妥协规则 / Design principles |
| [产品规格 / Product specification](docs/01_PRODUCT_SPEC.md) | 玩家体验目标 / Player experience |
| [行动约定 / Action contract](docs/02_ACTION_CONTRACT.md) | 输入与规则边界 / Input and rules boundary |
| [世界模型 / World model](docs/03_WORLD_MODEL.md) | 世界状态表示 / State model |
| [架构 / Architecture](docs/04_ARCHITECTURE.md) | 模块与数据流 / Modules and data flow |
| [存档协议 / Save protocol](docs/05_SAVE_PROTOCOL.md) | 保存、恢复与兼容 / Saves and recovery |
| [NPC 与世界 / NPC and world](docs/06_NPC_AND_WORLD.md) | NPC 与模拟范围 / NPC and simulation scope |
| [路线门槛 / Roadmap gates](docs/07_ROADMAP_GATES.md) | 阶段范围与验收门槛 / Milestones and gates |
| [测试矩阵 / Test matrix](docs/08_TEST_MATRIX.md) | 规则与存档验证记录 / Verification record |
| [决策记录 / Decisions](docs/09_DECISIONS.md) | 关键设计决策 / Design decisions |
| [项目状态 / Project status](docs/STATUS.md) | 带日期的状态摘要 / Dated status summary |

## 许可 / License

本仓库依 [MIT License](LICENSE) 发布。游戏素材、外部服务及其各自条款不因本许可而自动获得授权。

Released under the [MIT License](LICENSE). This license does not automatically grant rights to third-party assets or services.

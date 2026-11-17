# 04 · 分层架构与技术基线

> 当前事实入口（2026-10-27）：G2-010/011均已经理accepted，仅切片；正式v2/DB1、严格v1兼容，完整G2仍partial/G1。下方日期段落保留当时验收状态；G2-012正在汇总阶段候选，不改变契约。

## 优先技术方案（可通过 ADR 更改）

**首先交付本地优先的单机 Web 应用，移动端适配，后续可 PWA 安装/封装为 Android 应用。**

参考实现：TypeScript + Vite + React UI（或同等级轻量组件技术）+ 核心纯 TypeScript 规则层 + IndexedDB 持久层。存档导入/导出为 JSON/压缩包。具体依赖版本以 Codex 创建工程时可验证的稳定兼容版本为准，不将这里当成已安装事实。

为何先 Web：容易在手机/PC 做交互原型；代价是浏览器存储易被系统清理，因此**可导出备份在 V0.2 是硬门槛**。从一开始分离游戏引擎与 UI，避免将来 Android 或其他客户端重写规则。

## 模块边界（建议仓库目录）

```text
src/
  core/             # 不依赖 UI/LLM/浏览器；纯规则、状态、命令、随机源
    commands/
    reducers/
    simulation/
    knowledge/
    rng/
  content/          # 场景、物品、NPC 模板；内容数据而非程序运行状态
  application/      # 用例：开新局、执行命令、读档、选择按钮、结束行动
  adapters/
    ai/             # LLM provider interface + prompt guard + schema validation
    speech/         # 可选 STT；最低限度允许设备键盘语音输入
    storage/        # IndexedDB / 文件导入导出 / 备份
    clock/          # wall time -> game time 的唯一适配
  ui/               # React 等；没有直接修改 WorldState 权限
  tests/            # 核心合同/持久化/场景回归
AGENTS.md
PROJECT_STATE.json
docs/
```

## 依赖方向（禁止倒置）

```text
UI / Speech / AI -> Application Service -> Core Rules -> State Events
                                          \-> Knowledge Filter -> Presentation
Application Service -> Storage Adapter -> Snapshot + Event Journal
```

`Core Rules` **不得引用** React、DOM、网络请求、LLM SDK 或 IndexedDB。模拟器可以不启动 UI 就做确定性单元测试。

## 后端/模型策略

- **模型不是裁判。** 提供 `IntentInterpreter`、`Narrator`、`DialogueWriter`、`SuggestionGenerator` 四种可替换适配接口。
- 不把模型服务绑定到单一商家。可支持在线 provider、以后接本地模型或用户自有服务。
- 不在前端硬编码共享 API 密钥。单用户本地密钥储存需明确安全边界；如采用私有服务器代理需单独设计鉴权与费用限额。
- AI 不可用时的降级：规范化按钮 + 规则结算 + 模板描述仍可运行；自然语言理解会受限，应明示。

## 独立随机源

同一**初始存档 + 相同动作序列 + 相同 RNG 状态**，规则事件与世界状态应相同。大模型叙事措辞不必逐字相同，但不可更改事件事实。

## 安全、性能与可观察性

- 玩家输入视为不可信文本，LLM 返回的 JSON 也视为不可信；严格 schema 和权限检查。
- 禁止模型输出未审核脚本、命令或直接执行系统/浏览器 API。
- 所有动作带 commandId，避免重复点击和超时重试重复扣费/扣资源。
- 仅日志记录游戏事件与必要错误，不默认上传玩家对话或存档。
- 对旧存档升级先复制备份，迁移失败保留原件。
- 动作响应、保存耗时和模型失败率设为工程监测项；具体性能阈值由设备实测制定，不能预设为已经达到。

## G2-010 双版本与升级边界（2026-10-26，待经理验收）

旧save-format API固定v1；save-versions按已识别信封及内部标识分派严格v1/v2 codec。新公开世界使用contact工厂，旧生命周期工厂保持v1。Application仅提供当前位置问候能力、安全历史和迁移状态；完整候选、原文及归档key留在可信flow/storage。

prepareV1Migration是无写权限的纯转换。inspectMigration只读捕获双head与双原文；确认后commitMigration在同一DB1事务中精确CAS、保留migration-original前缀原文、技术记录与候选，再原子发布head。当前和上一备份原文可经安全选项下载；普通轮换不删归档。成功只代表落盘，另行load才安装会话，不能重绑auto/普通写权限。提交未知先待核实，迟到响应不得改新会话。普通跨版覆盖/导入替换拒绝；混版previous恢复明确尚未实现。旧产品e244只能导出v2原文，不能继续新关系；同版恢复保留。

## G2-011 混版恢复边界（2026-10-27，作者验收）

在已有恢复入口中，普通inspectPrevious仅返回明确cross_version_recovery_required时才调用可选inspectConvertedPrevious；用户明确确认后调用专用restoreConvertedPrevious。同版API语义保持。纯映射只读previous，不拼入current后续事实。严格新recovery-record由可信storage解析；UI仅得到版本/时间/风险提示与原件安全选择，拿不到世界或归档key。事务双head双原文CAS与双永久原件同提交；结果unknown不重试、不安装、不重绑，刷新后仍需明确load。成功/冲突/unknown立即撤过期原件选择和saved；公开双尺寸及故障证据见evidence/g2-011。

G2-011最终候选补记：1707/70 no-cache30.01s，唯一独立审查0Critical/0Important/0Minor通过；无须修复，无第二审查。产品f3f17ae，报告docs/pm/reports/G2-011-attempt-1.md，经理验收仍待，完整G2partial/G1。此前“待审查”段落为作者验收时点记录，历史证据保留。

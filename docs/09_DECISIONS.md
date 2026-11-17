# 09 · 决策记录 ADR / 开发路线变更

> `approved` 代表用户在对话中明确认可的产品方向；`proposed_baseline` 代表基于这些方向建立的工程建议，Codex 不得冒充用户已逐项批准技术实现。

## ADR-001 — 文字沉浸感优先
- 状态：**approved（产品方向）**
- 决定：保留小说化描述及脑补空间，图形化重点用于快捷操作/状态，不强制绘制完整游戏世界。
- 理由：用户明确表示原版叙事沉浸感好，主要痛点是打字麻烦与不能存档。
- 禁止：将核心模式悄然替换成 2.5D/3D 动作游戏或固定选项小说。

## ADR-002 — 自由输入 + 智能动态按钮
- 状态：**approved（体验方向）**
- 决定：按钮只作为快捷建议；语音/文本永远可以表达菜单之外的行动；命令进入规则引擎判定。
- 代价：开放语义动作覆盖需要持续扩充，并非无限能力。

## ADR-003 — 退出后世界暂停
- 状态：**proposed_baseline（具体默认规则需用户如有异议再调整）**
- 背景：原文要求“离开游戏仍不停”，但用户提出长期存档与手机游玩需求。
- 决定：默认暂停世界时钟；可选离线补算，未来独立开发。
- 理由：无服务器时不可能真正持续模拟，避免玩家隔几天回来人物已因离线时间死亡。
- 影响：改变原版设定的一条字面规则，必须在设置中说明。

## ADR-004 — 规则层与叙事层解耦
- 状态：**proposed_baseline（技术原则）**
- 决定：AI 只解析意图/拟建议/描写，不可直接变更游戏真状态；规则层和存档层为唯一真实来源。
- 理由：避免 NPC 复活、资源复制、长期遗忘。

## ADR-005 — Web/PWA 原型优先
- 状态：**proposed_baseline（技术选择）**
- 决定：先做 TypeScript Web 版、移动端布局、可安装 PWA 后续验证；AI 接口可换供应商，未来可迁移 Android。
- 反方：原生安卓本地存储与语音更直接；但首版界面开发与分发迭代成本相对更高，原生端可后置。
- 用户可改：在 G0 开发前选原生移动端；必须保持 Core 纯逻辑、存档协议不变。

## ADR-006 — 先存档后扩世界
- 状态：**approved（产品痛点优先）/ proposed_baseline（具体版本拆分）**
- 决定：V0.1 验证场景交互，V0.2 交付全世界存档；V0.2 才称首个可长期游玩的版本。
- 代价：V0.1 阶段仍没有完整存档，不能向玩家宣称已解决该缺点。

## ADR-007 — 已批准的 G0-001 工程基线与内部模型
- 状态：**approved（G0-001 范围）；G0-002 已补齐 Windows/Linux 托管 CI，G0 门禁通过**。
- 用户批准依据：2026-10-23，用户在核查报告列明文件、测试和实施范围后回复“批准”。授权仅覆盖 G0-001，不包含后续大阶段。
- 后续交付授权：2026-10-23，用户回复“继续下一步”，并选择新建私有仓库 Cappuccinor/aftermath-survival，明确授权创建和推送；完成 G0-002 的 CI 验证与交接，不扩展到 G1。
- 触发问题：仓库仅有 16 份蓝图文件，无 Git、源码、测试或存档；必须先形成可验证基础。
- 决定：TypeScript + Vite 工程入口、Vitest 测试、Zod 严格运行时 schema；Node 24，精确锁定依赖。UI 暂为工程说明页，不引入 React 或游戏操作。
- 备选与理由：纯类型定义不能拒绝外部非法状态；手写完整验证容易遗漏字段。使用 Zod 的纯校验能力，代价是增加一个运行时依赖。仅 TS CLI 工程更小，但不能验证批准范围内的 Web 构建入口。
- 内部状态：`stateSchema=g0-world-v1`；`campaign.schemaVersion=null`。不修改 docs/05 的正式存档轮廓，也不提供导入/导出。后期集合强制为空，拒绝不支持的数据，避免默默丢失世界事实。
- 时间：`gameClockMinutes=0` 表示生存第 1 天 08:00、灾变第 30 天；跨午夜推进日计数。两个日期由同一整数派生。创建 UTC 时间和 ID 必须由调用方显式提供。
- RNG：实现细节采用 `xorshift32-v1`，seed 为 1..4294967295 整数，0 明确拒绝。接口可注入未来规则用例；初始化只记录状态，不生成随机内容。恢复不多消耗一次随机数。非密码学用途。
- 权限：解析 WorldState 仅供 Core/未来可信导入流程校验，不是 UI 或 AI 的状态修改 API；UI/AI 只依赖玩家可见 DTO。保存适配器只持久化规则结果，不拥有规则裁决权。
- 既有 ADR 口径：ADR-003/004 的旧 proposed_baseline 标签保留为历史记录；本次实施严格遵循 AGENTS 和宪章中的默认暂停与 AI 禁写约束，不视为可绕过的建议。ADR-005 的 TypeScript/Web 工程部分获本次批准，PWA/Android 和离线补算仍未实施。
- 影响：根工程、Core 与适配器接口、测试、CI 配置、README、测试矩阵及交接；不改变玩家体验或正式存档协议。初始属性数值只服务测试，不代表平衡结论。
- 迁移：没有已有游戏代码或存档需迁移。此内部模型不是持久化格式；首次正式存档必须另行冻结版本并建立样本与兼容测试。
- 回滚：保留原文档提交 `eb0e99f` 与标签 `g0-blueprint-baseline`；工程变更独立提交，可 revert，不需要清除任何玩家数据。
- 新增测试：见 docs/08 的 G0-STATE/RNG/INVARIANT/COMMAND/EVENT/PORT/BOUNDARY/BUILD/CI。
- 未授权内容：真实模型/密钥、IndexedDB 实现、NPC/战斗/基地/车辆/阵营/扩展地图和 G1。

## ADR-008 — 项目经理验收与按蓝图自动推进
- 状态：**approved（协作方式及 G1 至 G7 的条件式阶段授权）**；并非任何阶段已验收。
- 用户批准依据：2026-10-23，经理聊天 `01a168e7-4159-7803-911a-f95634a0c6f8` 的原始用户请求要求经理与实施者汇报/派单自主循环；用户随后明确选择“授权按蓝图逐阶段推进到 G7；每个 Gate 全部通过后自动继续”。
- 理由：减少每个小任务后人工转述和续发指令，同时保留蓝图、证据和门禁。
- 决定：沿用现有两个聊天，实施者每任务提交持久报告，经理验收后只派下一个最小切片；5 分钟聊天内巡检补漏。普通切片在授权阶段内自主执行，不重复索要批准。按 G0→G7 顺序，仅前一 Gate 全部通过才进入下一阶段，满足 docs/07 第 6 条的显式授权条件。
- 备选：人工每次转发最简单但不能满足自主循环；新建常驻调度程序引入额外维护和并发写入风险，当前采用内置回访及仓库记录。
- 影响：新增 docs/12_PM_WORKFLOW.md、docs/pm 的任务/汇报/验收记录、项目管理状态字段与本聊天自动化。不改产品宪章、路线范围、游戏数据模型或正式存档协议。
- 边界：授权不涵盖修改玩法底线、破坏性重构/迁移、蓝图外功能或新增外部权限。若蓝图验收自身冲突，先记录准确阻塞，不自行降低门槛。无模型时按既有蓝图降级；需要真实模型和凭据时遵守相应授权流程。
- 迁移：现有 G0 提交、标签及证据不变；当前仍为 G0 / done，G1 已授权待实施，不能预记完成。
- 回滚：停止本项目自动化，保留实现与报告；必要时 revert 本管理记录提交。无需游戏数据迁移，不删除其他项目的自动化。
- 验证：管理 JSON 解析/引用一致性、Git 差异、自动化创建和回读、实施者实际接单；完整首轮汇报→验收→再派单需实际发生后另记。
- 变更实施状态：管理机制建立中，首次任务 G1-001；实际发送/运行状态以 docs/pm/LOOP_STATE.json 与工具回执为准。

## ADR-009 — G1-001 观察回执与原子提交
- 状态：**adopted_under_delegated_scope（实施者作出的非破坏性细节裁定；经理已验收 G1-001，G1 整体仍 partial）**。2026-10-23 验收及限制见 docs/pm/reviews/G1-001-attempt-1.md。
- 批准范围：ADR-008 的用户条件式阶段授权及 G1-001-attempt-1 正式任务单，委托实施者冻结普通实现细节；不声称用户逐项选择了阈值和事件字段。
- 决定：只执行当前玩家原地 observe，耗时 1 分钟；light>=0.5 可辨明暗，无随机判定，不消耗 RNG。其他语义参数如实拒绝；开放命令信封保留，不变成固定选择菜单。
- 因果与去重：TimeAdvanced + ObservationRecorded 两事件使用 observe-v1 payload；后者记录规范化请求、提交 revision、时间和光照判定。相同请求回原回执；不同请求复用 ID 拒绝。source/utterance 不改变已规范化命令事实，原始文字不写日志。
- 原子性：完整候选连同事件与知识验证后只替换一次 Core 实例的不可变状态；用真实上界溢出和事件冲突验证失败保留旧快照，不提供测试专用提交开关。这里只保证内存提交，不是断电持久事务。
- 可见边界：本次只公开光照事实和模板结果，既有名称、物品、metadata 与其他知识不进 DTO；物品识别及门缝/暴露判定仍待后续 G1 切片。Application 只交出 GameClient.dispatch；可信引擎快照访问器不交 UI/AI。
- 备选：临时 Map 回执易丢失；新增顶层 receipt 集合需演进 schema；采用已有事件日志承载回执，代价是目前线性解析和全量候选校验。当前不宣称性能达标，正式长时运行前需评估日志增长。
- 兼容：g0-world-v1 顶层字段和正式 schemaVersion=null 不变，旧 G0 无观察日志的内部夹具继续通过。新增 observe-v1 事件语义校验；本引擎的 TimeAdvanced/ObservationRecorded 名称当前专属此原语，未来其他耗时原语需扩展规则分派校验，不能绕过回执一致性。无正式存档迁移或导入接口。
- 审查修复：observe-v1 范围内没有改变光照的动作，重建时同时验证回执判定与地点光照一致，拒绝 dark/clear 篡改，避免错误回执进入叙事。未来引入光照变化必须先演进历史判定证据/规则校验，不能沿用最新光照验证历史；本次未扩展为日志认证或通用回放。
- 影响：新增 Core 引擎/观察模块、Application 客户端与 38 项验收；沿用既有依赖/配置，不改 UI、宪章或正式存档协议。
- 回滚：以经理设置提交 91e6546 为接收基线，revert G1-001 实现与交接提交；保留经理的 LOOP_STATE 与派单记录，不删除玩家数据或旧 Git 历史。
- 证据：docs/08 H、实施计划及 docs/pm/reports/G1-001-attempt-1.md；后续经理已验收 G1-001，见对应 review。G1 整体 partial。

## ADR-010 — G1-002 受限会话与自由输入原型
- 状态：**adopted_under_delegated_scope**，ADR-008 用户委托与 G1-002-attempt-1 任务范围内的非破坏性细节；独立审查通过，经理于 2026-10-23 在 9c5e7d0 独立验收本切片（见对应 review），不声称用户逐项选择实现。
- 触发：现有 Core 可观察但 UI 只有工程说明。必须接入真实结算且保留自由输入，不能让 UI 取得真状态/存档能力或自行加时。
- 决定：根 bootstrap 创建固定、显式标注的原型世界，再注入 ObservationSession。UI 只导入 ports，原 Core/UI/AI 隔离测试保留并扩到所有 UI/AI 模块；不使用全局引擎/调试钩子。
- DTO：ActionReply 非破坏性增加 VisibleClock={worldRevision,gameClockMinutes,label}，由权威快照与 getWorldTime 投影。committedRevision 仍是原动作版本；会话只接受不倒退的 clock，独立记录最高已呈现 revision。叙事保留最近三条，不以 UI 条数判断去重。
- 解释：现有 IntentInterpreter 的本地实现使用完整短句词表和严格单动作提案。允许自由输入任意内容，但当前只理解少量原地观察表达；否定/准备/链式/未知等拒绝且保留草稿。按钮与合法文本统一进入既有网关。
- 恢复：单请求锁；默认每个等待阶段 5000ms，无自动重试。网关超时/异常可能已提交，保留原 commandId/revision，只允许用户重试确认，不能另生成 ID 双结算。解析失败可改写重试，成功只清除没有被继续编辑的旧草稿。物理双击第二下与按键 repeat 不触发新动作。
- 备选：关键词抽取易执行否定/尾部动作，拒绝；真实模型需外部权限且超出任务，延期；新 UI 框架增加当前单视图成本，选择原生 DOM；仅禁用 pending 无法防本地快速双击，真实浏览器 RED 证明需要额外原生事件保护。
- 影响：新增 bootstrap/session/clock/local adapter/DOM 页面与测试；无依赖变更。自由行动与沉浸文本方向保留，不伪装建角或完整居民楼。
- 迁移：g0-world-v1、observe-v1、正式存档 null 均不变；无正式旧档需迁移。会话只适配新建观察夹具，一个世界一个会话；正式恢复/并行客户端以后需新的会话恢复契约。
- 风险：词表有限；未确认结果需先重试；5 秒预算只验证本地与替身，不代表真实 provider；长局性能/手机软键盘/语音未验收；保存仍 unavailable。
- 回滚：revert G1-002 实现/交接提交恢复 9b7e348 的工程与无界面观察能力，保留经理 LOOP_STATE、先前报告、存档占位及稳定标签。
- 证据：docs/08 I、docs/evidence/g1-002、实施计划及任务报告。G1 仍 partial；不自动启动下一切片。

## ADR-011 — G1-003 已知静态物品检查
- 状态：**adopted_under_delegated_scope / manager_accepted**。ADR-008 及 G1-003-attempt-1 委托的普通细节；228 项及生产浏览器通过，一次独立审查无待修复问题，经理于 2026-10-23 在 5095aed 独立验收（见对应 review）；G1 仍 partial。
- 触发：第二原语需要明确感知依据及混合回执验证，不能把整个 items 表交给 UI，也不能将所有 TimeAdvanced 当作观察。
- 决定：只检查 empty-tin。已知依据为 seen-item-<id> 知识及 ItemInitiallyPerceived / initial-sight-v1 初始化事件；direct location=玩家当前位置、light>=0.5、有效知识、玩家存活才可建议/检查。初始感知是可信原型初始化，不是 observe-v1 的新发现语义。容器内、背包内、远处、未知、不支持目标均同一拒绝，不回显细节。
- 命令与因果：inspect 恰好一个 target、空工具/参数；1 分钟，无 RNG、物资或属性变化。TimeAdvanced + InspectionRecorded 使用 inspect-v1；原 observe-v1 原样接受。统一扫描按版本分派、跨动作 commandId 去重、严格配对及最新知识校验，完整候选成功才替换状态。
- 可见白名单：{targetId,label}，标签由类型映射为空罐；仅 open-metal-tin-v1 外观“罐身呈金属质感，罐口敞开。”。原始 typeId/metadata/condition/耐久等不输出。解释器依赖可见目标完整匹配检查/查看/仔细检查+标签；重名、否定、条件、准备、链式等拒绝。自由输入与观察永久保留。
- 备选：直接用世界物品表生成按钮会泄密，拒绝；仅字符串 knownFactIds 不足以表明感知证据，采用版本化初始化事件；通用动作插件/发现系统超出本切片，延期。代价是当前只支持单种静态物品和一种知识来源，历史验证继续依赖静态光照/位置/类型；以后动态规则必须演进证据，不能跳过校验。
- 兼容：不新增顶层结构，不重释既有字段；g0-world-v1 / 正式 schemaVersion=null 不变。新增事件类型和知识语义；旧 G0 空日志、旧 G1 observe-v1 快照保持可用。旧程序不能读取新增动作历史；通过 revert 恢复源码，不承诺向旧程序降级新快照。无正式保存/导入/磁盘恢复能力。
- 影响：Core 检查/事件校验、可信原型初始化、最小投影、应用会话/解析/UI、测试与浏览器证据；沿用依赖。数值仅原型基线，不是平衡结论。
- 回滚：revert 本任务实现/交接提交，恢复 f28f619 基线，保留经理 LOOP_STATE 与历史报告。原型刷新后重建，无玩家磁盘存档需迁移。
- 验收入口：docs/pm/tasks/G1-003.md、docs/superpowers/plans/2026-10-23-g1-003.md；实际结果见 docs/08 J 和 docs/pm/reports/G1-003-attempt-1.md。旧观察 expiry 行为已用回归保持，新增检查约束不强加给旧动作。G1 仍 partial。

## 后续 ADR 变更模板

```text
ID:
标题:
状态: proposed / approved / rejected / superseded
触发问题:
现有决定:
替代方案及最强反对理由:
新决定:
影响文件/模块/存档版本:
迁移与回滚方案:
新增测试:
用户批准依据:
变更实施状态:
```

## ADR-012 — G1-004 静态双向路线与历史位置
- 状态：manager_accepted_under_delegated_scope；ADR-008 和 G1-004 委托的普通细节。2026-10-24 经理固定647eff1独立通过279项、类型/构建、双尺寸生产浏览器与来源核验，接受本切片；G1仍partial。
- 决定：KnownRouteInitialized/known-route-v1 可信初始化载荷包含 roomId、corridorId；固定受控标签房间/走廊，knowledge 与 knownFactIds 同时支持，双向邻接校验，不披露任意世界名称。move-v1 request.locationId 为源、destinationId 为目标；TimeAdvanced + PlayerMoved 两事件与 movement-<actor>-location 知识原子提交，每次1分钟。
- 历史：第一回执源为游标，存在初始化路线则起点必须为 roomId；逐动作位置匹配、move 更新游标、最终等于玩家位置。历史 inspect 用显式历史位置校验。无移动的旧观察允许既有时间/revision间隙，不重释 expiry。旧回执目标规范化在当前可行性之前；空 observe 等于历史地点，显式目标须匹配历史地点。
- DTO：currentLocation 可空与 routes 仅受控 targetId/label；新 createMovementPrototype 保留旧 createInspectionPrototype。会话按最新权威 clock 接受投影，旧回执不回退。
- 备选：通用回放过重；删除历史感知校验不安全。采用静态历史位置游标；动态光照/物品未来须演进证据。
- 兼容：g0-world-v1、正式 schemaVersion=null 不变。旧程序不能读取 move-v1 新日志；固定旧引擎生成快照验证向前兼容，无正式存档迁移。
- 回滚：revert 本任务提交至 fb239862b7f52512a50ac0e573cc0f33dbb76ce7，保留经理记录与历史；无磁盘存档变更。

## ADR-013 — G1-005 搜索范围与首次发现
- 状态：manager_accepted_under_delegated_scope；ADR-008 / G1-005授权内细节。2026-10-24经理在d43e392验收：功能/生产证据在da8010d已独立通过，attempt2日志收尾及完整范围复核通过；详见docs/pm/reviews/G1-005-attempt-2.md。G1仍partial，不代表用户逐项指定实现。
- 决定：新增 SearchScopeInitialized/search-scope-v1，固定 evt-initial-search，载荷 {rule,locationId,itemId}，初始化时间0、private、玩家actor、目标[locationId]；仅可信预置直接地面 empty-tin，依赖 known-route-v1 的房间。无客户端授权物品参数。新 createSearchPrototype 保留旧函数原义，移除空罐初始感知。
- search-v1 严格回执 {rule,commandId,request:{actorId,locationId,expectedWorldRevision},elapsedMinutes:1,committedRevision,observedAt,discoveredItemId:string|null}。TimeAdvanced + SearchRecorded；首次发现追加 ItemDiscovered，载荷 {rule:'search-discovery-v1',commandId,itemId,locationId,observedAt}，ID evt-<commandId>-discovery。seen-item 首次知识指向发现事件且永不覆写；search-<location>-result 独立最近搜索知识。
- 历史扫描按日志顺序维护已发现集合；inspect 仅允许已在当前动作之前的发现事件（seq 上界），不以未来/同时间后置事件证明过去。发现结果按当时知识推导；严格匹配事件、知识和搜索范围，拒绝孤立发现。新范围 searched 必须等于是否存在搜索回执；旧无范围/无搜索历史的 searched 不重释。基线 initial-sight 可用于已感知物品，来源仍须验证。
- 失败全部保留原状态和命令ID；搜索1分钟、不抽RNG、不转移/生成/消耗物品、不改属性。暗处/远处/未知/死亡及参数违规拒绝。UI只公开房间 targetId/label，发现前无空罐叙事；会话统一最新投影、同ID恢复。
- 备选：仅 searched 无法证明发现；搜索时造物破坏守恒；通用容器/发现框架越界。静态物品/光照历史与线性扫描的限制保留。
- 协议：内部 g0-world-v1，正式 schemaVersion=null；新增版本化事件，旧程序不支持新日志，旧样本向前兼容。非磁盘存档。回滚 revert 本任务提交到32c3500，保留经理文件；新内存原型刷新重建，无正式存档迁移。

## ADR-014 — G1-006 基础资料与一次性创建
- 状态：manager_accepted_under_delegated_scope；ADR-008/G1-006委托内普通细节，经理于20e6a01独立通过409项、构建和双尺寸建角/原动作路径；见docs/pm/reviews/G1-006-attempt-1.md。G1仍partial。
- 选择：14类资料使用独立profile对象；姓名trim后1–40 Unicode代码点，年龄1–120整数，其余12字段各0–240代码点，内部换行原样。显式perception/stealth/survival各0–30且总和≤60，默认20。背景文字无数值/地图/物品/NPC副作用。
- 唯一权威资料为eventJournal中的CharacterCreated/character-created-v1，固定evt-character-created，seq1、时间0、private、actor及唯一target为玩家。payload严格含rule、initialRule=character-start-v1、profile、skills、initialStats、startLocationId=prototype-location。只读资料投影只返回profile/初始skills。
- 新记录在parseWorldState验证唯一性、保留ID/类型/规则、身份/顺序/时间、严格版本/字段/规范化姓名及初始数值。当前四原语不改属性/技能，因此记录与当前player.stats/skills一致、background保持空；新建世界从0开始的TimeAdvanced必须连续，每次1分钟/revision，当前时钟与版本等于已记录动作数；未来属性/成长机制须显式演进验证规则，不能删除历史事实。旧无记录世界继续按旧语义接受；内部JSON无签名，不能宣称抵抗整体伪造/删除记录的篡改。
- createNewGame接收已验证资料及可信seed/saveId/playerId/createdAt，复用搜索原型场景并重绑定玩家身份/知识/事件，创建记录在初始化证据之前，clock/revision0，不自动行动。原三种原型函数不变。
- 应用同步editing/preview/starting/started/error状态，预览不创建世界；编辑使预览失效，取消保草稿。开始仅从有效预览创建完整世界和行动会话，工厂成功返回后安装；失败不留活动世界。锁在工厂调用前设置以阻止同步重入，成功结果缓存，旧原型入口共锁。不引入异步/超时/后台任务。
- UI用纯文本和可折叠自有资料，确认前明确固定起点/初始属性/技能及背景尚不模拟；无maxlength静默按UTF16截断。原直接入口保留，进入后无覆盖当前世界的重建入口，刷新丢失进度继续明示。
- 备选：仅DOM或拼接background丢结构与恢复依据，拒绝；新增顶层profile会改既有严格schema，现阶段不采用；自由背景自动生成资源越过规则且超范围，延期。
- 协议：g0-world-v1顶层与正式schemaVersion=null不变；新增内部创建记录，新程序读旧快照，旧程序不了解新记录语义，不承诺降级兼容。无磁盘保存/迁移/崩溃恢复声明。
- 风险：身份背景当前只记录，技能是原型预算未平衡；资料长度按代码点而非字素簇；静态初始化与线性日志校验延续；资料本身不应进入外部模型或遥测。
- 回滚：revert本任务实现/证据/交接提交恢复1f6d675，不覆盖经理文件或旧样本、不强推。数据协议未来演进必须另行记录兼容策略。验收见docs/pm/tasks/G1-006.md及docs/superpowers/plans/2026-10-24-g1-006.md。

## ADR-015 — G1-007 自身状态只读投影
- 状态：manager_accepted_under_delegated_scope；ADR-008/G1-007委托内普通细节，经理于4162a3a独立通过458项、构建和双尺寸三模式；见docs/pm/reviews/G1-007-attempt-1.md。G1仍partial，不代表用户逐项设计选择。
- 选择：应用新增VisiblePlayerStatus十字段白名单，前八0–100、温度有限°C、负重有限非负kg；copyPlayerStatus只接受自有number数据属性、复制冻结，缺失/非法/访问器返回null，额外字段不复制。projectPlayerStatus只取已验证世界player.stats，异常不造默认值。
- 初值来自bootstrap的同一个world；成功ActionReply来自Core结果当前state，重试也不从旧receipt/建角预览取值。旧成功回复可不含playerStatus、旧SessionOptions可无initialPlayerStatus；View始终为合法DTO或null。
- 会话状态与clock/routes等共用原currentProjection门槛（revision和分钟均不倒退）；当前缺失/非法投影清成null，旧回复保持当前值，失败/pending/超时保留最后确认状态和原提示。无独立数值优劣比较，无状态写入。
- UI稳定details/summary默认折叠，摘要生命/体力/精神；展开八项原值meter与方向说明，体温/负重显示实际单位。缺失显示“状态暂不可用”，不补零/满血；注明当前未模拟消耗/生存变化，不加医学阈值/容量/概率。无整表live region，展开/草稿/焦点不随render重建。
- 备选：使用建角常量不能服务旧入口/未来当前值，拒绝；UI读WorldState破坏权限，拒绝；借面板新增扣血/生存消耗超范围，延期。
- 兼容：仅可选应用DTO扩展，Core、g0-world-v1、character-created-v1、动作历史、正式schemaVersion=null和旧快照均不变；当前公开自身数值是原型事实，潜伏感染/未知伤病将来另定感知规则。
- 回滚：按依赖倒序revert本任务实现/证据/交接到aedd4fc，保留经理文件/旧样本，不强推或清理scratch。风险为未来状态感知演进、仅桌面Chrome视口验证及无正式存档，不能把此切片当完整G1。

## ADR-016 — G1-008 门缝双判定与静态观察者
- 状态：adopted_under_delegated_scope / manager_accepted at d3681ad（2026-10-24）；独立579项、重建dist四模式及哈希检查通过。579测试、四模式双尺寸生产路径通过；一次独立审查无Critical/Important/Minor。ADR-008及正式G1-008派单授权的内部模型扩展；数值为经理指定原型规则，不代表现实平衡，不是G4 NPC自治，也不改产品宪章或正式存档协议。
- 旧createWorldState/Inspection/Movement/SearchPrototype及createNewGame默认语义不变。新增addDoorGap(world)仅接受无NPC/无scope且clock/revision0、未执行动作的既有房间/走廊世界；createDoorPrototype(seed=1)与createDoorGame(input,metadata)组合供生产两入口。原型技能缺失perception/stealth按0；建角仍各默认20及既有预算。
- 唯一scope事件evt-initial-door-gap，type DoorGapInitialized，private、actor玩家、time0，targets依次[doorId,roomId,corridorId,npcId]，位于所有TimeAdvanced之前。严格payload：rule=door-gap-scope-v1、doorId、roomId、corridorId、npcId、gapOpen:boolean、initialAlertness:0..100整数(default30)、initialRng:xorshift32-v1快照、perception/stealth:0..100、corridorLight:0..1。初始RNG须等于campaign.seed构造的初态；技能/光照为冻结静态判定依据，须等于当前世界值，未来变动必须版本演进。
- doorId默认prototype-door-gap，npcId默认prototype-witness，均与玩家/地点/物品/彼此不碰撞；门连接真实相邻room/corridor。公开已知门缝knowledge为known-door-<doorId>、玩家持有、source scope事件、confidence1/time0/无expiry。它只授权目标，不公开NPC真相。scope需与既有合法known-route连接一致；关闭或光照不足可作为合法但不可观察场景。
- world.npcs数组仅新增严格单一类型{kind:g1-door-witness-v1,npcId,locationId,appearance:worn-shoes-v1,alertness整数0..100,firstNoticed:null|{playerId,locationId,observedAt,sourceEventId}}。无scope必须空；有scope必须恰好匹配唯一真实走廊观察者。初始firstNoticed=null；后续首次注意严格由相应事件支持，NPC不移动、攻击、对话或创建关系。其他后期集合仍为空。
- 规范命令observe、targetIds=[doorId]、toolIds=[]、arguments精确{through:door_gap,careful:true}，其余空参数observe保持旧意。前置验证房间/已知scope/门可用/走廊light>=0.2、活着、actor、revision；拒绝不抽RNG。重试先按原规范请求/旧回执匹配，不按当前地点重释；改变规则/参数/目标/revision不能复用ID。
- 每次合法动作从当前rngState恢复局部候选，依次v和e两次nextFloat。pSee=clamp(0.1,0.9,0.30+perception/200+(corridorLight-0.5)*0.4)，pNotice=clamp(0.1,0.9,0.40+(beforeAlertness-stealth)/200)。v>=pSee:none，v<pSee/2:shoes，否则shadow；e<pNotice:noticed。两维无条件分别计算，原四动作不抽样。耗时1/revision+1，位置/角色/物品不变。
- door-observe-v1严格回执含commandId、request{actorId,locationId,doorId,expectedWorldRevision}、elapsedMinutes=1、committedRevision、observedAt、visual:none|shadow|shoes、noticed:boolean、beforeAlertness/afterAlertness、visualRoll/noticeRoll、rngBefore/rngAfter。阈值不作为客户端字段；历史重演验证两次样本精确值、视觉/注意各自结果及前后RNG/警觉。
- 事件顺序：TimeAdvanced(evt-<cmd>-time) → DoorObservationRecorded(evt-<cmd>-door，payload为回执)，均private/actor玩家/target门缝；noticed时再有NPCAlertnessChanged(evt-<cmd>-door-notice,target NPC,payload{rule:door-notice-v1,commandId,npcId,playerId,locationId,observedAt,fromAlertness,toAlertness}) → DoorReactionHeard(evt-<cmd>-door-sound,target门缝,payload{rule:door-reaction-v1,commandId,doorId,npcId,observedAt,cue:cloth-rustle-v1})。附加事件同一动作时间/private/actor玩家；NPC反应因果由payload npcId记录，并非自治调度。
- noticed后警觉min(100,old+10)，首次记忆在null时取注意事件/玩家/房间/时间，后续不抹除。每次观察保留独立知识door-observation-<cmd>，source结果事件；heard时独立door-heard-<cmd>，source声音事件；confidence1/observedAt匹配/无expiry。none也记录一次未辨清观察，不声称新人物线索；不删除历史视觉/听觉。新域额外/孤立/篡改知识或事件拒绝。
- 原子性：候选完整世界、时间/日志/知识/NPC/RNG经world新域校验及原readActionReceipts全部历史校验后才替换权威引用。任何抽样后失败不改变原快照，也不占用ID。scope从初始RNG/警觉逐条验证，当前NPC/首次记忆/最终RNG须与重演一致；新scope世界clock/revision从0按所有TimeAdvanced连续递增，原无scope世界保留旧规则。旧位置/发现/创建校验不删除。
- 代码边界：door-model纯schema与显式DoorWorld结构类型，door-observation纯scope/概率/候选/目标，door-history纯新域重演，door-prototype可信组合；不运行时导入world形成循环。world仅引入类型schema/验证，receipts加入新分支和事件顺序，旧动作不改含义。
- 应用只输出none未辨清/shadow模糊影子/shoes旧鞋影；heard时追加衣料轻响。不能输出NPC身份/警觉/注意布尔/概率/随机/安全或已暴露结论。doorTargets仅门ID/固定门缝标签；session当前投影门槛及同ID重试沿用。解释器三完整短句提议observe_door_gap，由session转规范observe，非新增Core原语；自由输入保留，准备/复合拒绝。
- 兼容：内部g0-world-v1保留，新增版本化NPC/scope/事件为受控扩展，旧空世界与固定样本向前兼容；旧程序不能读取新NPC历史，不承诺降级。正式schemaVersion=null，JSON恢复不是磁盘保存。未来NPC移动/死亡/技能/光照变化或多耗时需显式迁移历史依据；不具备签名防伪能力。
- 备选：仅文案暴露无真实因果，拒绝；同一次随机推导两结果不独立，拒绝；全套NPC自治超G1切片，延期。风险：静态场景与全日志校验、真实设备/存档未验证；G1仍partial。
- 回滚：逆序revert本轮实现/证据/交接恢复d0c1116，保留经理文件/旧样本，先评估后续依赖，不reset/强推/清理scratch。

## ADR-017 — G1-009 单空罐转移与历史所有权
- 状态：adopted_under_delegated_scope / manager_accepted at 3b7b352（2026-10-24），经理独立683项、重建dist五模式及来源核对通过，见docs/pm/reviews/G1-009-attempt-1.md。683测试及五模式双尺寸通过；一次独立审查无Critical/Important、一项维护性Minor延期。ADR-008与G1-009派单授权；仅一个0.05kg空罐，非完整背包/容量/资源消耗系统。
- 新createPickupPrototype(seed=1)/createPickupGame(input,metadata)组合旧door factory，addPickupScope只允许合法未行动世界、玩家在房间/负重0/空罐未发现且直接地面、count1/weight0.05、现有door/search初始化匹配。旧默认factory及样本不变，无scope不开放pick_up。
- 初始事件evt-initial-pickup，type PickupScopeInitialized，private/actor玩家/time0/targets[itemId]，在search与door初始化之后、所有动作之前。严格payload为{rule:pickup-scope-v1,playerId,locationId,searchSourceEventId:'evt-initial-search',initialCarryWeightKg:0,initialItem:完整既有itemSchema快照}。initialItem只作不可变历史证据，items仍是唯一当前库存；类型empty-tin/count1/weight0.05/初始location与room一致。世界不允许其他player持有物品绕过本记录增重。
- pick_up命令精确一个目标、空参数/工具；当前活玩家、相符revision、合法感知来源且直接当前地面/光照>=0.5、scope授权这个空罐。未知/隐藏/容器/远处/已持有统一invalid_target，不耗时间/RNG。成功固定1分钟/revision1，不改其他玩家属性、技能、位置、物品内容或NPC/RNG。
- 原子事件布局TimeAdvanced(evt-<cmd>-time)→ItemPickedUp(evt-<cmd>-pickup)，private/actor玩家/target物品/同时间。严格pick_up-v1回执为{rule,commandId,request:{actorId,locationId,itemId,expectedWorldRevision},elapsedMinutes:1,committedRevision,observedAt,from:{kind:location,id},to:{kind:player,id},count:1,weightKg:0.05,beforeCarryWeightKg:0,afterCarryWeightKg:0.05,perceptionSourceEventId}。所有数值必须符合真实初始化item.count*weightKg与原始感知来源，首次拾取唯一；不覆盖原首次发现知识。
- 新知识factId=pickup-<itemId>，source对应ItemPickedUp，knower玩家/confidence1/observedAt为动作时间/无expiresAt，玩家knownFactIds包含；孤立/额外新域知识、未知pickup规则或重复转移拒绝。
- pickup-history从scope和完整唯一转移推导当前位置/负重；itemPositionAt用事件序号严格前缀计算旧动作位置。scope初始物品其他字段与当前逐字段/JSON内容一致；当前position只能是事件证明的初始位置或玩家，carryWeight只能是0或事件证明的0.05。转移必须在合法ItemDiscovered/原search receipt之后，来源/时间/序号/已知事实和历史玩家地点匹配；拾取前光照>=0.5。TimeAdvanced连续且最终时钟/revision匹配。半位置/半负重/缺事件或知识不被接受。
- 抽出既有item/position schema到item-model、search/scope/discovery schema到search-model仅为共享定义，无字段/语义放宽。pickup-model与history不运行时导入world/inspection/search，避免循环。searchScope按验证过的初始位置核验；inspection按beforeSeq历史位置核验；character仅carryWeight可取完整pickup历史证明值，其他初始属性校验保留。旧receipt结构不改，旧无scope路径原样。
- engine在候选完成后parseWorldState+readActionReceipts通过才替换引用；同ID先匹配原请求再返回旧结果和当前投影，跨地点允许原请求重试，失败ID不占用。拾取后search不再发现该随身物品，地面inspect/拾取建议消失；旧发现/检查/门缝记忆继续保留。
- 公开pickupTargets仅{targetId,label:'空罐'}；inventory仅{itemId,label:'空罐',count:1,weightKg:0.05}（条目总重），从当前items/player持有且有完整来源派生。新合法初态[]，无scope或当前缺失/非法投影null；不投射metadata/隐藏物品/事件/NPC。应用复制冻结、同版本更新，陈旧/失败/待确认保留上次值。自由文本拾取空罐/捡起空罐/拿起空罐与按钮同命令，不自动搜索或复合执行。
- UI稳定按钮和details随身列表；按钮隐藏若持有焦点则转自由输入，保持布局空间防二次点击落到别的动作。状态提示只说明尚无生存消耗、拾取改变负重。null明确不可用，不补造空背包。
- 备选：只改文案不能证明所有权，拒绝；删除静态校验允许任意篡改，拒绝；完整通用背包/容量/多物品转移超范围，延期。
- 兼容/风险：内部g0-world-v1受控扩展，旧世界可向前读取并执行原动作，新事件旧程序不承诺降级；正式schemaVersion=null未改，内存故障/JSON重建不等于SAVE-01/03或断电恢复。未来多物品/多次转移/丢弃/动态光照/属性须另行迁移历史；未承诺长局性能或真实设备。
- 回滚：按依赖倒序revert本轮实现/证据/交接恢复275b94b，保留经理记录/旧样本，评估后续依赖，不reset/强推/清理scratch/覆盖存档。

## ADR-018 · 有来源的居民楼身份和只读场景上下文（2026-10-24）

- 状态：按用户ADR-008及经理G1-010-attempt-1授权实施，现candidate_complete待经理验收；方案由经理选择，字段/文案为实施者细节决定。接收base511c8ea，未通过G1整阶段门禁。
- 选择：现有房间/走廊加版本化身份与开局已知连接；直接硬编码小说无依据，排除；多楼层/新物资/NPC/声音/动作超范围，延期。
- 新事件evt-initial-building-scene，type BuildingSceneInitialized，private/actor当前玩家/time0/targets[roomId,corridorId]；紧随evt-initial-pickup，在任何TimeAdvanced前。严格payload={rule:'building-scene-v1',scene:'abandoned-residential-building-v1',playerId,roomId,corridorId,routeSourceEventId:'evt-initial-route',pickupSourceEventId:'evt-initial-pickup'}；roomId/corridorId字段定义两个地点角色。两节点、双向唯一邻接，已有路线/门缝/拾取scope地点一致；当前位置由既有历史证明，不限定动作后仍在房间。
- 初始事实known-building-scene，knower玩家/source新初始化/confidence1/observedAt0/无expiresAt且knownFactIds包含，只说明场景身份、地点角色及连接已知，不感知物资/NPC。保留原地点name字段（旧夹具名不作场景依据）。未知building-scene规则、重复/晚插/错序/错误actor/时间/目标/来源、缺知识或孤立知识拒绝；无本域事件/事实的旧世界仍合法。
- 新addBuildingScene/createBuildingPrototype/createBuildingGame组合现有pickup工厂，只增加一事件、一知识和knownFactId；不耗时/随机，不改属性、资源、地图或旧记录。独立building-scene校验被world调用，不给pickup-history加长条件。
- 公开VisibleSceneContext精确四字段：scene:'abandoned-residential-building-v1'、locationId、locationRole:'room'|'corridor'、light:'clear'|'dim'。无任意字符串叙事、秘密、物品或NPC。复制只接受自身数据属性和严格字段；缺失/非法/与当前地点ID或标签不符为null。currentProjection门槛与时钟/地点共用，旧回复不回退，pending/失败/超时保留。旧世界project为null。
- 公开模板：房间“你在一栋废弃居民楼的房间里，房门通向已知的相邻走廊。”；走廊“你在废弃居民楼的走廊里，沿已知路线可以返回刚才的房间。”；light>=0.5追加“光线足够，周围的明暗清晰可辨。”，否则“光线不足，周围细节难以辨清。”。连接与身份来自初始知识，明暗来自当前位置；不推断安全/无人/已搜空，不虚构窗户/气味/脚步。
- UI独立当前位置段和最近行动段；新世界初态已有简短场景，行动前提示“尚未行动。下一步由你决定。”；旧无场景路径保留。旧行动summary/回执不加当前场景。预览第二参数枚举room（默认）/building-room，生产传building-room显示“废弃居民楼 · 房间”，不创建世界/抽RNG，旧调用标签保持。
- 兼容/迁移：内部g0-world-v1仅新增严格事件/知识，旧世界可向前读取，不补造场景；旧程序读新事件不承诺。正式schemaVersion null及存档协议不变。多地点/动态场景未来需新版本与迁移；结构自洽不是签名认证，JSON不是存档恢复。
- 验收：683旧行为保留，真实基线已拾取混合样本、24成功动作重建/全ID重试、错误来源/投影/异步恢复、六模式双尺寸最终dist；独立门禁差距审计，UI-03/菜单外输入/未实现对象按证据标记。
- 回滚：按依赖倒序revert本轮到511c8ea，保留经理工作/旧样本/scratch，评估后续依赖；不推送/重写历史/越级。

## ADR-019 · 有限可证明叙事输出与提交后退化（2026-10-24）

- 状态：G1-011经理正式派单，按ADR-008用户授权实施普通切片；不是完整G1放行。
- 理由：模型不能创造世界事实，UI-03需要可执行输出守卫。输入只复制并深冻结本次VisibleOutcome，不传世界、原始输入、背景、整份回复或写能力。
- 选择：允许原summary，以及仅在非末尾中文句号后插入换行的完整字符串。返回必须是普通对象、恰有ok/value两个自有数据属性、ok严格true、value为非空且最多2048 UTF-16单位的字符串；完整集合匹配，拒绝accessor/extra/symbol/非字符串，无trim或自由连接词。单句可能只有一个成员，多句至少两种排版。facts不可由Narrator返回或替换。
- 预算：默认250ms，可信注入可配置整数1..1000ms（会话默认5000ms）。先提交Core和可见过滤，再等待叙事，随后调用既有未实现保存。失败/超时回原模板，成功行动仍ok。完成清timer并abort；所有迟到成功/拒绝被消费、不覆盖、不自动重试。同进程同步死循环、Proxy陷阱阻塞不属于Promise超时沙箱保障。
- 重复：同ID回执直接用原行动安全模板，不再调用Narrator，无全局缓存或无限增长。首次合法换行与重试模板排版允许不同，事实一致；会话按已提交revision避免重复历史，并用已有clock版本规则拒绝旧投影回退。各请求持有自身不可变Core结果，各世界独立。
- 备选：始终拒绝不满足正向接入；关键词/实体名或factId附自由正文无法保证真伪；另一个模型审判也不是确定性证明；缓存/共享pending增加生命周期复杂度，本切片选择回放模板。
- 影响：仅可选可信createGame配置；既有Narrator/unavailableAi/默认精确文本/ActionReply/Core与内部g0-world-v1不变，正式schema仍null。有限排版不是开放语言理解，也不是任意GameClient沙箱，无外部网络、凭据或新生产UI设置。
- 迁移：无数据迁移；不改旧工厂和样本。扩大可接受文字集合需独立可见事实依据及验证。
- 回滚：按依赖逆序revert本切片到738f6e1，保留经理记录、旧样本与scratch；不reset、强推或删除数据。

ADR-019审查修复补充：原生AbortSignal监听器异常会被宿主上报，不能用try/catch(abort)或“可信代码”免除普通清理错误。本次保留原生signal身份/aborted/reason/throwIfAborted，受控包装标准addEventListener/removeEventListener/onabort订阅；吞掉清理回调的同步throw和异步拒绝，结束后移除全部本层订阅并停止接收新订阅。不是恶意代码沙箱，直接调用原型绕过订阅包装/全局污染仍属可信执行边界。Node24移除capture=true监听器使用{capture:true}对象形式，避免布尔形式未移除；实际回归测试覆盖。


ADR-019经理验收记录：2026-10-24最终3069aac通过独立验收，包含b2333ac取消清理修复；823/823及双尺寸实际生产/隔离证据见docs/pm/reviews/G1-011-attempt-1.md。既有有限合同、可信执行边界及无数据迁移不变，不构成完整G1放行。

## ADR-020 · 已有单动作的有限组合文法（2026-10-24）

- 状态：经理G1-012正式派单，ADR-008用户条件授权内的普通切片；已实现并通过本切片测试及独立代码审查，candidate_complete待经理验收；不构成完整G1通过。
- 目标：菜单外明确表达映射到已有候选，不从片段执行、不猜测指代、不替玩家完成多动作。永久自由输入与长期开放目标不变；这不是通用自然语言理解。
- 方案：prefix为空/我/请之一；命名目标为完整label或这个+label。观察=观察[一下](四周|周围)/看看周围/原地观察/仔细观察四周；门缝=(观察|查看)[一下]目标或透过目标(观察|观察一下|看一下)；检查=(检查|查看|仔细检查)[一下]目标；搜索=(搜索|搜查)[一下]目标；拾取=(拾取|捡起|拿起)[一下]目标或把目标(捡起来|拿起来)；移动=(前往|走到)(label|这个label|相邻的label)。各规则可与一个prefix组合，未定义的修饰拒绝；一下不改变1分钟或随机。
- 规范化：首尾trim；保留完整原句以及最多去一个末尾。.!！的候选读法（允许标签中的字面点号，若两读法指向不同记录则歧义拒绝）。内部控制字符、问号、逗号、分号、引号、尖括号、重复末尾结束符不属于单句文法；不删内部空格或未知片段。没有新增输入长度上限/截断，只有有限字面比较和线性扫描；长输入失败仍保留原草稿。
- 目标只取本次targets/searchTargets/routes/doorTargets/pickupTargets；不读view叙事、背景、Core或旧全局缓存。字符串标签按数据精确比较，不插进正则、不执行代码。每个目标记录最多贡献一个候选；总候选必须恰为1，重复同ID/同名不同ID/跨类别/observe冲突都拒绝；不按类别或数组顺序抢先选择。
- 失败：沿用invalid_output和现有会话明确未执行反馈，保留草稿及当前事实，可改合法句恢复。不增加确认面板、动作链、别名ID或通用技能挑战。
- 备选：整句枚举增长重复；模糊词/前后缀截取会漏掉否定与后半句；真实模型涉及新网络/凭据任务。选有限可组合结构并诚实说明能力边界。
- 兼容：旧明确有效输入与首尾空白/单句末标点保持，旧拒绝用例不放宽；新增“跨类别也必须唯一”修复原类别优先歧义。IntentInterpreter/候选形状、Core/事件/RNG/旧factory/Narrator/保存协议不变，g0-world-v1与正式schema null，无迁移。
- 回滚：按依赖逆序revert本切片到cfd5db44，保留经理记录/旧样本/证据/scratch；不reset/强推/删数据。G1完整适用矩阵/CI/标签仍需经理审查，切片不放行Gate。

ADR-020实施证据：源码279dee9；915项及双尺寸生产/隔离通过，语法初始15RED/51先绿。实际文法与本ADR一致，无数据迁移、无UI布局/按钮变化；独立审查无Critical/Important/新增Minor，仍待经理验收，不代表完整G1通过。


ADR-020经理验收：2026-10-24固定45c419f通过915项及双尺寸生产/隔离独立验证，见docs/pm/reviews/G1-012-attempt-1.md；有限语法、兼容和无数据迁移边界保持，非完整G1放行。

## ADR-021 · 攻击声明的非执行意图分类（2026-10-24）

- 状态：经理G1-013正式派单，ADR-008授权普通切片内；实施/验收以真实证据为准，不放行完整G1或战斗。
- 理由：CORE-03及动作契约要求攻击声明产生意图而非必中结果；原invalid_output不能表达已识别但能力未实现。采用独立非执行分支，避免借分类接入后期结算。
- 语法：(攻击|我攻击|我精准击杀|我杀了|我要杀死)+(他|NPC)，10个完整组合；支持既有首尾trim和单结束符。不把“他/NPC”解析为实体或证实其存在；完成措辞不成为事实。否定/准备/愿望/条件/引用/问句/多动作/ID/HTML不截取；取消优先。其他动作继续ADR-020。
- 协议：解释器unknown输出仅新增冻结普通对象{kind:'unsupported_intent',verb:'attack'}，无targetId/伤害/成功等字段；IntentInterpreter/PortResult签名不变。session读取普通对象的全部自有属性描述符，拒绝继承/accessor/额外/symbol/数组/异常代理，不执行字段getter；既有可执行Proposal只按原字段/当前目标规则验证，不放宽。
- 反馈：严格非执行值只更新error反馈：“已识别为攻击意图，但当前尚未实现攻击。本次没有行动。输入已保留，可修改后重试。”canRetry=false，保留当前草稿，不建立命令/回执/行动历史，不耗时/RNG，不改投影/事实。已有pending/不确定重试仍先阻止新输入，超时迟到不能覆盖下一结果。
- 备选：继续一概invalid_output无法补CORE-03；直接attack结算/确认后执行会越界到战斗；本次仅分类和诚实未支持反馈，无按钮/模型/目标解析。
- 兼容影响：只有旧local-intent测试中“我精准击杀他”的解析预期明确升级，保留该测试并新增真实零执行保障。其余既有行为/旧样本不变，Core/Narrator/事件/世界及正式保存协议原字节保持。g0-world-v1/schema null，无迁移。
- 风险：有限措辞覆盖仍会拒绝其他合理输入；严密结构校验不等于恶意进程内provider沙箱。无命令分配使错误分类不会导致攻击或资源消耗。
- 回滚：按依赖逆序revert本单至0f81dd04，先评估后续依赖，保留经理记录/旧样本/历史证据/scratch，不reset/强推。后续CORE-06/07/08、完整矩阵/托管CI/标签由经理另行审查。


ADR-021实施证据：源码9a50d00；聚焦20RED/79先绿→99绿，全套984/35、类型/构建/九套两尺寸生产隔离通过。只修改local-intent与session，所有Core/Narrator及保存协议保持；唯一旧攻击分类断言变化经逐字核对。candidate_complete，最终独立审查/经理验收见报告，不代表完整G1。


ADR-021独立审查收尾：范围0f81dd0..879e19e无Critical/Important/新增Minor；源码9a50d00与最终文档收尾间产品未改，984项及9套证据有效。五项排除范围裁定/代价保留，待经理验收，不授予完整G1。


ADR-021经理验收：2026-10-24固定20d528b独立通过984/35及双尺寸生产/隔离验证，非执行分类与权限边界符合，详见docs/pm/reviews/G1-013-attempt-1.md。世界/存档协议不变，不授予完整G1。

## ADR-022 · 柜子内预存瓶水的独立发现记录（G1-014）

- 状态：按用户ADR-008/工作流及经理G1-014派单授权实施普通G1切片；本条技术选择由实施者记录，不改宪章/正式存档协议。
- 原因：旧search-v1只对应房间空罐，旧拾取权属只支持空罐；把水加入原回执会重释旧事件。
- 选择：新增cabinet-scope-v1、cabinet-search-v1、cabinet-discovery-v1及独立知识。可信createCabinetPrototype/createCabinetGame包装旧building factory，bootstrap显式采用；旧factory/旧JSON不自动补实体。
- 固定夹具：prototype-cabinet（typeId=wooden-cabinet，count1，weightKg20，durability100，condition=intact，metadata={}）位于房间；prototype-bottled-water（typeId=bottled-water，count1，weightKg0.5，durability100，condition=sealed，metadata={}）从初始化位于该柜。数值仅夹具，不表示平衡、可饮用或可见容量。
- 初始化顺序：紧接BuildingSceneInitialized，0分钟/0revision，只有柜子的可见知识。内容和实体全字段严格固定，柜及水不可复制、移动、增减。无scope却带本切片保留ID/type/知识/事件时拒绝。
- 行动：仅search柜子、空工具/参数，存活、同房、足够光照和可见证据；1分钟/revision+1，无RNG/属性/资源变化。时间/回执/首次发现/知识原子提交。重复只报告没有新发现，保持首次证据。
- 文案边界：用“发现瓶装水。水仍在柜中，当前尚未支持取出”，不用“找到了水”或“已获得”。遵守宪章叙事不得凭空授予物品；本次没有转移事件，也不声称拾取完成。CORE-07取走后不重生仍待后续切片。
- 备选：泛化旧search与拾取（扩大协议/回归范围，拒绝）；用metadata/文本藏水（不是权威实体，拒绝）；独立版本最小发现闭环（采用）。
- 影响与迁移：内部g0-world-v1加法事件，正式schema=null；新解析器仍读旧世界，新记录不能交给旧程序，不提供降级剥离或磁盘迁移。只在可信新世界组合时加场景。
- 回滚：逆序revert本单至03ba7fa，保留旧世界/历史证据/经理记录；使用旧程序前重新开始旧场景，不强行读新数据。


ADR-022经理验收：2026-10-24固定966bffe通过独立1055项及十套双尺寸验证，见docs/pm/reviews/G1-014-attempt-1.md。内部加法记录与旧factory语义边界保持，正式schema null；仅柜子发现accepted，未授权完整G1放行。下一G1-015应另记ADR-023处理双物品转移/历史负重及搜索回执兼容，不得重释本条旧记录。

## ADR-023 · 显式双物品转移能力与历史搜索结果（G1-015）

- 状态：用户ADR-008与经理G1-015-attempt-1授权范围内实施；base aeee57cafa826e95a4744532680053df97c261bd。保留宪章/路线/正式存档协议。
- 原因：旧pick_up-v1固定空罐0→0.05kg，cabinet-search-v1只描述水始终在柜内；不能重释旧记录或删除严格校验。
- 决策：新增dual-transfer-scope-v1（紧随cabinet初始化、0时/0revision，引用pickup/cabinet合法初始化，复制两件原始物品完整字段），pick_up-v2（实际from/to/count/weight/累计before-after/首次感知来源），cabinet-search-v2（固定waterLocation=cabinet|player）。新createTransferPrototype/Game包装旧cabinet factory，bootstrap显式采用；旧factory/JSON不自动升级。
- 历史：独立transfer-history只依赖schema/model及只读事件，不调用pickup/cabinet/building历史验证器，避免互相递归。先严格核对初始来源、逐事件位置/累计负重/首次感知/知识/最终状态；再向旧初始化检查提供已证明的初始位置/负重视图（不修改世界，不应用事件、不丢弃历史）。旧pick_up-v1完整验证原样；新能力世界只产生pick_up-v2，不混用旧转移回执。字符初值只允许严格证明的累计负重变化。
- 两授权物品：空罐1×0.05kg，瓶水1×0.5kg；初始0，先任意一件后另一件分别0.05或0.5，再0.55kg。用固定克数求和后投影kg，物品其他字段不变；每次1分钟/1revision，无RNG或其他属性改变。柜子永不移动。不泛化其他物品/丢弃/消耗/交易。
- 搜索：新回执固定当时水在柜中或已取出；首次发现事实仍为cabinet-discovery-v1，内容只代表发现，不授予所有权。拾取后搜索不再发现、不再声称仍在柜中；旧搜索重试按旧回执呈现，当前投影不回退。旧v1文本/行为不变。
- UI：已发现且当前可拾才公开水目标。首个#pickup节点绑定其初始目标后不再换目标；其他物品使用稳定节点与相同焦点/占位/双击保护。库存最多两条严格受控label/count/weight，唯一ID，拒绝异常属性/稀疏或坏数组。永久自由文本与有限完整句解析保持。
- 备选：删除旧校验/泛化所有资源（破坏兼容与边界，拒绝）；强迫先罐后水（限制玩家，拒绝）；版本化能力+独立历史游标（采用）。初始视图只用于复用旧严格初始化约束，未经新版历史证明不能提供。
- 兼容：内部g0-world-v1加法记录，正式schema=null；旧程序不能读取新版scope/回执，不提供静默剥离或磁盘迁移。旧1055测试/快照原样保留，新建G1-014代表样本和新中间/最终样本。
- 验证：两入口×两拾取顺序各24步、每步JSON/全部旧ID，伪造/半状态/超限候选/重复资源反例；真实dist双尺寸新水/柜子/八旧生产与隔离套件。仅精确升级柜子生产脚本的旧无取水能力预期，逐处记录；不删除其余拒绝/发现/焦点路径。
- 回滚：逆序revert本单至aeee57ca并评估后续依赖，保留经理/历史/样本/scratch；回旧程序重新开始兼容场景，不改写新数据、不reset/强推。饮用、生存、G2与完整G1非本单。


ADR-023实施证据：Core37f4fa2、应用0a63bcd、产品/工具047a88c；旧1055原样+60Core历史+38应用=1153/42，全套no-cache/类型/构建及11套双尺寸194图通过。柜子脚本唯一语义升级逐项记录docs/evidence/g1-015/cabinet-assertion-upgrades.md；其余旧脚本未改。candidate_complete待独立审查/经理验收，完整G1不通过。


ADR-023最终审查：0Critical/0Important/1非阻塞额外拾取双击测试缺口，维持本单候选完成；十项范围裁定/代价与继承Minor详见implementation-review.md。产品仍047a88c，全部证据源码一致，待经理验收，不放行完整G1。

## ADR-024 · NPC隐藏枪的真实所有权及无证据信息隔离（G1-016）

- 状态：用户ADR-008及经理唯一派单G1-016-attempt-1授权普通设计实施，base c5079b6；不改宪章/正式存档/路线。
- 选择：真实ItemInstance，position.kind=npc指向既有唯一door witness。world只接受有npc-hidden-item-scope-v1完整来源的固定一件；不创建通用NPC背包。新createHiddenItemPrototype/Game包装transfer，仅bootstrap显式采用；旧factory/JSON不自动增加物品。
- 固定夹具：prototype-hidden-handgun/type hidden-handgun-fixture-v1，count1、weightKg1、durability100、condition concealed、metadata{}；始终由现有NPC持有。质量只是测试值，不表示平衡/可用武器，不加弹药伤害装备。
- 初始化：紧接evt-initial-transfer且在任何行动之前，引用evt-initial-door-gap的npcId和transfer来源，记录完整物品；0时间/0revision，不耗RNG/玩家负重，不授予知识。旧门缝判定/回执/警觉不改。
- 校验：拒绝无scope/孤立scope/缺物品或NPC/错持有者/错字段/复制/静默转移/伪造来源及玩家知识。仅新隐藏能力世界把玩家知识约束到既有允许的事件与对应fact，私有初始化不代表已看见；旧世界知识语义不额外收紧。独立history不调用world parser，避免循环。
- 隔离：沿用既有白名单；同seed/action的旧领域状态、RNG、回执、AI原始输入及可见输出必须相同。玩家自由输入/背景出现枪属于玩家原文，不删除或算系统泄露；拒绝不确认枪存在。没有取得/使用枪能力。
- 备选：仅metadata小说（无真实所有权，拒绝）；NPC伪装容器（实体语义错误，拒绝）；完整装备武器系统（越界，拒绝）；严格限定npc位置+初始化（采用）。
- 数据兼容：内部g0-world-v1加法position/scope，正式schema仍null；旧程序不能读新数据，无静默降级剥离或正式磁盘迁移。旧1153与快照精确保留，增加真实旧/新样本及来源。
- 影响/回滚：只增加隐藏世界事实，正常用户呈现和行动不改变；CORE06只对当前具体场景验收。逆序revert本单至c5079b6并评估依赖，保留数据/证据/经理/scratch；使用旧程序须新开兼容世界，不reset/强推。


ADR-024实施证据：Core3df5862、bootstrap f98d71b，最终验证工具fcbd3e5；1219/44、typecheck/build及13双尺寸238图通过。实际bootstrap证明枪存在，原始AI输入与所有玩家投影无秘密，旧1153原样；初版DOM用户预览误报修正不改产品。唯一独立审查0Critical/0Important/0新增Minor，独立66项/类型/证据核验通过；八项范围裁定与代价见implementation-review.md。待经理验收，完整G1不放行。

## ADR-025 · 静态NPC生命周期与死亡后的门缝约束（G1-017）

- 状态：ADR-008用户委托及经理G1-017-attempt-1派单内实施，base d5bc06f；普通细节由实施者确定，不改宪章/路线/正式存档。
- 选择：新g1-static-witness-v2的life严格区分alive与dead；npc-lifecycle-scope-v1紧接隐藏枪初始化并保存完整初始NPC。dead固定来源pre-game-fixture-v1、原因unspecified-pre-game-death、atGameMinutes=-1，诚实表示开局前死亡夹具，不伪造战斗。alive仅status字段。本单不可转换。
- 旧g1-door-witness-v1及旧工厂/JSON/v1回执保持。新alive仍使用原door-observe-v1及两次RNG；dead用door-observe-v2，只抽一次视觉，noticeRoll=null/noticeCapability=absent/noticed=false，警觉与firstNoticed不变。视觉公式与合法观察耗时1分钟保持；无NPC主动声音/知识/警觉事件。
- 严格校验来源、初始化次序、NPC位置/身份/初值、当前生命状态和历史版本，dead世界不接受活人回执或正常NPC活动记录。旧领域校验仍全部执行；leaf lifecycle audit不调用world parser及其他history，避免递归。隐藏枪仍NPC所有，无掉落或新感知。
- 公共两入口新组合默认alive；dead只经可信初始化测试工厂和隔离真实产品组合验证，无URL/console/玩家开关。应用沿用视觉模板，不透露死亡/身份/枪；用户猜测属于输入。
- 备选：只禁NPC actor（仍会门缝反应，拒绝）；metadata小说或删除NPC（无真实生命约束，拒绝）；完整死亡/战斗转换（越界，拒绝）；严格新shape+来源+新dead回执（采用）。一抽RNG诚实记录没有察觉判定，比抽两次后丢弃更清楚。
- 数据影响：内部g0-world-v1新增NPC形状/scope/v2回执，正式schema仍null；旧程序不能读新记录，无静默迁移/剥离。旧1219原样，新旧样本带来源/请求。
- 风险：闭合事件/知识词汇未来要显式演进；全历史扫描未作长局性能保证；死亡转换/自治/对话/战斗和磁盘保存未交付。CORE08只对静态具体场景验收。
- 回滚：依赖逆序revert至d5bc06f，保留原件/历史/经理/scratch，新开兼容世界；不能剥离dead后使NPC复活，不reset/强推。


ADR-025实施证据：Coref577c6e、产品d675e50、工具6cb3537；1289/46、typecheck/build及15双尺寸278图通过。初次合并测试超时按状态/顺序拆分保留断言，初版浏览器焦点预期修正为既有稳定按钮行为；未改旧测试/UI。唯一独立审查及经理验收待，G1仍partial。

ADR-025最终审查：0Critical/0Important/1非阻塞注释Minor（v2一次抽样的注释表述），独立70项/类型/来源归档通过。执行并发裁定及八项范围裁定/代价见implementation-review.md，旧pickup维护Minor保留；候选待经理验收，不放行完整G1。

## ADR-026 · 默认有界测试并发与G1候选证据复用

- 状态：用户ADR-008与经理G1-018-attempt-1授权范围内实施；base ea0aeae。产品/宪章/存档不变。
- 原因：G17默认并发旧用例5062ms超过5000ms；同源码maxWorkers=2双方1289/46通过，原失败保留docs/evidence/g1-017/logs/task3-timeout.log。
- 决策：Vitest默认maxWorkers=2，保留5000ms默认超时、所有断言/样本及逐文件隔离；CLI可显式覆盖，不保证任意并发。CI改通用名Project checks及完整no-cache，Node24/双OS/contents:read和依赖原样。
- 备选：增加timeout（掩盖症状，不采用）；删断言/skip/关闭隔离（损失保障，不采用）；默认2并发（已有双方证据，采用）。代价：更大主机可能较慢，长局历史性能仍未验证。
- 验证计划：新默认连续两次完整1289/46、typecheck/build各一次；只在进程结束后记录实际退出码。结果另见g1-018证据，计划不是通过事实。
- 历史浏览器复用条件：各自记录的全部源blob一致、生产产物SHA256一致，隔离产物归档字节一致；引用原sourceHead不改旧记录。公共新建角色连续24行动演示补齐Gate演示缺口。
- 兼容：不改src/旧样本/内部事件或正式schema（仍null）；所有JSON只是内存快照测试，磁盘保存/恢复仍G2。已验收G17见docs/pm/reviews/G1-017-attempt-1.md。
- 发布边界：现有private origin及当前分支普通fast-forward推送运行CI；双平台同SHA成功才创建唯一注释式本地候选标签。正式G1验收和g1-verified由经理决定，不能预记done。
- 回滚：测试策略/CI改动可独立revert；保留候选标签/旧样本/原失败与管理记录；不reset、强推、覆盖标签或降级剥离死亡状态。

ADR-026托管失败与资源实验：首个冻结769efcb的Actions40043361701，Ubuntu1289/46通过29.60s；Windows1285通过/4旧长序列超时（9676/7012/7852/7180ms，限5000ms），44文件通过/2失败，64.28s，build/diff被跳过。完整日志ci-first-failure.json及logs/ci-*-first.log保留。假设托管runner并发资源竞争使长序列超限；只将CI显式覆盖maxWorkers=1并记录CPU/可用并行度，不改本地默认2、超时、隔离、旧测试或产品。新冻结必须重新双平台实跑；若仍失败停止资源猜测报经理，不以重跑旧SHA掩盖失败。此时未建候选标签。

ADR-026最终证据：514c2ad/40043786265双OS completed success，Windows1289/46 38.33s、Ubuntu1289/46 56.58s。runner各2可用CPU；原四超时用例Windows单worker2030/1668/1918/1509ms。本机默认2、CI显式1，不宣称唯一根因或任意主机稳定。原测试/超时/隔离/产品未改；成功后才建本地候选g1-candidate-514c2ad。正式Gate待经理。

## ADR-027 — 首个正式世界存档与单槽手动事务

- 状态：依ADR008及经理本单授权的既定G2范围内技术落实；G2-001进行中，格式/磁盘/UI均待实测，不代表用户逐字段批准或G2通过。
- 理由/方案：完整快照+原生IndexedDB满足刷新恢复及原子失败保旧档。内存/JSON演示不能证明耐久；一次实现所有G2不利于验证，分出单槽手动闭环。后续3槽、自动保存、导入导出及最小NPC关系链仍必做。
- 正式外壳严格aftermath-save/schemaVersion=1，gameBuild使用g2-001（开发构建标识，不伪称V0.2发行）；savedAtUtc为毫秒UTC ISO；saveId/worldRevision/gameClockMinutes/rngState/eventJournal必须与完整worldState对应字段完全一致。内部g0-world-v1及campaign.schemaVersion=null原样保留，外壳格式与内部模型版本是不同概念。
- SHA256：checksums.state覆盖除checksums外全部字段，UTF8；对象键递归按JS默认sort（UTF16码元）升序，数组保序，原语JSON.stringify，无空白或末尾换行。拒绝非JSON数值/值。读取顺序为格式/版本/严格外壳→摘要→跨字段一致→既有createEngine完整校验；不执行日志payload或补实体。只检测损坏，不提供认证或防作弊。
- IndexedDB数据库aftermath-survival/version1；heads与snapshots两个objectStore，当前唯一槽manual-1。head含随机提交token及previousToken；snapshot保存完整规范JSON。预读/校验/摘要在事务前完成；readwrite事务内重读head作CAS，然后写完整新快照、head/前一备份指针及清除更旧备份；仅transaction complete算成功。故障abort不提交任何部分。
- 旧token/旧revision拒绝；同world同revision但事实不同拒绝；不同world需明确允许且expectedToken匹配。读取损坏/未知档不自动覆写，保留原件/上一档。open/blocked/transaction有界，versionchange关闭连接，取消和超时abort，迟到open关闭；不自动重试。
- Application持有完整状态和DB能力；UI仅操作能力及过滤元数据。手动保存不耗游戏时间，不自动回滚已完成动作；加载完整验证并准备新engine/session后才替换。会话代次/唯一命令前缀隔离迟到回调和旧commandId；保存/读档/确认期间行动锁住而草稿可编辑。失败/取消保持当前事实、草稿与原档。
- 17旧文件仍是内部样本，不称历史正式档。全部包装/恢复deep equal及重试续行动后才记schema1可用；新增匿名正式v1夹具及来源。后续字段语义改变需迁移ADR，此次无正式历史格式迁移。
- 影响：新增正式格式与浏览器磁盘能力，不改规则含义、RNG、世界内部模型、隐藏知识或静态死亡；公开提示未手动保存变化会丢失。磁盘仍受浏览器清理/设备丢失影响，导出未交付前不得称适合长期游玩。
- 回滚：反向代码提交、保留IndexedDB/槽位/备份/v1文件。G1不能读正式档，必须保留原件待支持版本，不能删除数据库或降级剥离秘密/dead。

- ADR-027实施增量1：正式codec与v1夹具完成，32项codec/兼容通过、typecheck通过；磁盘适配器及公共路径未实现，G2仍partial。

- ADR-027实施增量2/3：原生事务与公开手动保存/读取已验证，1332/48与实际浏览器通过；仍待独立审查及经理验收。默认unavailableStorage及旧会话契约不变；公共手动路径显示独立保存状态，原每次行动的未保存反馈仅在该UI过滤。初始原型经可信bootstrap获得新world ID，不改变旧factory。

- ADR-027最终审查修订（既定授权内，格式未改）：会话只在成功load/save时固定槽token，refresh只更新可见元数据；后续save若磁盘token不同直接conflict，不以更高revision当作同一历史。未关联的新世界首次覆盖已有槽仍需确认。备选每次采用最新token会丢失别页历史，拒绝；代价是用户需显式读回而非强行覆盖。
- 当前档和previous独立校验：当前合法但previous无效返回当前档+filtered warning，读取不写；下一次提交不删除坏previous原始记录，旧current成为新previous。备选因坏备份拒绝所有读取会阻断好档，直接删除坏原件损失恢复材料；均不采用。影响：可能保留无head引用坏快照并占空间，后续恢复/导出工具处理，不能静默清理。当前档坏仍拒绝且不覆盖，本单不新增备份选择界面。
- ADR-027收尾：1333/48、类型/构建、9组实际IDB、双尺寸公共重启及高revision旧分支/坏备份验证全部通过；唯一审查两项Important已修复，1Minor记录，等待经理验收。完整G2仍partial，回滚保留所有原件。

## ADR-028 · 三个手动槽与活动会话分离

状态：依ADR008/经理G2-002授权的既定范围技术落实；实施中，未预记验证。槽manual-1/2/3是持久目标身份，世界saveId不变，原DB/version1及manual-1原件不迁移。备选新数据库或重写ID会损失兼容性，均不采用。
每槽独立token/previous；同事务清理旧备份前检查所有head引用，坏原件保留。活动世界保留每槽成功load/save绑定，选槽/刷新只改目标/摘要，不改世界或采用新token。pending/确认固定槽/会话/版本并锁冲突，刷新显式独立读三槽、坏槽单独报错。UI只接过滤摘要，默认第一槽；同world可手动复制到空槽，已有未绑定槽须确认。
影响：不改正式v1/Core规则/旧样本；多槽标记与选择增加界面复杂度，靠实际重启/并发/失败测试验证。不自动保存或后台刷新。回滚代码仍保留三槽与原件，旧界面只能看到第一槽；无需数据迁移，不删除另外两槽。

ADR-028实测候选：1347/49、类型/构建162、真实IDB16组、双尺寸三世界及旧存档/alive/dead/Narrator共84图通过。正式v1及18样本不改；gameBuild元数据更新g2-002。确认UI测试等待真正confirm阶段再校验固定槽名，loading隐藏占位不代表已提出确认；证据记录二者。独立审查/经理验收待完成，完整G2仍partial。

ADR-028最终收尾：唯一独立审查0Critical/0Important/1非阻塞提示Minor，无需产品修复；1347/49及真实三槽证据保持，等待经理验收。冲突后必须主动读取最新槽档；刷新仅刷新摘要，不得为文案便利放宽旧分支保护。

## ADR-029 · 会话内明确开启的固定槽自动保存（2026-10-25）

依据ADR008授权和经理G2-003派单实施，非逐字段用户批准。先手动存/主动load建立最新可信绑定，再显式开启；自动目标固定，呈现完成/降级后新revision一次写，失败暂停不无限重试。选择串行保存而非后台计时队列，以短暂锁操作换取有界上下文和无重试放大；草稿可编辑。另存他槽/成功load/newworld关闭旧模式。没有数据迁移，沿用v1/DB1/CAS；回滚代码保留所有槽与备份，G2-002能读自动档。

ADR-029实施收尾：固定槽会话自动模式实测1365/50、真实Chrome双尺寸恢复/故障与旧回归通过；唯一审查0严重/0重要/0新增Minor。无协议迁移或宪章变动；待经理验收。证据docs/evidence/g2-003。

## ADR-030 · 只读当前存档原件下载（2026-10-25）

按ADR008/经理G2-004普通切片授权实施；精确接口是实施者技术选择，不冒称用户逐字段批准。下载所选槽已落盘current原文本，单readonly事务捕获head/current；健康decodeSave验证，坏/未来文本标原件，非文本/无法无损UTF8失败留原件。排除先保存或重编码，避免覆盖未选世界与丢取证字节。应用独立export状态不改badge/绑定/自动模式；两段prepare/start保证迟到只释放不下载。Blob URL启动后30秒释放、最多16个活动租约防无限堆积，达到上限需稍后主动重试。只说已发起下载，浏览器确认实际落盘；无导入/迁移/previous选择，无数据协议变化。回滚代码保留数据库及已下载文件；备选导出活动内存/自动修复均不采用。

ADR-030实施证据：1392/52、类型/构建164、新原生6/旧16组与实际两尺寸30文件通过；导出不修改原件或绑定，读取超时后不发下载。仍无导入/迁移；独立审查及经理验收待执行。

G2-004最终候选：唯一fresh审查0Critical/0Important/0新增Minor，独立27/27及1206源/138保护文件/18样本/30文件/3HTML/3dist核对通过。作者1392/52、类型/构建和双尺寸144图证据保持；待经理验收。完整G2仍partial，未豁免导入/迁移/关系链/世界历史。报告docs/pm/reports/G2-004-attempt-1.md。

## ADR-031 · 有效v1原文导入空槽（2026-10-25）

依据ADR008和经理G2-005普通切片授权，具体接口由实施者选择。先安全读取/原codec验证、过滤摘要与明确确认，再事务内count检查head真正缺失并原子add快照/head；不重编码、不覆盖、不自动切世界。备选覆盖已有槽/选择即load/伪造新保存时间均扩大风险，不采用。Blob读取不可强制停止，迟到结果失效；写入超时/取消不确定时提示主动核实，不误报数据库未变、不自动重试。16MiB文件上限含边界，仅新导入限制，不修改原格式/导出。无数据迁移，回滚仅代码保留所有文件/DB，G2-004仍可读导合法v1；满槽暂不能导入。未预记测试或完整Gate通过。

## G2-005 有效v1到空槽（候选，2026-10-25）

显式选文件→严格UTF8/16MiB含边界/原codec→过滤摘要确认→事务内head键缺失才原子导入原文，成功不切换当前游戏。任意已有head（含坏/null/undefined）拒绝，保留原件；不改绑定/auto目标/草稿/世界。Blob读取无法强制停止，迟到结果丢弃；提交取消/超时不确定则提示主动检查，不报数据库未变。1418/54、typecheck/build165、新原生10组、真实两尺寸三世界关闭重开、12原文回下载及旧路径168图通过；证据docs/evidence/g2-005，尚待唯一审查/经理验收。完整G2 partial，覆盖/恢复/迁移/关系链/历史仍必需。

G2-005最终候选：唯一fresh审查0Critical/0Important/1措辞Minor，独立26/26及来源/保护/归档/产物核对通过，无产品修复。导入后未绑定世界的手动保存仍需原明确覆盖确认，不是立即冲突；导入不授予绑定，已绑定旧分支CAS保持。经理任务单措辞待经理验收解释，实施者未改任务单。完整G2仍partial；报告docs/pm/reports/G2-005-attempt-1.md。

## ADR-032 · 健康槽原文替换与精确确认（2026-10-25）

依据ADR008及经理G2-006普通授权。检查到的head token/previousToken/current原文绑定确认，事务内复查全部身份及原文；拒绝未知/未来/坏current/缺失/异常head，不靠缓存验证覆盖被改原件。有效文件保持原文，可明确同世界较旧版本或不同世界；普通write权限/CAS不放宽。新current→新token、旧current→previous，本次不删任何旧snapshot，允许好current+坏previous且坏原件保留。备选清理旧previous/重编码/遇冲突升级确认均拒绝；代价是空间增长，后续普通保存仍依原备份轮换，不是永久无限备份。

导入不安装世界/不重绑/不切auto；已绑定槽被替换后当前进度不能仍冒称保存于current，按token显示未保存并撤过时成功提示。原任务“不更新savedbadge”解释为不得把导入视为活动游戏已保存，诚实反馈优先；需独立审查核对。旧分支下一save冲突，auto失败暂停；未绑定须新普通覆盖确认。无协议迁移，回滚只代码保留原件，G2-005应能读导，需实测。尚未预记测试通过。

ADR-032实施验证：1432/55、原生11组、双尺寸原文/previous/绑定/auto/CAS与56下载审计通过；G2-005旧适配器实测三槽读导/previous兼容，无迁移。候选待独立审查，不能把通过测试等同经理接受或完整G2过门禁。

G2-006最终交付候选：唯一fresh审查1f4f1d3发现0Critical/1Important/0Minor，I1为提交结果未知仍沿用已保存肯定反馈；8反例和实际Chrome原生已提交/迟到oncomplete先失败后修复。最终产品f3da8a23d692c9545ea899e23d0d820eb92b3bb3，1440/55、typecheck/build165、重建产物双尺寸unknown/replace/import/auto故障88图/26下载通过。旧210图/56下载/audit.json保留为1f4f1d3证据，未冒称修复后全部重跑。final734源码记录/54归档核对通过，143保护及18样本不变。无二次审查或本单延期Minor，待经理验收；完整G2仍partial/G1/schema1。报告docs/pm/reports/G2-006-attempt-1.md，最终证据fix/audit.json。

## ADR-033 · 上一备份的明确恢复（2026-10-25）

依据用户ADR008及经理G2-007已授权普通切片。沿用严格codec：current成功或checksum_mismatch/inconsistent_fields/invalid_world允许，invalid_format/未来/缺失/非文本/head坏拒绝；previous必须有效。备选宽松猜JSON/未知覆盖/自动回退/直接换指针删记录均拒绝。显式检查→冻结head和两原文→独立确认→原子add备份原文为新current、旧current作previous，全旧快照保留；代价是额外空间，普通后续保存仍原轮换。

独立RecoveryFlow共用锁，unknown/conflict/确知当前异常撤失实saved；保留bindings/lastSlot/auto，主动load才切游戏。不扩普通保存或导入权限。无协议迁移，回滚代码保留DB，旧G2-006adapter兼容须实测。DB内恢复不套文件16MiB限额，文件导入限制不变。当前为实施决定，测试/完整Gate未预记通过。

ADR-033作者验证：检查成功已知current变化立即更新安全摘要，保留bindings/auto；恢复时全原件保留与3种允许损坏实际通过。1468/56、原生10组、双尺寸完整回路及真G2-006读导兼容已通过，首轮5000ms旧测试超时和原配置重跑记录保留。尚待独立审查，不表示完整G2过门禁。

ADR-033审查修复（2026-10-26）：I1失败previous检查先撤旧saved，用新增可选readExisting/open(false)在原5000ms预算核实current，不建缺失DB；无能力/失败保持待核实，健康且匹配可恢复事实。备选直接普通read会建DB、无条件恢复saved会误导，均拒绝；代价一次额外只读IO。I2仅明确存读成功捕获checksum，摘要与token/revision/checksum一致才肯定saved，检查/刷新不重绑；元数据变化保守未保存，空白不改变payload；代价可能多提示未保存，不新增防篡改保证。无持久协议变化，普通write权限不变，按既有切片授权修复；回滚代码保留全部DB原件。最终产品b63dbf04da2113c72335f109bc75fc7a7ad16ba5，1482/56、原生11+16、最终222图/86下载通过，经理验收待定。

## ADR-034 · 玩家可见持久世界记忆（2026-10-26）

依据ADR008既有授权和经理G2-008任务选择：从已验证WorldState的readActionReceipts确定性投影，不新存叙事文本、不将原journal交UI。安全字段仅当时时间和模板摘要；20条固定页/全历史可达，默认折叠。用旧回执当时视觉、声音、水位置和已知固定地点标签，不回写后来知识；legacy柜子模板不保留旧“尚未支持取出”能力提示。每会话独立HistoryClient，提交更新最新页，重放不重置，成功load/newworld新实例，dispose旧能力及UI绑定世代拒绝迟到。

备选原journal透传会泄密，另存文本会双重事实源，按saveId全局缓存会串同身份旧版本，均拒绝。每次提交重新读验证回执且只投影20条；代价长局扫描成本未保证，不能裁掉历史过门禁。无持久迁移/schema/DB/Core变更，回滚只代码保留所有档；旧G2-007保持读档能力。已实现可信层23新/86聚焦/typecheck通过；UI及完整Gate尚未验证。

ADR-034作者验证：1505/58、类型/构建168通过；真实双尺寸每侧30检查/10下载，三世界原始24/21/25行动及恢复后下一行动，全部历史可达、全world/旧命令/下一RNG一致。隔离组件拒绝旧订阅迟到且不抢草稿焦点。旧受影响回归合计222图/62下载，固定来源核对通过。每侧全自动验收耗时232.332s/234.542s包含浏览器操作与反复全状态校验，不是游戏延迟或长局性能指标。独立审查/经理验收仍待，完整G2未通过。

G2-008最终候选：唯一fresh审查固定c0d59589eef25371677c3c8ead34bfa3634c256e发现0Critical/1Important/0Minor，I1延迟叙事期间新历史与旧saved并存；4应用反例与真实UI/nativeIDB隔离组合先RED后修复，新commit先通知未保存再发布历史，auto仍onSettled。最终产品e244b7abc484e845e9ed5c536258ab5269152f88，1510/59 no-cache24.87s/typecheck/build168；7套最终双尺寸112图/32下载，1201源记录/206文件/151保护/18夹具/61归档核对。原c0d5958的11套222图/62下载保留独立版本，不冒称全部新产物重跑；旧原生b63dbf0的11+16仍明确复用，无二次审查或延期Minor。完整G2仍partial/G1/schema1。

## ADR-035 — 真实关系链所需的版本边界与原件保留（G2-009）

- 状态：**proposed / pending_decision**。2026-10-26，仅调查/契约候选；没有批准或执行正式存档升级。G2-008 已由经理 accepted，完整 G2 仍 partial/G1/schema1。
- 来源：任务 G2-009/attempt1/G2-009-attempt-1，base `1133ed3eb5233b8b1b4eaac6511b86e9a6365f95`；[只读实证与责任矩阵](evidence/g2-009/gap-analysis.md)、[推荐契约](superpowers/specs/2026-10-26-g2-009.md)、[实施顺序](superpowers/plans/2026-10-26-g2-009.md)。
- 问题：G2/SAVE-02 必须有真实玩家造成的关系变化，当前 relationships 必空；SAVE-05 尚无真正旧 schema 迁移。实际旧 codec 将同 v1 的新关系/记忆归为 invalid_world，旧恢复会接受此类 current 的前置检查；未知 envelope2 则 unsupported_version/current_recovery_refused。不能只说旧程序拒绝读取便安全。
- 推荐决定（未生效）：以一次当前位置问候、警告记忆、再次打扰后的敌意/拒绝为最小真实语义，引入 aftermath-save/schemaVersion2、g2-world-v2；NPC旧kind、campaign.schemaVersion=null、DB1保留。严格v1 reader与18原样夹具不变；关系/记忆/新事件只在v2出现，完整人格/自治仍不启动。
- 备选：同v1增加字段可能被旧程序当坏档回退活跃head，不推荐；把关系全部延期G4违反现行G2/SAVE-02，当前不可采用。只升空schema以制造迁移测试也不接受。
- 影响：新增有向NPC→玩家关系/有限亲历记忆和可验证事件；可见DTO只输出听到的回应，不露关系分数、隐藏枪或死亡原因。正式格式变更、双版本校验、显式升级和原件归档增加维护/空间成本；旧程序不能游玩新关系。
- 迁移：纯v1→v2只改内部标识/加空记忆与外壳元数据，保留全部旧世界事实/ID/time/RNG/events/resources/death/secrets，不编造旧互动。明确确认后CAS事务先归档current/previous原文再发布新head；成功后仍需另行load，不自动赋予save/auto权限。失败/取消/未知结果/并发处理按契约；未知未来版本只导出、不强覆。
- 回滚：只回代码，保留DB/文件/永久原件；旧程序可导出v2原文，不可剥离关系降级。明确从独立v1副本继续意味着没有升级后历史，不能覆盖v2或宣称完整世界回滚。普通previous轮换不承担永久原件职责。
- 用户批准状态：**P1待精确批准**上述正式版本边界/迁移与保留策略。ADR-008覆盖普通G2拆分/实现细节和汇报循环，不等于正式协议已逐项批准。经理可在既有授权内裁定普通文案/代码布局，不能据本调查派单把P1写approved。
- 另一个待裁定项P2：docs05“四类必测”要求“NPC受伤/敌对/死亡后保存读取”，docs07把动态伤势/战斗伤亡分别置于G3/G5。建议G2真实敌意+已有静态死亡，动态伤亡仍明确未实现；若据此豁免字面强制责任，需要用户精确批准。经理先核查既有批准，未覆盖则合并必要决定；不得由实施者改宪章/路线消除差异。
- 验证状态：本单只读codec/恢复前置探针、源/夹具哈希与文档检查；不是新玩法/迁移/数据库故障测试。后续建议顺序为真实问候+明确升级垂直切片→混版恢复/全SAVE→完整G2Gate；不在本单分配新taskId或实施。

### ADR-035 批准补记（2026-10-26，G2-010）

当前状态：**approved，待实施验收**。2026-10-26 用户在经理聊天01a168e7-4159-7803-911a-f95634a0c6f8原始消息“同意两项”（turn01a1784e-a8f9-79c2-8f8b-0cc860e54da7）已核实。P1/P2批准，普通规则/布局仍在阶段裁量内；批准不等于实现或Gate通过。

P1：envelope2/g2-world-v2、严格v1读取、玩家明确确认后原子保留current/previous原件并升级、另行load、禁止隐式降级/普通跨版覆盖。旧程序仅能导出v2不能继续新历史，原件额外空间成本已告知。P2：G2真实敌意/记忆与已有静态死亡存读；动态受伤/死亡过程仍not_implemented，随G3/G5机制做事件持久化和故障恢复，G7全量复验。原proposed记录为批准前历史。依据docs/pm/reviews/G2-009-attempt-1.md批准补记及原始用户消息；没有修改宪章或路线，G2仍partial。

G2-010最终候选：产品990a930；1632/67与真实浏览器验收通过，唯一审查0Critical/0Important/1Minor，原verdict With fixes。M1原件列表在行动后需重新列出才可下载，原文无损，按inline规则延期，待经理裁定/唯一修复派单；不得写成已修复或无缺陷通过。完整G2partial/G1/formal2/DB1，报告docs/pm/reports/G2-010-attempt-1.md。


### ADR-035 G2-011实施补记（2026-10-26）

G2-010已accepted，M1关闭，原退回记录保留。已批准第二切片采用独立inspectConvertedPrevious/restoreConvertedPrevious能力，普通recoverPrevious仍只接受同版；公开恢复流程后续将以独立明确确认调用转换。严格codec先确认可恢复损坏类别，再要求current v2、previous健康v1；候选只复用既有纯映射，不混入current后续历史。

技术记录采用独立`recovery-record:<destinationToken>`和严格kind=`previous-v1-to-v2`，字段沿用已批准的来源双token/双hash/双归档key/目标token/时间，previous字段必须非空；旧migration-record/v1-to-v2 schema和语义不改。两份原文复用`migration-original:<rawSHA256>`永久键；新原件列表只接受同槽且key/record匹配的两类严格记录。事务内精确CAS原两head与两原文，核对同键原字节，全部add后切head、previous指原current，不删除原快照。备选把新kind塞入旧记录会改变旧语义，因此保持独立前缀。空间成本与旧程序仅导出v2的限制不变；旧程序保新前缀仍须本单实测，不能仅据设计断言。

当前为Task1存储实现验证；应用/公开端验收仍待。此为已批准P1的实施细化，不新增格式版本/DB版本/玩法方向。回滚只代码，保留全部数据库/新旧记录与原件；未新增用户批准事项。

### ADR-035 G2-011作者验证补记（2026-10-27）

第二切片应用/UI现已接入，严格技术记录和双原件已在真实DB与固定旧e244验证：旧程序拒绝新v2覆盖，可精确导出，三次普通v1保存不删新recovery-record/永久原件。额外空间与返回旧进度的代价明确提示；恢复后当前会话保持，必须另行load。未改变已批准P1/P2、正式v2或DB1，无新方向批准事项。作者验收通过仍非完整G2/经理accepted，失败和旧历史不删，回滚仍仅代码且保留全部世界与原件。

G2-011最终候选补记：1707/70 no-cache30.01s，唯一独立审查0Critical/0Important/0Minor通过；无须修复，无第二审查。产品f3f17ae，报告docs/pm/reports/G2-011-attempt-1.md，经理验收仍待，完整G2partial/G1。此前“待审查”段落为作者验收时点记录，历史证据保留。

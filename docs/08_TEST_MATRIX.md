# 08 · 测试矩阵 / 防漂移强制回归

> 最新Gate事实（2026-10-27）：G2-010与G2-011均已经理accepted（仅切片）；正式schema2/DB1、严格v1兼容。当前G2-012统一完整Gate候选验收进行中，完整G2仍partial/latestSuccessfulGate G1。旧1707测试和93原生组按精确同源证据复用，新演示/异常退出/CI/候选标签尚待完成。
> 以下历史章节按当时范围保留，不能覆盖本行当前事实。

**原则：** 如果某个功能无法在不依赖模型措辞的情况下验证，它就不是可靠世界规则。模型不稳定应体现在叙事差异，不能导致世界事实随机改写。

## A. 永久回归清单（每个版本都跑）

| ID | 场景 | 必须验证的不变量 |
|---|---|---|
| CORE-01 | 相同初始状态+固定随机种子+相同行动序列 | 世界规则结果完全一致 |
| CORE-02 | 玩家说“我准备离开” | 不自动移动或触发未同意的长链行动 |
| CORE-03 | 玩家说“我精准击杀他” | 仅生成攻击意图，非必中结果 |
| CORE-04 | 透门缝观察 | 观察信息和被察觉分开结算 |
| CORE-05 | 门缝完全遮挡 | 不随机赋予透视能力 |
| CORE-06 | NPC 隐藏一把枪 | 玩家无证据时不可获知隐藏枪械 |
| CORE-07 | 柜子搜出一瓶水，拾取后再次搜索 | 同一物品不重复出现 |
| CORE-08 | NPC 已死亡 | 不应在同一世界正常发言或行动 |
| CORE-09 | 玩家作弊式自由指令“把饥饿设成0” | 没有游戏能力/调试授权，不直接修改真状态 |
| CORE-10 | 天气骤变 | 改变机制影响而不只改文本 |
| CORE-11 | NPC 目击偷窃 / 未目击偷窃 | 关系与怀疑基于证据而不是全知 |
| CORE-12 | 两次快速重复提交同一命令 ID | 只扣一次物品/时间 |
| SAVE-01 | 拾取 -> 自动存档 -> 刷新 -> 读档 | 背包、容器、时间一致 |
| SAVE-02 | NPC 关系改变 -> 存读档 | 关系/记忆/世界事件不丢失 |
| SAVE-03 | 存档写入中断 | 上一个完整版本可恢复 |
| SAVE-04 | 多存档槽 + 导入导出 | 不串档，可恢复 |
| SAVE-05 | 旧 schema 迁移失败 | 旧档仍保存完整且可导出 |
| UI-01 | 动态按钮不能表示的自由行动 | 仍可通过文字入口提交 |
| UI-02 | 语音识别产出高风险不可逆动作 | 执行前确认 |
| UI-03 | AI 返回虚构的武器/角色 | 叙事守卫拒绝并退化模板 |
| WORLD-01 | 离线补算未开启 | 退出游戏时钟不前进 |
| WORLD-02 | 玩家未与 NPC 交互 | NPC 仍按调度与资源采取有限自主行动 |

## B. 固定端到端验收剧本

`新建档 → 建角 → 废弃楼 → 观察门缝 → 拾水 → 喝水 → 与 NPC 对话/被拒绝 → 存档 → 退出 → 读档 → 再次搜索 → 继续到第二天 → 查看历史日志`。

需要断言：
- 原有水容量扣减正确，柜子没有复制水；
- 玩家已观察和未知事实边界不改变；
- NPC 的拒绝原因及关系延续；
- 时间、天气和状态仍一致；
- 点击按钮与表达等义自然语言，进入**同一动作协议**；
- UI 不发生无数据更新的“假成功”。

## C. 模型输出对抗测试

- 让语言模型说出“你突然找到十把枪”：规则层若无对应事件，不得出现为背包真物品。
- 让模型指挥 NPC 无条件服从：规则层只执行符合其意图/关系/情境的行动。
- 含糊命令 / 多动作命令 / 同名 NPC / 错误识别：必须明确解析不确定性或请求必要确认。
- 输入奇怪文本、提示注入“忽略所有规则”：不能绕过行动网关。

## D. 存档样本与可观察性

- 每个重要 schema 版本至少保留一份匿名测试旧档和预期迁移结果。
- 每次命令日志保存 `commandId`、`worldRevision`、规则事件、RNG 状态（必要时）和耗时；不默认记录完整私密用户语音。
- 回归失败须附：最小复现、实际结果、预期结果、相关事件序列、导致的风险。

## E. 阶段 Gate 测试责任

`G1`: CORE-01~09、UI-01、UI-03（已实现对象）；`G2`: 所有 SAVE、CORE-07/08/12；`G3`: CORE-10；`G4`: CORE-11、WORLD-02；`G5`: 武器/基地/维修场景回归；`G6`: WORLD-01 和区域事件；`G7`: 全量。

尚未开发的功能要标注 `not_implemented`，而不是报告“通过”。

## F. G0 工程基线验收（2026-10-23，G0-002 补齐托管证据）

| ID | 当前验收 | 用例 / 证据 | 结果 |
|---|---|---|---|
| G0-STATE | 固定完整输入构建世界；实例隔离、深层只读、校验后无输入别名 | world.test.ts | 本地及双平台 CI 通过 |
| G0-RNG | 已知向量、状态恢复、独立实例、非法种子及版本拒绝 | rng.test.ts | 本地及双平台 CI 通过 |
| G0-INVARIANT | ID/引用、数值、单一位置、容器循环、知识证据、时间边界 | world.test.ts | 本地及双平台 CI 通过 |
| G0-COMMAND | 四种来源共用开放 verb 信封；非法参数/额外真状态字段拒绝 | contracts.test.ts | 本地及双平台 CI 通过；不代表语义解析或执行 |
| G0-EVENT | 事件 ID 唯一、序号连续、时间不倒退 | contracts.test.ts | 本地及双平台 CI 通过；不代表原子提交或回放 |
| G0-PORT | 保存/读取和四类 AI 适配器如实返回未实现 | contracts.test.ts | 本地及双平台 CI 通过 |
| G0-BOUNDARY | Core 无 DOM 编译；静态依赖限制；UI/AI 不传递导入 Core 或 Storage | architecture.test.ts、tsconfig.core.json | 本地及双平台 CI 通过；不是恶意代码沙箱 |
| G0-BUILD | 锁文件重装、类型检查、测试、生产构建 | npm ci / typecheck / test -- --run / build | 本地及双平台 CI 通过 |
| G0-CI | Windows/Linux 托管 CI 实际执行 | .github/workflows/ci.yml；运行 39958736684 | 两个任务全部成功；G0 通过 |

初始 RED：4 个测试文件，33 失败 / 27 通过（缺失功能）；实现后 4 个文件、60 项测试通过。首轮更早的测试启动因依赖仍在安装、vitest 不可用而失败，未当作 RED 证据。

G0-002 完成时 CORE-01 仅初始化/RNG 有证据，其余玩法未实现；G1-001 的当前增量覆盖见 H 节。不能将 G0 结构检查冒充玩法验收。

## G. G0-002 托管执行证据

- [GitHub Actions 运行 39958736684](https://github.com/Cappuccinor/aftermath-survival/actions/runs/39958736684)，push / attempt 1，2026-10-23T13:08:19Z 至 13:09:06Z，结论 success。
- 完整提交：`d045dc141d72de80d0622ae62015b60a43231da5`；G0-002 后续交接提交只改文档及状态记录，不改变被测代码、锁文件或 CI。
- Ubuntu 24.04.5 / Node 24.21.0 / npm 11.19.0；Windows Server 2025 / Node 24.22.1 / npm 11.19.1。两者各执行 4 文件、60 测试，无失败。
- 两者 `npm ci`、`npm run typecheck`、`npm test -- --run`、`npm run build`、`git diff --check` 全通过。CI 的 diff 命令检查工作树；交接提交另做本地差异检查。
- Action v4 的 Node 20 目标被托管平台以 Node 24 运行，另有 punycode/url.parse 弃用警告；本次未造成任务失败，未借此扩大依赖升级范围。
- 机器可读证据：`docs/evidence/2026-10-23-g0-002-ci.json`。该记录保留已完成运行，不将后续新提交或标签触发的待运行任务预记为成功。

## H. G1-001 原地观察切片（经理已验收；G1 / partial）

经理于 2026-10-23 在最终提交 cfea74a 独立运行 98/98、typecheck、build 及范围/工作树 diff 检查，均通过；复核 359ba15 光照回执修复，接受本切片。详见 docs/pm/reviews/G1-001-attempt-1.md。当时 G1-002 尚未实施；当前候选 UI 的增量证据见 I 节。

| 任务验收 | 实际覆盖 | 测试证据 |
|---|---|---|
| 1 确定性序列 | 相同输入进行 20 次 observe，时钟/revision 各 +20，40 条事件、知识一致，RNG 不变 | observe.test.ts |
| 2 原子状态 | 候选世界通过不变量与观察回执校验后才替换快照；旧快照保持不变 | observe.test.ts |
| 3 参数/规则失败 | 非法 actor、目标、工具、参数、verb、revision；hp=0 拒绝；全部无副作用 | observe.test.ts |
| 4 去重/隔离 | 旧命令重试只回原回执；不同有效请求复用 ID 拒绝；实例隔离及 JSON 快照重建去重 | observe.test.ts |
| 5 失败原子性 | 时间/revision 溢出、事件 ID 冲突均保留原快照；失败请求不占用 ID | observe.test.ts |
| 6 可见白名单 | 0/0.49/0.5/1 光照分支；不输出名称、容器内容、远处物品、metadata、原始 utterance；四种 source 同事实 | observe.test.ts、game.test.ts |
| 7 权限边界 | G0 60 项回归；原 Core 纯依赖/无 DOM 与 UI/AI 依赖检查原样保留；Application 仅交出 dispatch | architecture.test.ts、game.test.ts、typecheck |
| 8 真实未保存 | Application 使用实际 unavailableStorage；完成/重试都返回 persistence.ok=false / not_implemented | game.test.ts、contracts.test.ts |

本地 Windows / Node 24.15.0 / npm 11.12.1：初始 RED 为 36 失败、60 通过；初次 GREEN 为 6 文件、96 项通过。中间一次校验 helper 名为 require 触发既有 Core 禁止动态加载检查；重命名 helper 后通过，没有放宽边界测试。独立审查发现快照中光照判定被篡改仍能重建的缺口；新增两项应用入口回归先实测失败，再校验 observe-v1 判定与静态光照一致，最终 **6 文件、98/98**，typecheck、build、diff --check 通过。未来改变光照的规则必须加入历史判定证据，不能用最新光照回算历史回执。

CORE-01：原地观察 20 次序列部分通过；完整 G1 动作集未实现。CORE-12：observe 去重与冲突部分通过，物品扣减/并发保存未实现。CORE-06/09：当前光照白名单与拒绝直接改状态有反例证据；NPC 及自由文本攻击完整场景未实现。CORE-02/03/04/05/07/08/10/11、SAVE-01~05、UI-01~03、WORLD-01~02 和端到端剧本仍未完成。

本切片没有 UI 交互、真实 AI 或持久化，未执行浏览器交互、真实模型、保存/崩溃恢复及托管 CI；依赖未变，未重复安装。阶段收尾必须补齐适用 CI 与完整 G1 验收，不能以本切片候选完成代替 Gate。

## I. G1-002 观察交互入口（经理已验收；G1 / partial）

独立只读审查 9b7e348..74a520f 无 Critical/Important/Minor；另跑 148/148、typecheck、diff 检查通过，并核验 31 个源码 blob/3 个产物哈希。构建与浏览器来自实施者实跑，审查者未重复执行。经理随后在固定提交 9c5e7d04defabf5aa837d2944fa3eb10fe69986b 独立通过 148/148、typecheck、build、diff 检查及最终 dist 的两尺寸 Chrome 路径，实际查看截图并核对来源/产物哈希；接受本切片。经理记录与证据见 docs/pm/reviews/G1-002-attempt-1.md 和 reviews/evidence/G1-002-attempt-1/browser-results.json。

| 任务验收 | 实际覆盖 | 证据 |
|---|---|---|
| 1 保守解释 | 8 种合法表达/标点，21 个否定/准备/条件/多动作/作弊/门缝/HTML 等反例；失败不 dispatch、不耗时或丢草稿，合法后续可恢复 | local-intent.test.ts、session.test.ts |
| 2 同网关及权限 | 按钮/等义文本的规范化命令经过 Core 后完整世界一致；UI/AI 原边界保留，扩展到每个模块；可信 bootstrap 注入受限会话 | session.test.ts、architecture.test.ts |
| 3 异步/失败 | 同步 pending 锁、5 秒预算、无自动重试、异常/超时同 ID 确认、迟到结果不写 UI、旧回执不倒退/重复、编辑草稿不被擦除、实例隔离 | session.test.ts；clock 投影/跨午夜；game.test.ts |
| 4 回归/工程 | 原 98 项保留（GameClient 白名单新增 clock），新增 50 项；8 文件 148/148、typecheck、build、diff check exit 0 | 本地 Windows Node 24.15.0/npm 11.12.1 |
| 5 生产路径 | 从 dist preview 真正启动 Chrome：键盘进入→按钮 08:01→文本 08:02→8 类拒绝不推进→合法恢复 08:03；永久自由输入与真实未保存反馈 | browser-results.json，10 张 PNG；scripts/verify-observation-ui.cjs |
| 6 布局/恢复 | 1280×900、360×800 CSS px；窄屏纵向滚动，无横向溢出；输入/提交/叙事/反馈可达；Enter/IME 不误提交，快捷键与按钮可用；物理双击一次结算；刷新重置明确未保存原型 | 同上，含 layout 指标、请求清单、无 pageerror |

实际 RED：53 失败 / 95 通过，总 148（新增 50 行为失败，另 3 项旧测试因新增 clock 验收扩展失败）。初次 GREEN 148/148；第一次 typecheck 检出 Object.freeze 丢失适配器上下文类型，显式泛型修正后通过。首次生产浏览器路径在物理双击处失败，原因是第一次结算已在第二下之前完成；增加 UI 原生重复点击/键盘重复保护后两尺寸通过，原失败保留 browser-red-doubleclick.json。

当前覆盖：CORE-02/09 为本地解释拒绝部分；UI-01 为永久自由入口及观察等义表达部分；CORE-12 为观察重复提交/双击/重试部分。CORE-03 不代表攻击意图已实现；门缝、移动/检查/搜索/拾取、建角、真实 AI、UI-02/03 完整场景与 SAVE/WORLD 仍未完成。异常/超时和 pending 用自动替身测试，正常浏览器未人为加延迟。未跑真实模型、存档恢复、真实手机/语音与本切片托管 CI；不据此宣布 G1 Gate 通过。

## J. G1-003 已知单物品检查（经理已验收；G1 / partial）

源码提交 4b9cf721cc2cbd2df4eb0a33c53da576815f709d；Windows Node 24.15.0。原 148 项行为保留，仅扩展显式 DTO 白名单，新增 80 项；10 文件 **228/228**、typecheck（含纯 Core）、build、diff --check 均 exit 0。旧 G0/G1 JSON 是由 f28f619 基线真实 Core 生成的固定样本，不由新实现动态生成期望。

一次独立只读审查 f28f619..4b9cf72：Critical/Important/Minor 均无；另跑 `npm test -- --run --no-cache` 228/228、typecheck、提交范围 diff 检查，通过；核验40源码blob/3产物SHA256并查看360px截图。未重复 build/browser，双尺寸浏览器来自实施者实跑。未评范围的7项裁定/代价见独立报告；无修复或延期 minor。

经理于 2026-10-23 固定 5095aed51e26f3994008eb2df14b97547a9a0769 独立通过 no-cache 228/228、typecheck、build、范围/工作树 diff；重新构建的 dist 在实际 Chrome 两尺寸各 7 组路径通过，另查两张检查恢复图及 40 源码 blob / 3 产物哈希。结论 accepted 仅本切片；见 docs/pm/reviews/G1-003-attempt-1.md 与对应 reviews/evidence 目录。

| 验收 | 实际验证 | 证据 |
|---|---|---|
| 感知与白名单 | 版本化初始感知、knowledge/knownFactIds、当前直接位置、光照阈值；投影仅 ID/受控标签，外观不含 metadata/condition/耐久 | inspect.test.ts、inspection-session.test.ts、prototype.ts |
| 失败不变/不泄密 | 未知/不存在/远处/容器/背包/暗处/缺失或伪造证据/过期/弱置信度/不支持类型统一拒绝；非法 actor/参数/revision/hp=0，无状态替换 | inspect.test.ts；应用及解释上下文白名单断言 |
| 等价与恢复 | 按钮及检查/查看空罐产生完整相同世界；失去响应后同 ID 确认，锁住其他动作；失败保草稿，旧投影不倒退 | inspection-session.test.ts；既有 session.test.ts 延迟/超时用例 |
| 混合历史 | 20 次 observe/inspect，每步 JSON 重建/重试，41 条连续日志、时间/revision 正确、物品/RNG 不变、两实例隔离 | inspect.test.ts |
| 版本与原子性 | 严格 TimeAdvanced 动作配对、跨 verb/target/revision ID 冲突；12 类历史损坏拒绝；时间/revision 上界、事件碰撞无半提交 | inspect.test.ts；旧 observe-v1 载荷、expiry 接受行为保持 |
| 解析权限 | 整句匹配且仅可见目标，缺失/同名歧义拒绝；否定/准备/条件/多动作/ID/作弊不执行；提案必须是自身严格字段 | inspection-session.test.ts；原架构检查未放宽 |
| 生产产物 | Chrome 156.0.8078.47，1280×900 / 360×800：检查按钮→两文本→9 类拒绝→观察/检查恢复；动态节点保焦点，双击/repeat 一次结算；既有观察全路径仍通过 | docs/evidence/g1-003/browser-results.json，16 PNG；40 源文件 blob、3 产物 SHA256 |

RED 记录：核心 43 失败/149 通过；会话 11 失败/212 通过，其中一个歧义用例 row 被测试框架展开造成夹具错误，修正为对象 row。另两个继承属性伪造提案用例及一个旧观察 expiry 兼容用例分别先失败再修复；最终 228/228。首次生产浏览器在“初始可见空罐”断言失败（UI 未接入），保留 ui-red；接入后通过，最终固定源码提交重新验证成功。曾有一处末尾空行被 diff --check 检出，清理后通过。

G1 门禁：20 次混合不变量、原型自由文本/权限边界获得局部证据；完整场景、建角、门缝可见/暴露独立判定、移动、搜索和拾取仍 not_implemented。SAVE-01~05、真设备/语音/真实 provider、托管 G1 CI 未执行；无正式存档与磁盘崩溃恢复声明。G1 partial/latestSuccessfulGate G0 不变。

## K. G1-004 最小移动（经理已验收；G1 / partial）

G1-004 candidate_complete：房间/走廊显式move，1分钟原子位置/时间/事件，历史位置验证与跨地点旧命令重试；279/279、typecheck/build/diff和Chrome360/1280各8组通过。任务及整段独立审查均无Critical/Important/Minor，待经理验收。G1仍partial，正式存档null。

| 验收 | 证据 |
|---|---|
| 已知路线/等价/守恒 | movement.test.ts：按钮/两文本、双向1分钟、物品/RNG/属性不变 |
| 过去位置/当前感知 | 检查→移动→拒绝远程检查→暗处观察→返回检查；跨地点空/显式旧observe、inspect、move重试 |
| 原子性/损坏 | 上界、事件碰撞、非法参数/actor/路线/当前地点、源/目的/最终位置/版本/感知损坏拒绝 |
| 兼容与混合 | 基线实际Core生成两固定旧JSON，24步每步重建并重试所有旧请求，连续事件/确定性/隔离 |
| 应用/文本/权限 | 迟到投影不回退，不确定结果同ID，准备/否定/链式/歧义/ID拒绝；原228行为及架构约束保留 |
| 生产 | docs/evidence/g1-004/final/browser-results.json：45blob/3SHA256/20图，Chrome两尺寸各8组含全部旧观察/检查路径 |

真实RED与修复：首个夹具漏utterance为测试错误；修正后move缺失2项RED，应用3项RED，另movement知识expiry损坏RED均修复。后加边界项为回归，不宣称全部先RED。窄屏双击因叙事缩短丢焦点，4lh叙事最小高度后通过；失败JSON保留ui-red。正式保存/断电恢复、真实模型、真手机/语音/IME、跨浏览器、长局性能、托管G1 CI未执行。G1仍缺建角/完整场景/门缝/搜索/拾取，不能通过Gate。

协调者另行实际重跑 typecheck、279/279、build、diff 均通过；原始输出见 docs/evidence/g1-004/{typecheck,tests,build}.txt，来源核对见 coordinator-verification.json。任务审查范围合规/质量 Approved、无 Critical/Important/Minor；整段审查同样无Critical/Important/Minor；经理验收尚待结论。审查依据与范围裁定见 docs/evidence/g1-004/implementation-review.md。

经理于2026-10-24固定647eff1660303833710a77e899dc1884a4c67b9b独立通过11文件279/279、typecheck/build/范围与工作树diff；重新构建dist并实跑Chrome360/1280各8组，核对两套45源码blob/3产物hash/20截图，查看走廊及返回检查图。G1-004 accepted；详情docs/pm/reviews/G1-004-attempt-1.md。上文候选/待经理表述为实施阶段历史；当前G1仍partial，搜索/拾取/建角/门缝等未完成。

## L. G1-005 搜索与发现（经理已验收；G1 / partial）

G1-005 candidate_complete：预置空罐初始不披露，首搜取得真实发现证据，再搜无新发现；旧历史/重试兼容，325/325、typecheck/build/diff与Chrome360/1280各12组通过。任务、整段及修复复核完成，无阻塞问题，待经理验收。G1仍partial，正式存档null。

| 任务验收 | 实际覆盖与证据 |
|---|---|
| 1 预置物品与知识 | search.test.ts / search-session.test.ts：初始真实空罐存在但直接inspect拒绝，投影/解释器/初始文案无空罐；首搜发现后可检查，离开/返回，物品/RNG/属性不变 |
| 2 搜索与失败 | 首搜1分钟取得首次证据，再搜1分钟且无新发现；按钮/两文本完整世界一致；非法/暗处/远处/hp0/参数/actor/revision拒绝，失败恢复 |
| 3 混合恢复 | 24步search/inspect/move/observe，每步JSON重建及全部旧请求重试；两世界隔离，跨verb/目标/revision冲突拒绝 |
| 4 历史与原子性 | 版本/结果/来源/物品/顺序/未来知识/searched矛盾拒绝；同时间beforeSeq边界单独覆盖；上界/事件冲突不半提交 |
| 5 兼容与工程 | 固定旧移动样本由32c3500旧Core实际执行；旧原型/样本/279行为保留；13文件325/325、typecheck/build/diff通过 |
| 6 生产 | Chrome156.0.8078.47，360×800/1280×900各12组；初始→首搜→检查→再搜→离开返回→拒绝→恢复，含旧流程、焦点/双击/键盘/未保存/无横溢出；49源码blob/3产物SHA256/26截图 |

真实RED：缺搜索初始化的2项断言、初始文案泄漏空罐的2项断言先失败后通过。其余新增边界回归不都先RED，不能统称46项TDD-first。生产预检前4次暴露焦点/页面高度问题：预留隐藏历史与搜索区域空间后通过，第5次预检和固定源码最终运行均通过。编码、旧样本生成API、诊断脚本语法错误单独记录，不当作功能RED。

协调者另跑325/325、typecheck/build/diff，核对11个基线源码SHA256及固定样本哈希，检查当前源码/产物一致并查看搜索前后窄屏截图。证据 docs/evidence/g1-005/coordinator-*，浏览器为实施实跑，未独立复跑。生成器Node24实验API有warning，原始输出保留；不影响主套件通过，兼容来源经审查与哈希核对；实验API仍是工具复现限制。G1缺建角/门缝/拾取/完整场景，SAVE/真设备/语音/真实模型/长局性能/托管G1 CI未执行。

最终审查无Critical/Important，轻微可读性和过时注释已在36c3469433abecfab8578cdafb082fdb7556be9e修复；限定复核通过，无新问题。保留Node实验生成器限制及历史警告。修复后325/325与生产各12组再次通过，3产物hash与前版相同；最终证据docs/evidence/g1-005/fix-1/final，协调者再次核对49源码blob/3产物/26图，未重复浏览器。详见implementation-review.md。

经理2026-10-24在固定da8010d独立完成325/325、typecheck/build及两尺寸各12组生产路径，另核对49源码/3产物/26图及旧样本来源。功能与兼容检查通过；完整32c3500..da8010d范围diff检查exit1，12份日志末尾多余空行，故第5项工程收尾未通过。上文diff通过为实施阶段工作树检查，不能代表整段提交。attempt1 changes_requested；同一G1-005 attempt2仅修尾行并提交新报告，不开始下一切片。经理证据与细项见docs/pm/reviews/G1-005-attempt-1.md。

### Attempt 2 证据收尾（2026-10-24）

G1-005 attempt 2：12份证据日志仅去掉多余尾行，正文/警告逐字节核对通过；32c3500..285fd63完整范围、工作树及暂存区diff检查均exit 0，候选完成待经理验收。源码未变，沿用经理在da8010d通过的325/325、typecheck/build及Chrome360/1280各12组证据，本轮未重跑。attempt 1范围检查失败记录保留；G1仍partial、正式存档null。

实际复现直接Git返回2，经理历史记录返回1，均为非零失败，不改写旧报告。修复提交 285fd63e0e551d60d4e456db57d013f4075a3006；12份工作文件共删除24字节，保留原始行终止符；暂存Git正文与da8010d去掉末尾CR/LF后逐字节相同，59个受保护文件blob一致。核对与命令输出见 docs/evidence/g1-005/attempt-2/{log-byte-verification,repair-commit-checks}.json；最终文档提交后再检查同一原始基线范围，结果随固定最终SHA回报。功能测试/构建/浏览器未重跑，来源是经理review及reviews/evidence/G1-005-attempt-1。未新增玩法测试或存档/真实设备声明。

经理2026-10-24固定d43e392完成attempt2验收：12份Git日志仅末尾LF减少且正文逐字节一致，59个受保护文件最终/当前blob未变，19个文件均在修复范围；32c3500..d43e392完整范围、工作树及暂存区检查exit0。源码未变，沿用attempt1经理独立325/325、typecheck/build及双尺寸各12组生产实跑，不重复执行或虚报新运行。G1-005 accepted，详见docs/pm/reviews/G1-005-attempt-2.md；attempt1失败作为历史保留。下一G1-006建角仅派单准备，当前未实现，整阶段仍partial。

## M. G1-006 基础建角（经理已验收，G1 / partial）

源码860fbca；Windows/Node24，15文件409/409=既有325+新增84；typecheck/build通过。独立审查无Critical/Important/Minor，经理验收未完成。

| 风险/验收 | 预防与实际验证 | 状态 |
|---|---|---|
| 资料只是界面装饰 | character.test.ts：14字段进入唯一创建事件，规范化姓名、技能/初始属性一致，JSON重建保留 | 通过 |
| 自由背景变成作弊 | 背景含十把枪/无敌/同伴行为/任意地图仍无实体和数值变化；多余字段、错误类型、继承字段、Unicode界限、0/30/60预算边界拒绝 | 通过 |
| 新记录损坏或新旧语义混用 | version/rule/身份/target/时间/重复/顺序/初始值/无依据时钟拒绝；旧全部固定样本及初始化原样接受；23份原测试/支持/快照Git blob不变 | 通过 |
| 重复/失败创建覆盖世界 | character-creation.test.ts：无预览不可开始，取消/编辑不创建，工厂失败保草稿可重试，同步重入及旧入口互斥、成功缓存 | 通过 |
| 建角后旧行为破坏 | 24步四原语混合，每步JSON重建并重试全部历史；人物资料/技能/资源/RNG不变，两个世界隔离；原325项未删除或放宽 | 通过 |
| 真实浏览器交互 | Chrome360/1280各6组建角：字段、错误聚焦、中文/换行/HTML纯文本、40/41emoji边界、取消/返回、双击/键盘、查看资料、搜索检查往返及拒绝恢复 | 通过 |
| 旧生产入口 | 同一最终dist原--search两尺寸各12组，保留旧键盘入口/观察/检查/移动/搜索/自由输入/恢复路径 | 通过 |
| 长内容可用性 | 两尺寸无横溢出、输入/提交/资料可滚动到达；查看360预览与恢复截图，资料折叠以保留叙事主体 | 通过 |

精确新增测试：character.test.ts 65、character-creation.test.ts 19。最初Core/app模块缺失时分别导入失败，记录为缺实现RED（无用例运行）；新增时钟/revision两项曾实际断言失败，修复后409/409。UI旧产物缺入口RED，首次新产物双击后焦点丢失RED；一次页面切换mousedown保护后两尺寸通过。全部失败JSON/输出保留，不将84项统称逐项TDD-first。

证据docs/evidence/g1-006：final-character与final-search均固定56源码blob/3产物SHA256，分别10/26截图；verification.json核对当前源码、产物、原测试和差异检查。创建是同步操作，无异步/超时/迟到路径；不人为增加后台任务。世界仍仅内存/内部JSON，磁盘崩溃恢复、托管G1 CI、真手机/语音/跨浏览器、真实AI及长局性能未执行，G1完整Gate未通过。


经理2026-10-24固定20e6a01独立通过409/409、typecheck/build、1f6d675..20e6a01完整范围及工作树/暂存区检查；重建dist在Chrome360/1280建角各6组、旧search各12组通过。四套证据56源码/3产物哈希及10/26图核对、23份旧测试文件不变，查看360预览和恢复图。G1-006 accepted；上文经理待验收为实施时历史。详情docs/pm/reviews/G1-006-attempt-1.md；G1仍partial，下一G1-007只读状态面板尚待派单开工。

## N. G1-007 自身状态只读投影（经理已验收）

源码0b2ae8a258f9e807e3c7c1eed4bebcd536bb55e5；17文件458/458=409既有+30投影+19会话；typecheck/build通过。完整G1仍partial/latestSuccessfulGate G0、正式存档null。

| 风险/验收 | 实际证据 | 结果 |
|---|---|---|
| 初值假数据或泄密 | player-status.test.ts：合法无创建记录夹具十种值/边界/小数/单位、明确十字段、冻结副本、自有数据属性、extra隐藏/继承/访问器/撤销代理拒绝 | 通过 |
| 回执取旧值 | 四真实原语及旧请求重试；修改合法恢复夹具的当前stats后旧receipt仍投影当前值；Core/资源/RNG行为保留 | 通过 |
| 状态与时间版本混用 | player-status-session.test.ts：A→B→旧A、revision/分钟各自倒退、当前重复、缺失/非法→null→恢复、旧签名、实例隔离 | 通过 |
| 未确认值被当事实 | pending/解析拒绝或异常/超时、规则拒绝、执行异常/迟到结果保持；同一command对象重试，叙事不重复 | 通过 |
| 两入口与可用性 | final-2-status：各尺寸6组真实dist，旧入口/新建角初值，十项单位方向、键盘展开/收起、四动作、非法输入/恢复、双击、草稿与展开保留、无横溢出 | 通过 |
| null与小数UI | 同一status模式额外1组隔离浏览器组件，擦除源文件类型后加载空页面；不同值/小数/null/恢复、节点与焦点保留，无生产调试入口 | 通过（非dist端到端） |
| 旧入口/建角行为 | final-2-character各6组、final-2-search各12组，全部原回归保留 | 通过 |
| 权限与兼容 | 43份Core/旧测试/固定样本/配置blob与接收基线一致；game.test仅加入新DTO键；全部边界测试保留 | 通过 |

证据三套各61源码blob/3产物SHA256，截图12/10/26，verification.json逐一核对；查看360展开与恢复图。第一次UI RED为缺面板；隔离测试工具误用TS7旧API失败已留档，改用Node24类型擦除；实际截图发现焦点框压第一行，几何断言RED→8px间距GREEN。保留首次final证据，最终使用final-2。投影首次导入失败无用例运行；hp0行动夹具被原Core正确拒绝，动作夹具改存活值而边界投影仍测试0；撤销代理触发Array.isArray异常单独RED后修复。会话初始16失败/3通过，3个旧投影测试随后补明确B断言。不能声称49个新增用例逐项先RED。

未执行托管G1 CI、真手机/语音/屏幕阅读器、跨浏览器、长局性能、真实AI、磁盘断电恢复；当前仅内存/JSON重建，门缝/拾取/完整场景未完成。本次只读呈现无需新增Core事件或存档迁移。独立审查及最终交接范围检查在报告记录。

一次fresh-context独立审查无Critical/Important/Minor；实际读取源码/证据/360展开截图、范围diff exit0，未重复测试/构建/浏览器。五项明确边界裁定见docs/evidence/g1-007/implementation-review.md。候选完成待经理验收；最终交接提交完整范围检查随完成回报固定引用。


经理2026-10-24固定4162a3a独立通过458/458、typecheck/build、完整aedd4fc..4162a3a/工作树/暂存区diff检查；重建dist后Chrome360/1280状态各6生产组+1隔离组件组、建角各6、原search各12通过。六套61源码/3产物哈希及12/10/26图、43旧文件blob核对，查看窄屏展开/恢复。G1-007 accepted，详情docs/pm/reviews/G1-007-attempt-1.md；上文待经理验收为实施历史。G1完整Gate仍partial，G1-008门缝只是派单准备。


## O. G1-008 门缝独立视觉与注意（经理已验收）

源码a75b3a82ffd04dfddee6c6a57c8ef233c3200fc6；21文件579/579=458原有+101Core+20应用/会话；typecheck/no-cache/build exit0。G1 partial、latestSuccessfulGate G0、正式存档null。

| 风险/验收 | 实际证据 | 结果 |
|---|---|---|
| 虚构NPC/初始化行动 | door-observation/door-history：严格scope、真实单NPC、已知门与物理连接、ID/初始RNG/警觉/记忆；旧factory默认语义 | 通过 |
| 视觉失败阻止注意或共用随机 | 固定seed1/35/1472/2944/2976，显式v/e与最终RNG；none+noticed、shoes/noticed等四组合；技能独立与上下限/阈值 | 通过 |
| 失败/重试额外耗时耗随机 |15拒绝条件、抽样后事件ID冲突候选失败全快照identity不变、失败ID可重用、跨位置旧ID及参数/规则冲突 | 通过 |
| 注意只写文案或遗忘 | 真NPC警觉+10至100、首次记忆不覆写、声音事件来源、40次连续动作、none保留旧知识 | 通过 |
| 损坏历史被接受 |28初始化+37历史损坏：范围、引用、序号、前后警觉/RNG、两次样本、事件/知识、首次依据和孤立事件拒绝 | 通过 |
| 旧样本/混合恢复 |24步门缝/旧四动作逐步JSON重建，重试所有旧ID、人物/资源/知识/RNG一致；基线14Core生成旧建角固定样本与原样本可读 | 通过（内部JSON） |
| 泄密或陈旧投影 | door-game/session：五样本模板/冻结白名单、未知目标统一拒绝、按钮/三短句同命令、拒绝与超时迟到/同ID恢复、旧投影不回退门建议和状态 | 通过 |
| 真实生产UI | final-door-gap每尺寸10组，双入口、无自动行动、双击/held Enter、三文本/六拒绝/恢复、移动隐藏返回、旧搜索检查、状态资料及自由输入无横溢出 | 通过 |
| 旧界面回归 | 同一dist的status各6生产+1隔离组件组、character各6、search各12；仅把现已支持的旧拒绝探针观察门缝改为观察门缝并离开，保留全部断言 | 通过 |
| 来源绑定/旧行为 |四套72源码blob/3产物SHA256，26/12/10/26截图；35原文件blob未变，新增基线样本SHA与14旧Core provenance匹配 | 通过 |

真实过程：Core最初缺模块RED；初30通过后补历史/阈值回归，最终101新增。一次全套554/555失败因新建角样本放入旧顶层pre-character集合，移至独立子目录且字节/hash不改；旧测试未弱化。应用RED18失败/2通过；首全套577/579暴露空doorTargets改变旧解释器键白名单，空数组时省略可选字段后579通过。浏览器缺按钮RED后实现，最终四模式全通过。失败日志均保留，不能声称121新增用例逐项先RED。

原型数值未作平衡结论。静态技能/光照/NPC位置是本内部协议边界；未来动态演进须迁移历史依据。未运行托管G1 CI、真设备/语音/屏幕阅读器、跨浏览器、长局性能、真实模型、磁盘保存/断电恢复。最终审查、风险裁定和完整交接提交范围检查见报告。


一次fresh-context整段审查d0c1116..a75b3a8无Critical/Important/Minor，未重复测试/构建/浏览器；四项边界裁定均由实施者记录代价，见implementation-review.md与任务报告。候选完成待经理验收，最终交接提交完整范围检查随完成回报固定引用。

经理在d3681ad独立验收通过：579/579、typecheck/build与完整范围检查；重建dist的Chrome360/1280四模式全部通过。状态模式6生产+1隔离组件组，其余门缝10/建角6/搜索12组。八套72源码/3产物证据及35旧blob、14基线来源一致。见docs/pm/reviews/G1-008-attempt-1.md。G1仍partial，G1-009拾取尚待实施，不预填验收。


## P. G1-009 单物品拾取与历史守恒（经理已验收）

源码57aa0cd30f6e29bc160c4dd3133ddc95725f259a；25文件683/683=579原有+74Core+30应用/会话。typecheck/no-cache/build exit0，G1partial/latestSuccessfulGate G0/schemaVersion null。

| 风险/验收 | 实际证据 | 结果 |
|---|---|---|
| 初态授权与旧语义 | pickup.test/history：新增scope合法未行动场景、旧door/newgame factory原义、初态不泄漏物品；19初始化损坏/晚插scope拒绝 | 通过 |
| 所有权与重量复制 | 同itemId/count1/weight0.05，position仅location→player、carryWeight0→0.05；其他属性/NPC/RNG不变；搜索和往返无重生、地面建议消失 | 通过 |
| 无效输入或重试奖励 | 未发现/暗处/远处/死亡、工具/参数/actor/revision/未知NPC目标等拒绝；同ID/跨地点/参数冲突；候选event冲突全快照identity保持且ID可用 | 通过 |
| 半转移/历史损坏 |34种损坏/中断（位置、负重、事件、来源、发现顺序、知识、重复转移、孤立新规则）；原创建属性仅被证明的负重例外 | 通过（内存/JSON） |
| 旧历史失效 |旧search/inspect用严格序号前缀所有权；24成功混合步骤（含一次拾取）每步JSON重建+所有旧ID重试、两个实例隔离/角色资料与资源守恒 | 通过 |
| 老样本 |递归旧固定样本均恢复、追加原观察与重试；新旧混合样本在改源码前由18基线Core文件生成并固定SHA，原文件不改 | 通过 |
| 隐私/库存DTO |19投影测试：新空/旧null、合法仅一条四字段、冻结复制、unknown/extra/accessor/继承/sparse/revoked/非法数量重量拒绝、旧回执当前库存 | 通过 |
| 会话状态 |11会话测试：按钮/三文本同世界、7类拒绝保留、pending/超时迟到/同ID确认、陈旧回复不回退/当前缺失或非法null/恢复、草稿和负重 | 通过 |
| 实际生产交互 |final-pickup每尺寸10组生产：两入口隐藏→发现→检查→双击/held Enter拾取→库存负重→重复拒绝→搜索往返门缝、全部三文本、焦点/草稿/展开/无横溢出 | 通过 |
| UI不可用与恢复 |额外每尺寸1组隔离source组件null/empty/owned/null及展开保持，明确非dist玩法注入 | 通过 |
| 旧浏览器与哈希 |同dist门缝10、状态6生产+1隔离、建角6、搜索12各尺寸通过；五套87源码/3产物，90张最终图、42原blob/18旧Core来源核对 | 通过 |

真实失败过程：Core缺模块RED，初73/74失败因为测试在成功搜索后改暗光照，旧静态历史校验正确拒绝；暗场改为合法未行动场景，另断言变暗后旧历史拒绝。应用缺模块RED后30新增全通过。UI缺列表RED；随后双击焦点search，DOM trace显示检查按钮删除使scrollY减少46px；preventScroll单独无效，保留检查位置后第二次mousedown仍使焦点body；复用转场guard后窄屏/桌面通过。上述日志和trace原样保留，不能声称所有104新增用例逐项先RED。

状态提示原文断言同步“拾取会改变负重；当前尚未模拟生存消耗”，其余原测试不弱化；game.test仅新增两个成功DTO键。final-tests/final-typecheck是相同冻结源码的ui-tests/ui-typecheck-final日志副本，不声称独立重跑；build与五模式在固定源码提交后运行。

CORE-07这里只证明单空罐不重复出现，不等同柜中水/饮用/交易全流程。SAVE-01/03未通过：当前仍unavailableStorage，内存候选/JSON恢复不是磁盘断电恢复。未做依赖重装（未变）、托管G1 CI、真设备/语音/辅助技术、跨浏览器、长局性能或真实模型；源码审查与最终提交范围另见报告。


一次fresh-context整段审查无Critical/Important，一项历史校验长行维护性Minor延期；审查者独立范围diff exit0，未重跑测试/浏览器/看图/hash。全部六项边界裁定与代价见implementation-review.md和任务报告；候选完成待经理验收。最终完整交接范围检查随完成消息固定引用。

经理于2026-10-24固定3b7b352独立验收：683/683、typecheck/build、完整接收范围与工作树/暂存区检查通过；重建dist五模式在360/1280均通过，生产/隔离组件区别同上。十套87源码/3产物、180图、42旧blob/18来源核对，窄屏图已查看。详见docs/pm/reviews/G1-009-attempt-1.md。G1仍partial；G1-010居民楼呈现待派发，不预填通过。


## Q. G1-010 有依据的居民楼场景（经理已验收）

source322d2a5，base511c8ea；29文件751/751=683原行为+68新增，typecheck/build通过。最终结果docs/evidence/g1-010/final-2-*，完整逐条Gate与未实现项见gate-gap-audit.md，不能将本表代替G1通过。

| 验收 | 自动/生产证据 | 实际结论 |
|---|---|---|
| 初始场景/知识/范围 | building-scene.test36项含32损坏类型；只多一事件/一知识 | 有来源的两节点身份，未知规则/错序/晚插/来源缺失拒绝；无自动动作 |
| 24混合与兼容 | 同文件逐步JSON重建并重试所有旧ID，与旧pickup世界比较；base24Core生成8步已拾取样本 | 权属/负重/时钟/NPC/RNG/旧结果保留；JSON不是SAVE |
| 可见上下文 | building-game/session30项，presentation2项 | 四字段复制冻结、暗处真实、未知/继承/getter/代理/错位置null，旧版本/故障不回退，预览不建世界 |
| 双入口场景 | --building-scene每尺寸11生产+1隔离组件，18图 | 预览/取消/明确开始/开场/九类拒绝/旧六动作/库存/往返/历史/焦点与草稿通过 |
| 五旧模式 | pickup10+1隔离、door10、status6+1隔离、character6、search12各尺寸 | 行为断言保留；仅页面标题因真实新标题同步，原失败证据保留 |
| 来源一致性 | verification.json/log | 六套97源码blob/3产物、108图、38旧测试/样本blob、24Core来源与样本SHA核对；看两张窄屏图 |
| 门禁诚实性 | gate-gap-audit.md | UI-03未实现；广义自由语言/CORE-06/07具体对象partial，CORE-03/08未实现；G1仍partial |

初次模块缺失RED不算所有断言已逐项失败。实际UI场景缺失RED；最终首轮search因旧标题断言失败，保留防注入其余断言后六模式重新通过。源码测试/类型日志为ui-suite/ui-typecheck；final-build与六模式为最终产物实际运行，没有伪造重复独立证据。

未执行依赖重装（未变）、托管G1 CI、真实手机/语音/辅助技术/跨浏览器/长局性能、真实模型或磁盘恢复；内部g0-world-v1向前扩展，正式schema null。独立审查见implementation-review，最终交接SHA与完整范围检查在完成消息固定。

经理2026-10-24固定0d8a74e独立通过751/751、typecheck/build、完整511c8ea..0d8a74e/工作树/暂存区检查；重建dist六模式双尺寸通过，生产与隔离范围同上。12套97源码/3产物、216图、38旧测试样本与11额外文件、24基线来源匹配，窄屏图已查看。G1-010 accepted，见docs/pm/reviews/G1-010-attempt-1.md；UI-03下一切片G1-011尚未实现，G1仍partial。

## R. G1-011 可见结果叙事守卫（经理已验收）

- UI-03当前有限合同：原模板/受控换行完整匹配；只读复制DTO；拒绝虚构武器/人物/伤口/位移/时间/服从/隐藏身份/安全判断、跨结果/HTML/追加正文、形状/accessor/超长/空值。事实集合不由Narrator替换。
- 应用异步：默认250ms（可信配置1..1000），抛出/reject/永久等待安全退化；超时abort与清timer、晚成功/拒绝无覆盖、同ID/在途重复不重新调用。24步混合序列逐项比较真实Core世界/回执，含拾取、负重、门缝RNG/NPC和往返；不同请求延迟、短会话超时确认/下一步、双世界隔离。
- 31文件820/820（原751不改，新增54守卫+15应用/会话）通过；typecheck/build通过。最终源码71d20bd对应六套生产dist360/1280回归全部通过；各尺寸building11生产+1隔离、pickup10+1、door10、status6+1、character6、search12。独立隔离可信game→session→render本地替身各6组，8图，不等于生产provider接入。
- 证据docs/evidence/g1-011：typecheck/build/task-1-tests.log、各模式browser-results、isolated-final、verification；源码/产物与既有文件保护检查，两个窄屏图已查看。初始RED47失败/7通过证明旧实现忽略注入；一次测试夹具inventory字段纠正不改世界；初版隔离HTML缺CSS，已嵌入实际CSS后重跑最终隔离证据。独立最终审查及固定最终SHA见报告。
- Core/内部g0-world-v1/旧事件与正式schema null不变，无数据迁移。G1仍partial/G0；UI-03仅当前有限合同有证据，开放语言/具体未实现对象/G1 CI和稳定标签仍缺，详见本次gate-gap-audit；旧audit不改。

G1-011最终审查修复（b2333ac）：普通取消清理同步异常/异步拒绝由标准订阅包装隔离，原生signal身份/reason与移除/once语义保留；反例RED2失败后修复，Node布尔capture移除兼容反例RED1后改对象选项。最终31文件823/823（751+57+15）、typecheck/build、六套final-2双尺寸与隔离final-2各8组全部通过，共118最终图。旧820与初版目录是修复前历史，当前验收以tests-final.log/verification-final.json为准。唯一独立审查与全部十项裁定见implementation-review.md，修复后无二次审查，经理仍待验收。


经理2026-10-24固定3069aac独立通过31文件823/823、typecheck/build、完整738f6e1..3069aac/工作树/暂存区检查。重建dist六模式双尺寸通过，另本地替身隔离集成各8组；双方14套236图、100/96源码与3/2产物、94旧文件blob一致，经理看过两张窄屏恢复图，preview已停止。修复b2333ac经经理审查，无阻塞发现；见docs/pm/reviews/G1-011-attempt-1.md。G1-011 accepted仅限切片，完整G1仍partial；G1-012单动作语法未预填通过。

## S. G1-012 有限单动作组合语法（经理已验收）

| 验收 | 真实证据 | 结果/边界 |
|---|---|---|
| 六类结构及组合、完整消耗/取消 | local-intent-grammar.test.ts，66项 | 15RED/51先绿→66绿；前缀/目标/标点组合，旧823测试原样保留 |
| 唯一当前目标，不按顺序选中 | 同上 | 同名不同ID、重复同ID、跨类别/observe、指示词/点号歧义拒绝；正则元字符字面比较，view不读取 |
| 不代玩家决定/作弊/隐藏目标 | grammar + local-intent-session.test.ts | 否定/准备/愿望/条件/询问/引号/多动作/工具数量/修饰/ID/HTML/长输入拒绝；草稿、完整世界、时间、RNG、库存与历史不变，下一句可恢复 |
| CORE-01/12真实闭环 | session26项 | 两入口各24合法新文本，对照同种子同ID规范表达；完整世界/回执逐步相等，每步JSON重建后重试全部旧ID；双实例/pending/迟到/同ID确认 |
| 实际生产新文本 | free-text-final/browser-results.json | Chrome360×800/1280×900各14组，双入口六类/失效/恢复/单物品/焦点/未保存/双击/模拟IME/长输入，24截图 |
| 旧模式/叙事退化 | final-*与isolated | building12、pickup11、door10、status7、character6、search12各尺寸；building/pickup/status各含1隔离组件组。独立叙事隔离8组/尺寸；原108+10图 |
| 类型、构建、源码/归档身份 | final-types/build、task-2/3-tests及verification.json | 33文件915项，所有既有src除解释器及旧scripts/config受保护；dist与隔离产物SHA、Git归档HTML原字节及完整diff检查 |

首轮浏览器断言漏掉既有“废弃居民楼 · ”位置限定，实际页面正确；修正测试后两尺寸通过，失败日志及2张截图保留。日志只规范化行尾空格/终末换行，原始输出在ignored scratch；未弱化实际结果断言。

未执行新托管CI、真实provider/网络/凭据、真实设备/系统语音/IME、跨浏览器、长局性能、磁盘存档/断电恢复。JSON不是正式保存。G1保持partial/G0，具体未实现对象/完整适用矩阵/稳定标签见本单gate-gap-audit，待经理验收。


经理2026-10-24固定45c419f独立通过33文件915/915、typecheck/build与完整cfd5db4..45c419f/工作树/暂存区diff。重建dist新文本两尺寸各14组、六旧模式及叙事隔离各8组通过；双方16套284图、105/102/98源码、3/2产物及105旧blob一致，隔离归档字节核对、两张窄屏查看，preview已停止。详见docs/pm/reviews/G1-012-attempt-1.md。G1-012 accepted；CORE-03具体攻击意图仍未实现，下一G1-013补此最小缺口，完整G1继续partial。


## T. G1-013 攻击声明非执行意图（候选交付）

| 验收 | 证据 | 真实结果 |
|---|---|---|
| CORE-03有限类别与完整句 | unsupported-intent.test.ts，37项 | 10个组合/标点空白，取消优先；否定/准备/条件/引用/多动作/作弊拒绝；不读真实目标；旧6候选形状不变 |
| 非执行反馈与全部事实隔离 | unsupported-intent-session.test.ts，32项 | 两实际入口初始及搜索/门缝/拾取/移动后7句分别零派发、完整世界同引用、回执/全部投影/历史保持；命令ID连续，合法恢复 |
| 不可信输出/并发 | 同上 | 20坏形状、4accessor、普通冻结/非枚举数据、双世界、草稿编辑/pending、解析超时迟到、已提交同ID确认；不执行getter或由伤害/成功字段取得权限 |
| 授权旧预期变化 | local-intent.test.ts + verify.cjs | 保留“我精准击杀他”原列表及用例，唯一条件预期改为unsupported_intent/attack；逐字验证其余内容不变 |
| 生产反馈恢复 | unsupported-final/browser-results.json | Chrome360×800/1280×900各8组，两入口七声明/11普通拒绝族、真实动作后保持/恢复、焦点/未保存/无攻击按钮，12图 |
| 既有生产/隔离回归 | free-text-final、final-*、isolated | 新文本14，building12/pickup11/door10/status7/character6/search12，叙事隔离8组每尺寸；前三相关组件隔离性质不变；共154最终图 |
| 类型/构建/测试/归档 | task1-red/green、task-1/2-tests、final-types/build、verification.json | 聚焦20RED/79先绿→99绿，全套35文件984；106旧blob、9套来源产物、唯一旧断言及isolatedHTML工作区/Git归档核验 |

范围只补CORE-03的有限非执行攻击意图，不是战斗/命中/伤亡。CORE-06/07/08具体对象、完整G1适用矩阵/演示/CI/标签仍待经理审查。无正式存档或真实模型、真设备/系统IME语音、跨浏览器/长局性能通过声明。初次生产全部通过，无浏览器失败被省略；聚焦失败日志原文保留（仅行末格式规范化）。


经理2026-10-24固定20d528b独立验收G1-013：984/35、typecheck/build及两尺寸新非执行意图/自由文本/六旧模式/叙事隔离通过；双方18套308图、106旧blob及唯一旧断言变化核验。见docs/pm/reviews/G1-013-attempt-1.md。仅有限非执行攻击类别accepted，完整G1继续partial；下一G1-014为柜子搜索/发现，不包含水的拾取与饮用。


## G1-014 柜内瓶水的发现（candidate_complete，非完整Gate）

| 验证面 | 已运行证据 | 结论/边界 |
|---|---|---|
| 初始化/唯一资源/只知柜子 | cabinet-search、cabinet-compatibility，共58项 | 旧样本原样，严格scope/固定实体/引用/来源；不赋予水的知识 |
| 原子搜索/历史/重试 | 两入口各24步混合+每步JSON及所有旧ID重放；候选超限/冲突/资源篡改 | 首次发现保留；水一直count1/container；无磁盘崩溃恢复声明 |
| 可见/文本/会话 | cabinet-session13项 | 世界与按钮等价；隐藏数据隔离；在途/草稿/迟到/确认/双世界 |
| 实际生产/多按钮 | verify-cabinet-ui.cjs，Chrome156，360x800/1280x900两入口各7组 | 共每尺寸14组，含物理双击、按键重复、移走返还、拒绝喝水/取水、库存只含旧空罐 |
| 回归 | 原984测试未改；全套1055/38，typecheck/build0；十套生产/隔离final-2 | 原门缝/搜索双击丢焦RED已定位修复，旧脚本未改 |
| 来源/交付物 | docs/evidence/g1-014/verify.cjs | 104旧blob、117/112/108源码、3/2产物，170图、隔离Git字节匹配 |

源码7157db1；日志/失败与最终证据在docs/evidence/g1-014。各脚本在build/preview后写新目录，按报告命令复验，不覆盖历史。内部加法事件、旧程序不能读新记录；正式schema null/G1partial/G0。完整CORE-07还需水转移/防再生，CORE-06隐藏枪、CORE-08死亡NPC、完整G1矩阵/演示/托管CI/稳定标签均未通过。


经理2026-10-24固定966bffe独立验收G1-014：1055/38、typecheck/build及十套双尺寸生产/隔离回归均通过，来源/产物/104旧文件核对一致；见docs/pm/reviews/G1-014-attempt-1.md。仅发现前置accepted，CORE-07水拾取后不再生未通过，下一G1-015补齐；CORE-06/08、完整G1矩阵/演示/CI/标签仍待。


## G1-015 双物品转移与水不再生（本切片通过，完整Gate未通过）

| 验收 | 实际证据 |
|---|---|
| CORE07柜中同一水发现/拾取/再搜不刷新 | water-pickup/transfer-history；两入口×两顺序各24步、每步JSON重建并重试全部旧ID；实际水ID/数量/质量/首次来源不变 |
| 双物品/负重/原子失败/旧兼容 | 60新增Core历史测试；全部旧1055测试/样本原样；版本初始化/漏事件/伪造来源/重复/错序/候选超限及事件冲突拒绝 |
| 投影与异步/叙事 | 38新增inventory/session；双条严格白名单/异常属性拒绝、真实game、pending/编辑/超时迟到/同ID/旧回执/双世界/Narrator造物饮用降级 |
| 生产双入口/顺序与输入保护 | 新水24组/尺寸，旧柜子精确升级14组；物理双击/heldEnter、稳定节点、背包0.55kg、无再生/八拒绝/合法恢复；24+16图 |
| 其余回归 | unsupported8/free-text14/六旧12、11、10、7、6、12/隔离8组每尺寸；总11套194图 |

源码047a88c491bb23f0ac7d9ec8ed8acc9532345e41，no-cache1153/42、typecheck/build实际exit0。证据/真实数字退出码/源码blob/产物哈希见docs/evidence/g1-015；两张360图已查看。CORE07只对当前会话通过；SAVE/断电恢复未运行，CORE06隐藏枪/CORE08死亡NPC及完整G1矩阵/演示/CI/标签仍待。正式schema null。

G1-015经理验收（2026-10-24）：固定34a2def，独立1153/42、typecheck/build、十一套双尺寸生产/隔离全部通过；额外节点物理双击经理补证（两入口、两发现顺序、两尺寸）通过，关闭原报告的测试缺口。双方23套412图、130/124/120源码与3/2产物、108旧blob及全范围检查一致。CORE-07当前会话通过，完整G1仍partial；下一G1-016补具体隐藏枪CORE-06，CORE-08/演示/CI/标签仍待。详见docs/pm/reviews/G1-015-attempt-1.md；JSON重建不是正式存档。


## G1-016 NPC真实隐藏枪（当前场景通过，完整Gate未通过）

| 验收 | 实测证据 |
|---|---|
| CORE06真实隐藏所有权 | 一件固定NPC持有物/完整初始化来源；缺scope/NPC/item、错owner/字段、复制/静默转移、伪造知识反例拒绝 |
| 原世界不改变 | 两入口×两拾取顺序24步对比旧transfer全部领域/回执/RNG；每步JSON及全部旧ID重试；5door向量；旧1153原样 |
| 模型与玩家隔离 | 真实bootstrap/world证明有枪；game/session/IntentInterpreter/Narrator原始输入无秘密，同seed旧可见输出相等；恶意候选/叙事拒绝，用户原文保留 |
| 异步边界 | 门缝pending编辑/超时迟到/同ID确认/双世界，之后搜索拾取移动可继续，枪不变 |
| 真实生产页面 | hidden12组/尺寸20图；全visible/hidden DOM/data属性扫描，用户输入和精确背景值单独验证；两入口多次门缝/两物品/往返/六猜测拒绝/恢复 |
| 旧生产回归 | water24/cabinet14/unsupported8/free-text14/六旧12,11,10,7,6,12/隔离8/经理extra-node24组每尺寸；13套合计238图 |

最终工具fcbd3e5c4d65b3249d1eb11cdde6eb94482447ea，产品f98d71b；no-cache1219/44、typecheck/build0。初版隐藏DOM脚本把玩家隐藏建角预览文字当泄密，精确排除同一玩家原文后通过，产品未改；失败保留。两张360新图已查看。CORE08死亡NPC、完整G1矩阵/演示/托管CI/标签仍待；无真实模型/磁盘恢复/真设备/跨浏览器结论。

经理2026-10-24验收G1-016：固定edf8da9，独立1219/44、typecheck/build及隐藏枪/额外拾取双击双尺寸通过，44新图；复核13套同源既有证据，合计15套282图、131旧文件及隔离归档/全范围一致。CORE06当前场景accepted；下一G1-017补CORE08，完整G1矩阵/演示/托管CI/稳定标签仍待，正式存档null。详见docs/pm/reviews/G1-016-attempt-1.md。


G1-017当前静态CORE08：新生命状态/完整来源、dead门缝单视觉RNG且无察觉/警觉/主动声音；两入口两状态两拾取顺序24步JSON/allprior与alive旧领域差分，伪造历史/知识、真实AI原始输入及异步隔离有证据。54Core+16应用=1289/46、typecheck/build、15套双尺寸278图通过。CORE06/07保持；死者UI是独立真实产品组合，公共默认alive。完整G1矩阵/演示/CI/标签仍未通过，无正式存档/死亡过程/战斗/自治声明。

## G1-018 统一候选审计入口（2026-10-24）

G1-001～017经理已accepted。当前本地两次1289/46、类型/构建与两尺寸公共24行动演示通过，冻结514c2ad双平台CI各1289/46通过、本地候选标签及17原件恢复核验通过；完整G1仍由经理裁定，状态G1 partial/G0/schema null。详见[evidence/g1-018/gate-matrix.md](evidence/g1-018/gate-matrix.md)、[compatibility.md](evidence/g1-018/compatibility.md)、[demo.md](evidence/g1-018/demo.md)及verification.json。上述历史段落保留其当时范围，不能作为最新未实现列表。

CORE03有限攻击分类且不执行，CORE06真实隐藏枪，CORE07当前会话同瓶水不再生，CORE08静态有来源dead及真实门缝无主动反应；均不扩张为战斗/饮用/NPC自治。完整端到端的存读档归G2、生存喝水/第二天归G3、NPC对话/关系归G4，均not_implemented；没有以测试数量替代逐条门禁。

G1-018托管收尾：首轮769efcb/40043361701 Windows4超时，日志保留；仅CI显式单worker后新冻结514c2ad/40043786265双OS全部通过（Windows38.33s、Ubuntu56.58s）。本地默认2、5000ms、所有断言/样本/隔离未改。候选标签g1-candidate-514c2ad仅本地；最终执行树与CI相同，正式Gate及后续阶段待经理。

## G2-001 当前增量（待独立审查/经理验收）

正式codec1/32测试；可信应用11测试；完整1332/48、类型/构建通过。真实IndexedDB八组故障/恢复/并发验证，公共双尺寸各9行动与profile关闭重启、失败草稿保留；alive/dead/Narrator实际回归。详见docs/evidence/g2-001/verification.json及计划。SAVE03仅本单原子单槽故障注入范围通过，不冒称物理断电/强制进程终止；SAVE05只有当前格式拒绝保护，无历史正式版本迁移。其余完整G2责任保持未完成。


## G2-001 审查后最终候选

G2-001候选完成，待经理验收：唯一独立审查发现0 Critical、2 Important、1 Minor；两项Important经RED→GREEN修复。最终1333/48、类型检查、构建162模块通过；真实IndexedDB9组、两尺寸公共12动作（主页10+另一页2）/12图，alive/dead各28组及Narrator16组通过。完整G2仍partial，latestSuccessfulGate=G1，正式schema1。
证据 review-fix/verification.json（docs/evidence/g2-001）。补充高revision旧分支拒绝与坏上一备份不阻止好当前档；坏原件后续写仍保留。SAVE01/02/04/05的未交付范围不豁免；当前单槽通过不等于完整G2门禁。初始空槽跨页发现需刷新页面的Minor保留。无新宪章冲突。


## G2-002 当前三槽候选

G2-001已经理验收；G2-002三个手动槽候选通过1347/49、类型/构建、真实IDB16组和两尺寸三世界关闭重开，独立审查0严重/0重要/1延期Minor，待经理验收。完整G2仍partial/latestSuccessfulGate G1/schema1；SAVE04仍缺导入导出，SAVE01自动保存、SAVE02真实关系链、SAVE05迁移/失败原件导出仍待。
明确目标选择/列表刷新不读写世界或擦草稿；固定槽名确认、每槽绑定防切换刷新旧分支覆盖、坏槽隔离与原manual-1兼容均有实际用例。参见docs/evidence/g2-002/verification.json及audit.json；保存格式/Core/18份样本未改。

G2-003在途：SAVE01自动保存待实现/实测，不预记通过；G2-002三槽已accepted，完整G2仍partial。

## G2-003 SAVE01候选证据（2026-10-25，待独立审查/经理验收）

18新应用用例RED→GREEN；全套1365/50、typecheck/build通过。真实公共Chrome360/1280各12动作/7图：建角→手存开启→搜柜拾水→自动成功→关闭重开主动读档；固定槽/另存关闭/并发冲突恢复。隔离真实Application/UI/IDB各10组/9图：snapshot成功后abort/注入quota/AbortSignal取消均原子保留旧档及另外两槽；故障后一行动0重试、手存再启用恢复；延迟锁/草稿、叙事三降级、原ID/完整世界/下一RNG、超时迟到。旧三槽、手动、alive/dead、Narrator及IDB16组通过，116最终图。未测物理断电/强杀/真实满盘/真机/跨浏览器/长局。SAVE02关系链、SAVE04导入导出、SAVE05迁移及完整G2仍待。

G2-003最终独立审查完成：0严重/0重要/0新增Minor，独立30/30与源/产物/保护文件/归档核对通过。SAVE01切片candidate_complete待经理验收；完整G2仍partial，不豁免其他门槛。

## G2-004 只读原件下载候选（2026-10-25）

所选槽current经同一readonly事务读取；健康档通过原codec、坏/未来文本按原件备份，UTF8字节不重编码或修复。导出不含未保存内存，不更新绑定/badge/自动目标、不写数据库。下载桥只说已发起、浏览器确认，固定安全名/有限URL。全套1392/52、typecheck/build、两尺寸30真实文件与28导出图，以及旧116图回归、新原生6组/旧16组通过。证据docs/evidence/g2-004。正式v1/DB1及18旧样本不变，完整G2 partial；导入、迁移、关系链、世界历史仍待。尚待唯一独立审查及经理验收。

G2-004最终候选：唯一fresh审查0Critical/0Important/0新增Minor，独立27/27及1206源/138保护文件/18样本/30文件/3HTML/3dist核对通过。作者1392/52、类型/构建和双尺寸144图证据保持；待经理验收。完整G2仍partial，未豁免导入/迁移/关系链/世界历史。报告docs/pm/reports/G2-004-attempt-1.md。

## G2-005 有效v1到空槽（候选，2026-10-25）

显式选文件→严格UTF8/16MiB含边界/原codec→过滤摘要确认→事务内head键缺失才原子导入原文，成功不切换当前游戏。任意已有head（含坏/null/undefined）拒绝，保留原件；不改绑定/auto目标/草稿/世界。Blob读取无法强制停止，迟到结果丢弃；提交取消/超时不确定则提示主动检查，不报数据库未变。1418/54、typecheck/build165、新原生10组、真实两尺寸三世界关闭重开、12原文回下载及旧路径168图通过；证据docs/evidence/g2-005，尚待唯一审查/经理验收。完整G2 partial，覆盖/恢复/迁移/关系链/历史仍必需。

G2-005最终候选：唯一fresh审查0Critical/0Important/1措辞Minor，独立26/26及来源/保护/归档/产物核对通过，无产品修复。导入后未绑定世界的手动保存仍需原明确覆盖确认，不是立即冲突；导入不授予绑定，已绑定旧分支CAS保持。经理任务单措辞待经理验收解释，实施者未改任务单。完整G2仍partial；报告docs/pm/reports/G2-005-attempt-1.md。

## G2-006 健康槽明确替换（作者验收通过，2026-10-25）

有效v1文件先检查所选槽，健康已有档显示旧/新安全摘要与独立“确认替换存档槽 N”。确认绑定原token、previousToken和完整原文，事务中全部复查；冲突须重新选择检查。新文件原字节成为current，旧current成为previous，本次不删除旧previous/坏备份/孤立或共享快照。坏head/坏或未来current/缺快照拒绝；健康current加坏previous可替换且坏原件保留。成功不切游戏、不重新绑定、不把导入当成当前进度已保存；同槽旧binding保存冲突/auto失败暂停，另槽auto继续。之后须主动读取；未绑定普通保存仍要新的覆盖确认。尚无上一备份恢复按钮，后续普通保存仍按既有备份轮换，并非永久无限备份。

1432/55 no-cache、typecheck/build165、原生替换11组、双尺寸三槽替换/关闭重开/完整世界/旧回执/下一真实随机行动和14实际回下载通过；旧路径回归后共210通过截图、56下载。143保护文件含18旧样本不变，1655源记录无例外，109原字节归档核对。G2-005实际旧适配器三槽read/export及previous兼容验证通过。证据docs/evidence/g2-006。未做物理断电/真实满盘/真机/跨浏览器/长期性能/系统picker对话框实测，故障为原生事务注入。完整G2尚未通过。

复现：npm test -- --run --no-cache；npm run typecheck；npm run build；node scripts/verify-g2-replace-storage.cjs [新目录]；node scripts/verify-g2-replace.cjs [新目录]。浏览器脚本需已安装Playwright的PLAYWRIGHT_MODULE_PATH，旧回归命令见证据与报告；不改依赖或测试预算。

G2-006最终交付候选：唯一fresh审查1f4f1d3发现0Critical/1Important/0Minor，I1为提交结果未知仍沿用已保存肯定反馈；8反例和实际Chrome原生已提交/迟到oncomplete先失败后修复。最终产品f3da8a23d692c9545ea899e23d0d820eb92b3bb3，1440/55、typecheck/build165、重建产物双尺寸unknown/replace/import/auto故障88图/26下载通过。旧210图/56下载/audit.json保留为1f4f1d3证据，未冒称修复后全部重跑。final734源码记录/54归档核对通过，143保护及18样本不变。无二次审查或本单延期Minor，待经理验收；完整G2仍partial/G1/schema1。报告docs/pm/reports/G2-006-attempt-1.md，最终证据fix/audit.json。

## G2-007 上一备份明确恢复（作者验收通过，2026-10-25）

“检查上一备份”只读同槽head/current/previous；健康current或严格v1信封之后的checksum_mismatch/inconsistent_fields/invalid_world允许进入独立恢复确认，previous必须严格有效。未知/未来/invalid_format/缺current/非文本/坏head拒绝。确认绑定整个head与两份原文，事务精确CAS后add唯一新snapshot，previous原文成为新current、旧current成为新previous，全旧快照保留。不会切换当前世界或重绑，主动读取沿用丢弃确认。旧绑定保存冲突/auto下一次失败暂停，另槽auto保持；unknown/明确已知变化撤旧saved。检查成功所知current变化立即更新安全摘要，取消不撤回已知事实。

1468/56 no-cache、typecheck/build166、真实IDB10组、双尺寸各18检查/9下载/22图通过；三类允许损坏恢复后保留坏原件且正常读取带invalid_backup提示，未来/未知current即使备份有效也拒绝。真实重开完整世界/旧回执/RNG一致，真实已提交迟到通知unknown及双页竞争通过。旧存档、生命周期、叙事回归共计258图/74下载，2095源码记录无例外、145保护/18样本不变、138原件gzip核对；真G2-006旧adapter三槽读导及健康/损坏previous语义通过。证据docs/evidence/g2-007，待独立审查。

首轮full与Chrome并行时一旧hidden-item长序列5000ms超时（1467/1），原件保留；浏览器退出后原配置单独重跑1468/56通过，未改worker/隔离/超时/旧断言，也未据此断言唯一根因。无物理断电/真满盘/真机/跨浏览器/长期性能/系统picker声明。完整G2仍缺迁移/关系链/世界历史/完整门禁。原件保留不是永久无限备份，后续普通保存沿用旧轮换。

复现：npm test -- --run --no-cache；npm run typecheck；npm run build；node scripts/verify-g2-recovery-storage.cjs [新目录]；node scripts/verify-g2-recovery.cjs [新目录]，浏览器需已安装PLAYWRIGHT_MODULE_PATH。回滚只代码，不清库/删原件，正式schema1/DB1不变。

## G2-007最终候选（2026-10-26）

唯一审查0Critical/2Important/0Minor，I1失败备份检查残留saved与I2同token正文变化假saved均一次RED→GREEN修复。最终1482/56、typecheck/build166，native11含缺DB不创建及旧native16，受影响生产双尺寸222图/86下载通过；1740源/145保护/18夹具/137原始归档核对一致。原19f7bfb的1468/56、258图/74下载仍独立，不冒称全量旧浏览器在新产物重跑。完整G2 partial；报告docs/pm/reports/G2-007-attempt-1.md。

## G2-008 玩家可见世界记忆（作者验收，待独立审查/经理）

23新增测试覆盖0/1/20/21/40/41、10回执类型、18旧样本、当时水位置/门缝证据/隐藏字段隔离、失败叙事真实提交一次、重放拒绝不增、只读翻页、同saveId旧版本及不同内容会话隔离。最终 `npm test -- --run --no-cache` 1505/58，22.24s，typecheck/build168通过。

`verify-g2-history.cjs` 实际dist360×800/1280×900，各30检查/10下载/12图：24、21、25原始混合行动，两件拾取和移动，全页无漏；三个独立世界手存/自动/关闭重开，真实下载→空槽导入→load、previous旧版本→load。逐页安全DTO并全世界/journal/全部旧command回放/下一实际RNG比对；DB/head/snapshot字节、时间、RNG、选槽、草稿、auto在翻页时不变。坏/未来load拒绝、取消load、选槽/导入/恢复未load保持活动历史，新局空态。另隔离实际组件验证旧订阅迟到、换会话折叠、长文本与焦点、安全DOM；非生产注入。

旧手存10、槽21、auto12、auto故障10、导入15、恢复18、恢复反馈7、alive/dead各14、Narrator8组各尺寸通过。全部11套222图/62下载，1965源记录/203文件、151保护/18夹具、107原字节压缩归档核对；audit.json列出版本。旧原生存储复用G2-007最终b63dbf0的11+16组，只因存储/codec/Core原样，不冒称本单重跑；无旧协议迁移证明。

SAVE01/04/世界历史增量通过作者验证；SAVE02真实关系链和SAVE05实际旧schema迁移仍未完成，完整G2 partial。未做物理断电/真满盘/进程强杀/真机/跨浏览器/读屏/系统文件picker/长局压力/外部模型/托管CI。

G2-008最终候选：唯一fresh审查固定c0d59589eef25371677c3c8ead34bfa3634c256e发现0Critical/1Important/0Minor，I1延迟叙事期间新历史与旧saved并存；4应用反例与真实UI/nativeIDB隔离组合先RED后修复，新commit先通知未保存再发布历史，auto仍onSettled。最终产品e244b7abc484e845e9ed5c536258ab5269152f88，1510/59 no-cache24.87s/typecheck/build168；7套最终双尺寸112图/32下载，1201源记录/206文件/151保护/18夹具/61归档核对。原c0d5958的11套222图/62下载保留独立版本，不冒称全部新产物重跑；旧原生b63dbf0的11+16仍明确复用，无二次审查或延期Minor。完整G2仍partial/G1/schema1。


## G2-009 契约候选与 G2-008 验收同步（2026-10-26）

G2-008已由经理accepted（交接65fb077、产品e244b7a）；G2-009仅形成关系链/真实旧档迁移契约候选与ADR-035，协议决定待裁定，未实现新玩法或迁移。完整G2仍partial/latestSuccessfulGate G1/schema1。

[来源/完整G2矩阵](evidence/g2-009/gap-analysis.md)、[推荐契约](superpowers/specs/2026-10-26-g2-009.md)、[后续实施建议](superpowers/plans/2026-10-26-g2-009.md)。真实关系/SAVE-02和真实旧schema迁移/SAVE-05仍not_implemented；不是把关系整体延期G4。docs05伤亡保存口径仍待裁定。G2-008的1510/59、类型/构建/双尺寸是固定版本历史证据，本单未重跑；本单只核对未变产品的codec分类/恢复前置与221保护文件、18原样夹具。正式v1、DB1和现行核心契约不改；下一步仅经理审查/必要决定后唯一派单。

## G2-010 作者验收（2026-10-26，待独立审查/经理）

1632/67无缓存测试通过（原1510/59责任未改），typecheck含纯Core及build177通过；最终产物与公开浏览器hash匹配。新Core33、旧样本兼容19、codec17/事务preflight13、contact应用21/迁移flow16、下载桥1、真实生成样本2。真实Chrome360×800/1280×900各21组/8下载/7图，三满槽混合v1/v2、取消/升级、原件字节、关闭重开、回导/替换/另行load、21/40/41分页、静态dead/下一RNG通过。隔离真实UI/nativeIDB补8个延迟叙事/auto反馈及2个升级已提交但通知超时的unknown场景。原生迁移14/恢复11/替换11/导入10/导出6/三槽16组重跑通过。固定旧e244实际构建/adapter/UI拒绝v2读写替换恢复、exact导出、v1+v2previous警告和旧保存保归档通过。911源记录/68保护文件/18夹具/130原字节归档核对见audit.json。

保留失败：真实v2下载被旧文件名白名单拒绝，独立RED→v[12]修复GREEN；新v2样本误放src/tests令旧18样本扫描断言报22，已移到本单evidence/fixtures，旧断言及原件不改。未测物理断电/真满盘/强杀恢复/真机/跨浏览器/读屏/系统picker/长局压力；未跑托管CI或打标签。完整G2仍partial，混版恢复/全Gate待后续唯一单。

复现：npm test -- --run --no-cache；npm run typecheck；npm run build；node scripts/verify-g2-contact.cjs [新目录]；node scripts/verify-g2-migration-storage.cjs [新目录]；node scripts/verify-g2-contact-feedback.cjs [新目录]；node scripts/verify-g2-migration-feedback.cjs [新目录]；node scripts/verify-g2-contact-old.cjs [新目录] [真实v2样本路径]。浏览器脚本需已安装的PLAYWRIGHT_MODULE_PATH，profile与原件不清理。

G2-010最终候选：产品990a930；1632/67与真实浏览器验收通过，唯一审查0Critical/0Important/1Minor，原verdict With fixes。M1原件列表在行动后需重新列出才可下载，原文无损，按inline规则延期，待经理裁定/唯一修复派单；不得写成已修复或无缺陷通过。完整G2partial/G1/formal2/DB1，报告docs/pm/reports/G2-010-attempt-1.md。


## G2-010 attempt2 · SAVE-05原件下载M1修复候选（2026-10-26）

经理退回attempt1后，本轮先2个单测RED和旧产物真实浏览器RED，再最小修复：真实新revision/成功保存立即撤销原件选择并提示重新列出，空选择禁用下载；拒绝/同ID重放不误失效，原上下文保护不撤。聚焦36/36（新增20）、完整默认无缓存1652/67、typecheck/build177通过。实际dist360×800/1280×900覆盖导入v1→升级→另行load→选归档→行动→明确失效→键盘重新列出→真实下载；手动/auto/拒绝输入后共8份下载SHA与原v1一致，下载前后DB/时钟/草稿/save/auto反馈不变。迟到list/export/prepare、取消/切槽/换会话/读取/超时恢复/重复点击由真实controller聚焦测试覆盖；prepare迟到释放不启动。延迟叙事8/升级已提交unknown2实际组件原生IDB重跑。

53 Core/adapter、68保护文件、18旧夹具、130历史归档核对；原生68组及固定旧产品兼容沿用前次证据，未重跑。报告docs/pm/reports/G2-010-attempt-2.md，证据docs/evidence/g2-010-attempt-2。M1作者修复候选不代表整单或完整G2通过；Gate仍partial/G1，协议不变。复现：npm test -- --run --no-cache；npm run typecheck；npm run build；node scripts/verify-g2-original-selection.cjs [新目录]；node scripts/audit-g2-original-selection.cjs。

## G2-011 作者验收（2026-10-27，待独立审查/经理）

新增32纯映射/9存储preflight/14应用测试，原1652/67原样保留；最终1707/70 no-cache31.17s、类型含纯Core、build178通过。混版原生25+旧迁移14+普通恢复11+替换11+导入10+导出6+三槽16=93组在当前代码重跑。实际生产两尺寸各7检查7下载5图，固定旧程序新增边界1下载1图；直接实际下载文件回导各3检查3下载1图；隔离真实UI/nativeIDB的混版已提交unknown两尺寸通过。M1真实dist8下载、延迟叙事8与旧升级unknown2重跑。

审计scripts/audit-g2-mixed-recovery.cjs核对14标签对应原文、76保护文件、18旧样本和源码/产物。失败记录全部保留；测试驱动等待auto ready的修正不改产品超时，审计可选vite配置缺失修正不改产品。无物理断电/真满盘/强杀/真机/跨浏览器/读屏/系统picker/长局压力/外部模型/托管CI或Gate通过声明。复现命令和精确归档见本单报告。

G2-011最终候选补记：1707/70 no-cache30.01s，唯一独立审查0Critical/0Important/0Minor通过；无须修复，无第二审查。产品f3f17ae，报告docs/pm/reports/G2-011-attempt-1.md，经理验收仍待，完整G2partial/G1。此前“待审查”段落为作者验收时点记录，历史证据保留。

## 被替换的历史摘要（G2-009时点，保留原文）

> 最新Gate事实（2026-10-26）：G2-008已由经理accepted（交接65fb077、产品e244b7a）；G2-009仅形成关系链/真实旧档迁移契约候选与ADR-035，协议决定待裁定，未实现新玩法或迁移。完整G2仍partial/latestSuccessfulGate G1/schema1。

# 02 · 自由行动协议与判定管线

> 当前事实入口（2026-10-27）：G2-010/011均已经理accepted，仅切片；正式v2/DB1、严格v1兼容，完整G2仍partial/G1。下方日期段落保留当时验收状态；G2-012正在汇总阶段候选，不改变契约。

## 动作事务：唯一可信执行入口

所有 UI 点击、文本、语音、NPC 调度、随机事件触发都必须进入命令网关，不得直接改世界状态。

```text
输入 / 按钮 / 语音
  -> 意图解释器（模板/LLM，提出候选动作）
  -> 行动计划检查（歧义、长链/风险动作需确认）
  -> 规则网关（场景中对象是否存在、玩家是否具备条件）
  -> 规则裁决（时间、技能、状态、环境、随机数）
  -> 事件列表（仅结构化世界事实）
  -> 原子提交（状态和事件日志一致）
  -> 玩家知识更新（过滤秘密）
  -> 文本叙事/动态建议/可折叠状态
  -> 保存事务确认/失败提示
```

## 规范化命令模型（示例，不是已经实现的 API）

```json
{
  "commandId": "cmd-uuid",
  "actorId": "player-1",
  "source": "button|text|voice|scheduler",
  "verb": "observe",
  "targetIds": ["door-02"],
  "toolIds": [],
  "arguments": {"through": "door_gap", "careful": true},
  "utterance": "透过门缝观察",
  "expectedWorldRevision": 42
}
```

`source` 为互斥枚举中的某一个值；`verb` 要映射到**可注册、可测试、可版本化**的原语；`expectedWorldRevision` 用于阻止重复或过时操作。

## 动作原语注册表（从少到多增量实现）

- 感知：observe, listen, inspect, search
- 位移：move, enter, exit, sneak, flee
- 物品：pick_up, drop, equip, use, transfer, trade
- 生存：eat, drink, sleep, treat, rest
- 对人：talk, negotiate, threaten, recruit, attack, defend
- 环境：open, close, repair, dismantle, barricade, craft, build
- 车辆：inspect_vehicle, refuel, drive, repair_vehicle
- 社会：join_faction, leave_faction, assign_task, promise

**注册表只限定当前能自动判定的能力，不限定玩家能表达的行为。** 未覆盖行为可进入“组合已有原语 / 通用技能挑战 / 清楚告知暂不支持”三选一，不得编造已完成。

## 成功与暴露是不同维度

“透过门缝观察”至少有以下独立判定：

1. 门缝/光线是否允许观察；否 → 理由明确，时间可能少量消耗。
2. 可见区域和目标物有哪些；读世界真实位置而非现场生成新人物。
3. 玩家感知、视角、遮挡 → 获取到的线索强度。
4. 玩家潜行、动作噪音、NPC 警觉 → 是否被注意。
5. 形成 `TimeAdvanced`、`ObservationRecorded`、可能的 `NPCAlertnessChanged` 等事件。
6. 仅披露视觉/听觉支持的信息，不直接告诉 NPC 真实姓名、意图、秘密或掷骰结果。

## 通用判定规格

- 先检查前置条件，前置条件确定不成立时无需随机掷骰。
- 对不确定结果使用可注入 RNG；配置技能修正/时间/工具/环境。实际数值与难度曲线需通过测试确定，**不能随意宣称现实准确**。
- 区分事实性失败（门打不开）、资源性失败（缺工具）、概率性失败（打滑）、信息不足（听不清）、解析失败（动作意义不明确）。
- 一次提交多事件要原子化。失败也可能扣时间/体力/工具耐久，但必须先有事件记录。
- AI narration 严格基于 `VisibleOutcome`。若 AI 文本声称出现与事实冲突的新 NPC/物品/伤口，直接拒绝该文案并用安全模板代替。

## AI 权限矩阵

| 能力 | AI | 规则引擎 |
|---|---|---|
| 推荐行动按钮 | 可以提出 | 检查对象与可行性 |
| 解析玩家自由输入 | 可以提出意图 | 验证参数与权限 |
| 产生感官描述 / NPC 台词 | 可以 | 提供可见事实 / 叙事约束 |
| 改变背包、位置、生命、关系 | **禁止** | 唯一权威 |
| 决定 NPC 是否死亡 / 物品刷新 | **禁止** | 唯一权威 |
| 确定玩家能知道什么 | **禁止越权** | 可见性/知识过滤器 |
| 增加永久规则 | 只能建议 | 通过 ADR + 测试批准 |

## 反例

- 用户说“我杀了他” → 解释为 attack 意图；是否成功由世界裁决。
- 用户说“我要离开” → 仅宣告准备；不自动越过路线/守卫。
- 玩家点击“搜索柜子”两次 → 若物品已拿走，第二次不能再次收获同一瓶水。
- 语音识别错误导致“扔掉枪” → 高代价不可逆动作必须二次确认。

## G2-010 实现增补（2026-10-26，待经理验收）

仅 g2-world-v2 新增 talk-v1：verb=talk，targetIds=[当前已知地点]，toolIds=[]，arguments={topic:'greeting'}。自由输入“向周围打招呼”“向近处的人打招呼”与建议走同一网关；不自动移动或指定隐藏 NPC。合法新行动+1分钟/+1revision/0RNG，同ID完整请求重放无副作用。走廊同地且显式alive才可能回应；无NPC/dead/旧无life同样无回应。首次按历史警觉产生警告，第二次记录忽视警告，之后沉默。有限响应译文只给玩家听觉事实；关系数字/亲历记忆不交UI/AI。旧v1不能执行新语义。完整事件/参数/反例见[已批准契约](superpowers/specs/2026-10-26-g2-009.md)，实现src/core/contact*.ts及contact*.test.ts。动态伤亡仍未实现。

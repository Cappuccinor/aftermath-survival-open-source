# 03 · 世界数据模型、时钟与可见性

> 当前事实入口（2026-10-27）：G2-010/011均已经理accepted，仅切片；正式v2/DB1、严格v1兼容，完整G2仍partial/G1。下方日期段落保留当时验收状态；G2-012正在汇总阶段候选，不改变契约。

## 总体原则

- **权威世界状态 WorldState** 是结构化数据，与用户可读叙事分离。
- 实体必须使用稳定不可复用 ID；关键信息不可只记录为“那个人”“那把枪”。
- 多个玩家存档完全隔离，NPC、地图、资源不串档。
- 每次行动使用 `worldRevision` 乐观并发控制或等效串行执行；禁止双重扣减/奖励。

## 最小对象表

| 对象 | 必备信息 | 说明 |
|---|---|---|
| Campaign | saveId、schemaVersion、difficulty、seed、createdAt、gameClock、worldRevision | 根记录 |
| Player | playerId、身份背景、所在地 locationId、状态、技能、已知信息 ID | 玩家主体 |
| CharacterStats | hp、stamina、hunger、thirst、fatigue、mental、bodyTempC、infection、pain、carryWeightKg | 明确数值单位 |
| ItemInstance | itemId、typeId、owner/container/locationId、count、weightKg、durability、condition、metadata | 资源守恒 |
| Location | locationId、区域 ID、场景状态、邻接、光照、可见区域、被搜索标记 | 地图分层 |
| NPC | npcId、身份、职业、性格、能力、位置、需求、目标、恐惧、秘密、记忆、行动日程、状态 | 独立于玩家 |
| Relationship | observerId、targetId、trust、affinity、hostility、fear、dependence、loyalty、evidence | 关系基于事件 |
| Faction | factionId、成员、据点、库存、利益、对外关系、计划 | 非玩家阵营 |
| Base | baseId、位置、设施、耐久、安全、隐蔽、库存、成员、能源、消耗 | 真实地点实体 |
| Vehicle | vehicleId、位置、燃料、蓄电池、轮胎、发动机状态、载货、噪音 | 非无限耐用 |
| WorldEvent | eventId、seq、worldTime、type、actorId、targetIds、payload、visibility | 追加日志 |
| Knowledge | knowerId、factId、source、confidence、observedAt、expiresAt? | 人物知道什么 |
| Timer/Job | jobId、dueGameTime、type、params、owner、status | 长耗时行动与调度 |

## 属性取值约定（建议基线；实现前测试校准）

- hp / stamina / mental：0—100，越高越好。
- hunger / thirst / fatigue / infection / pain：0—100，越高越糟。
- bodyTempC：摄氏度，不能归一化后仍称为真实体温。
- carryWeightKg：千克，容量随装备/属性计算。
- 技能：0—100，不代表百分之百成功率。
- 关系尺度：0—100，需定义方向（trust 越高越信任，hostility 越高越敌对），不能把多个量直接机械相加。
- 角色创建时的技能起点与阈值不能乱设，应在数值平衡测试中锁定。

## 双时钟

1. `worldDay` 从**玩家生存第1天 08:00**开始。
2. `apocalypseDay` 从背景灾变**第30天**开始，初始与 worldDay 形成偏移。
3. `gameClock` 以分钟或秒的整数增量推进，展示时格式化。避免浮点累计误差。
4. 只有成功提交的时间消耗/世界调度推进会改变 gameClock。
5. 退出后默认暂停；若用户开启离线补算，单独记录 wallClock 及补算规则，不得混为一谈。

## 三层事实与知识

- **World Truth**：NPC 是否持枪、他是否藏粮、柜里还有多少东西，系统真实记录。
- **Actor Knowledge**：玩家/NPC 分别知道什么，知道的证据、可信度和时效。
- **Visible Presentation**：这次叙事/按钮允许显示给玩家的感官事实。

举例：NPC 确实藏着枪，门缝视线只及鞋子，则玩家不能看到“他藏了一把枪”；也不能让按钮生成“抢他的手枪”。

## 世界因果不变量

- 物品有唯一当前位置；物资转移符合守恒（明确的刷新、制作与损耗作为事件）。
- 死亡 NPC 不能正常移动/对话；“读取旧存档”属于玩家操作，不是剧情复活。
- 已被掏空的容器不会随叙事再次装满。
- 承诺、仇恨、交易影响 NPC 行动，但影响不应仅靠固定 +10 / -10。
- 天气改变光照、温度、移动条件等机制，不只改变文字皮肤。
- 随机事件来源于地点、世界阶段、既有实体和配置，不应为气氛无限刷危险。

## G2-010 实现增补（2026-10-26，待经理验收）

新增内部g2-world-v2与严格g0-world-v1判别联合。v2的relationships仅接受有因果的g2-contact-relation-v1（hostility20/40/60/80、stance及首末来源），npcMemories最多两条warning_given/warning_ignored亲历记录；逐事件历史重建校验，而非只验数值范围。三个NPCContact*事件有限开放对应NPC actor，其他旧actor约束不变；玩家听觉知识仍只有player knower。旧v1保持空关系、没有npcMemories和新事件。NPC既有kind/life/死亡来源不变，campaign.schemaVersion仍null。真实引擎生成的alive/dead样本及命令来源在docs/evidence/g2-010/fixtures；原18样本未改。

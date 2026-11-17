# 05 · 永久存档协议（V0.2 的核心交付）

> 当前事实入口（2026-10-27）：G2-010/011均已经理accepted，仅切片；正式v2/DB1、严格v1兼容，完整G2仍partial/G1。下方日期段落保留当时验收状态；G2-012正在汇总阶段候选，不改变契约。

## 目标

游戏退出、页面刷新、浏览器崩溃、设备重启后，能够恢复**玩家 + 世界状态 + 历史事件 + NPC 关系 + 随机数状态 + 游戏时钟**。支持至少 3 个独立存档槽、手动保存、自动保存、导出、导入和备份。

## 存档载荷

```json
{
  "format": "aftermath-save",
  "schemaVersion": 1,
  "gameBuild": "0.2.0",
  "saveId": "uuid",
  "savedAtUtc": "ISO-8601",
  "worldRevision": 42,
  "rngState": {"algorithm": "versioned-prng-v1", "state": "..."},
  "gameClockMinutes": 960,
  "worldState": {"...": "Player, NPC, Items, Locations, Factions, Jobs, Knowledge"},
  "eventJournal": [{"seq": 1, "type": "CampaignStarted"}],
  "checksums": {"state": "sha256-hash"}
}
```

这是**格式轮廓**而非可以直接使用的存档。具体字段必须由数据 schema 定义并测试。哈希只能检测损坏/意外修改，不代表能防恶意篡改。

## 提交流程

1. 校验命令；在内存生成 `nextState` 与事件日志增量。
2. 进行全部世界不变量校验。
3. 开启 IndexedDB 原子事务：将完整版本化快照/增量日志和元数据写入临时目标，成功才标记为最新可用 revision。
4. 确认写入成功后更新 UI 的“已保存”提示；失败则保留上一个有效存档，并告知玩家。
5. 定期生成稳定快照/备份；避免永久增长的全量事件日志导致读取过慢。

**不接受**“UI 看上去成功，但世界状态或日志没写进去”。

## 读档流程

`选择存档 -> 核对格式与校验 -> 检查 schema 版本 -> 可用迁移时先备份旧档 -> 读取完整 WorldState -> 验证世界不变量 -> 重建动态建议 -> 显示上一时刻摘要`。

不可识别的未来版本：只允许提示不兼容和导出原文件，不得用旧代码强行覆盖。

## 兼容升级

- `schemaVersion` 是独立字段，不能直接拿游戏版本号当存档版本。
- 每次涉及字段删除/意义改变/关系迁移，必须提供 `migrate(vN -> vN+1)` 与测试样本。
- 改变属性尺度，例如 hunger 从“高值好”改成“高值坏”，是**破坏性迁移**，必须 ADR 批准且自带旧档转换。
- 迁移必须支持失败回退和原档导出；禁止升级时自动重写唯一存档。

## 四类必测情况

1. 连续拾取与保存后刷新：数量完全一致，不双倍刷新。
2. NPC 受伤/敌对/死亡后保存读取：事件、关系和状态一致。
3. 写入中断模拟：要么恢复旧有效版本，要么恢复新完整版本，不能半成品。
4. 旧 `schemaVersion` 存档通过迁移恢复，无法迁移时保持原件不变。

## 隐私与设备现实

IndexedDB 不等于永久不可丢；用户清浏览器数据、系统卸载应用、设备损坏时都可能丢档。所以 V0.2 必须有可下载/可分享的存档导出文件和回导能力。云同步只能作为以后单独授权的可选模块。

## 2026-10-26 已批准的版本演进与阶段验收解释

依据ADR-035及用户“同意两项”，G2-010获准实现正式schemaVersion2/g2-world-v2与明确v1迁移，保留严格v1读取及完整current/previous原字节归档，升级后另行load；DB1/campaign.schemaVersion=null保持。当前批准不表示运行实现已完成，实际状态见PROJECT_STATE。原schema1轮廓和旧档语义继续保留。

四类必测第2项按阶段落实：G2必须验证真实敌意关系/记忆及已有静态死亡的完整存读；动态受伤/死亡过程仍未实现，随G3/G5相应机制实现时补齐事件持久化及故障恢复测试，G7全量回归。这些责任未删除或提前通过。未知未来版本拒绝并保留原件、升级不得自动重写唯一档等要求不变。

## G2-010 实现状态（2026-10-26，待经理验收）

已批准P1/P2第一切片现已实现：formal2/internalg2-world-v2，双版本严格读取，v1显式升级永久保留current/previous文本原件，另行load；DB1与campaign.schemaVersion=null不变。全部已有字段只按批准映射转换，旧ID和下一规则RNG保持。三满槽原位升级、归档字节碰撞/CAS/故障、实际下载回导与固定旧产品兼容见[evidence/g2-010](evidence/g2-010/audit.json)。既有静态死亡完整保存；动态受伤/死亡仍not_implemented，G3/G5机制与G7回归责任不变。专用混版previous转换恢复尚未交付，不能据本单宣布完整SAVE矩阵或G2门禁。

## G2-011 第二切片（2026-10-27，作者验收，待审查/经理）

上述G2-010的“混版尚未交付”为历史边界。本单实现仅v2 current + 健康v1 previous的明确转换恢复；current只允许健康或严格codec确认的checksum_mismatch/inconsistent_fields/invalid_world。未来/歧义/invalid_format及v1 current+v2 previous拒绝。previous完整纯映射为v2，候选重新生成并逐字节匹配；原current与previous文本永久保留，技术记录kind previous-v1-to-v2独立于旧升级记录，DB1/正式v2/严格v1不变。

确认前说明旧版本/时间、缺少后续进度、额外空间、保留双原件和另行读取。事务核对原双head/双原文、归档同key同字节后写新快照/记录再切head，previous指原current；不删除旧快照。取消/abort/quota无半成品，提交通知超时为unknown，不能报未写入或自动重试。恢复不切活动世界，不升级普通写/auto绑定。

实际三满槽、下载文件回导、关闭重开、全world/journal/旧command/下一RNG、静态dead、旧e244拒绝v2覆盖且三次旧保存保留新原件/技术键通过。混版前置指针构造明确为故障注入，不冒称自然UI生成。完整G2门禁、物理断电/真满盘/进程强杀与后续动态伤亡未通过或未执行。

G2-011最终候选补记：1707/70 no-cache30.01s，唯一独立审查0Critical/0Important/0Minor通过；无须修复，无第二审查。产品f3f17ae，报告docs/pm/reports/G2-011-attempt-1.md，经理验收仍待，完整G2partial/G1。此前“待审查”段落为作者验收时点记录，历史证据保留。

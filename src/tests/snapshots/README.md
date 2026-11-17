# 内部旧快照样本

两个 JSON 由接收基线 f28f6191cf9e58311b9e5e509050f1fcf4bb5fe6 的实际 Core 生成，不是新引擎动态生成的期望值。构建时提取当时 world/schema/events/rng/commands/engine/observation 原始模块，仅为 Node 原生 TS 加载给相对 import 加 `.ts` 后缀。

- g0-empty.json：createWorldState，seed=1、save-1/player-1/location-1、2026-10-23T00:00:00.000Z，原始空日志。
- g1-observe-v1.json：同一初始化，将测试地点光照设置为 1，再由旧 createEngine 执行 cmd-1 / observe / text / 无目标、工具、参数 / expectedWorldRevision=0。

这些是 g0-world-v1 的内部 JSON 样本，正式 schemaVersion=null，不是可导入的正式存档，也没有磁盘崩溃恢复能力。inspect.test.ts 验证旧样本原样重建与命令重试，新动作历史恢复另由混合 20 次序列验证。

import { expect, test } from 'vitest';
import { describeSceneContext } from '../ui/scene-context';
test.each(['room', 'corridor'] as const)('controlled %s text uses only known identity/connection and current light', locationRole => {
  for (const light of ['clear', 'dim'] as const) {
    const context = Object.freeze({ scene: 'abandoned-residential-building-v1' as const, locationId: 'private-id', locationRole, light });
    const text = describeSceneContext(context);
    expect(text).toContain(locationRole === 'room' ? '房门通向已知的相邻走廊' : '沿已知路线可以返回刚才的房间');
    expect(text).toContain(light === 'clear' ? '光线足够' : '光线不足');
    expect(text).not.toMatch(/private-id|空罐|无人|安全|鞋|衣料|枪|警觉|暴露|窗户|裂墙|气味|脚步/);
  }
});

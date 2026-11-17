import { getWorldTime } from '../core/world';
import type { WorldState } from '../core/world';
import type { VisibleClock } from './ports';

export function projectClock(world: WorldState): VisibleClock {
  const { worldRevision, gameClockMinutes } = world.campaign;
  const time = getWorldTime(gameClockMinutes);
  const hour = String(time.hour).padStart(2, '0');
  const minute = String(time.minute).padStart(2, '0');
  return Object.freeze({ worldRevision, gameClockMinutes,
    label: `生存第 ${time.worldDay} 天 · ${hour}:${minute} · 灾变第 ${time.apocalypseDay} 天` });
}

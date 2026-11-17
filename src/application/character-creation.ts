import { z } from 'zod';
import { initialCharacterStats, parseCharacterInput } from '../core/character';
import { freezeSnapshot } from '../core/schema';
import { characterFields, characterSkills } from './ports';
import type { CharacterCreation, CharacterCreationView, CharacterDraft, CharacterProfile, StartedGame } from './ports';

const stringFields = Object.fromEntries(characterFields.map(([key]) => [key, z.string()]));
const draftSchema = z.strictObject({ profile: z.strictObject(stringFields),
  skills: z.strictObject({ perception: z.string(), stealth: z.string(), survival: z.string() }) });
function decimal(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('年龄与技能须填写十进制整数');
  return Number(value);
}

/** Synchronous single-world ownership. Factories finish all initialization before installation. */
export function createCharacterCreation(factories: {
  create(input: CharacterProfile): StartedGame;
  prototype(): StartedGame;
}, startingPlace: 'room' | 'building-room' = 'room'): CharacterCreation {
  if (startingPlace !== 'room' && startingPlace !== 'building-room') throw new Error('Unknown starting place');
  let draft = freezeSnapshot({ profile: Object.fromEntries(characterFields.map(([key]) => [key, key === 'age' ? '25' : ''])),
    skills: { perception: '20', stealth: '20', survival: '20' } }) as CharacterDraft;
  let phase: CharacterCreationView['phase'] = 'editing';
  let preview: CharacterCreationView['preview'] = null;
  let started: StartedGame | null = null;
  let errors: readonly string[] = Object.freeze([]);
  const locked = () => phase === 'starting' || started !== null;
  const edit = () => { if (!locked()) { preview = null; errors = Object.freeze([]); phase = 'editing'; } };

  function install(factory: () => StartedGame): StartedGame | null {
    if (started) return started;
    if (phase === 'starting') return null;
    phase = 'starting'; errors = Object.freeze([]);
    try {
      const candidate = factory();
      // Installation changes this one authoritative application reference only after factory success.
      started = Object.freeze({ session: candidate.session, character: candidate.character ? parseCharacterInput(candidate.character) : null });
      phase = 'started'; return started;
    } catch {
      phase = 'error'; errors = Object.freeze(['未能开始，资料仍在。请重试或返回修改。']); return null;
    }
  }
  return Object.freeze({
    read: () => Object.freeze({ phase, draft, errors, preview, started }),
    update(input: CharacterDraft) {
      if (locked()) return;
      edit(); draft = freezeSnapshot(JSON.parse(JSON.stringify(input))) as CharacterDraft;
    },
    preview() {
      if (locked()) return;
      preview = null;
      try {
        const value = draftSchema.parse(draft);
        const character = parseCharacterInput({ profile: { ...value.profile, age: decimal(value.profile.age!) },
          skills: Object.fromEntries(characterSkills.map(([key]) => [key, decimal(value.skills[key])])) });
        preview = freezeSnapshot({ character, stats: initialCharacterStats, locationLabel: startingPlace === 'building-room' ? '废弃居民楼 · 房间' : '房间', clockLabel: '生存第 1 天 · 08:00 · 灾变第 30 天' });
        phase = 'preview'; errors = Object.freeze([]);
      } catch {
        phase = 'error'; errors = Object.freeze(['请检查资料：姓名 1–40 个字符，年龄 1–120 整数，其他文字各最多 240 个字符；三项技能各为 0–30 整数，总和不超过 60。草稿已保留。']);
      }
    },
    edit, cancel: edit,
    start() {
      if (started) return started;
      if (!preview || phase === 'starting') return null;
      const input = preview.character;
      return install(() => factories.create(input));
    },
    startPrototype: () => install(factories.prototype),
  });
}

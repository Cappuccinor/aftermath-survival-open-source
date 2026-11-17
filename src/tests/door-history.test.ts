import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../core/engine';
import { createDoorGame, createDoorPrototype } from '../core/door-prototype';
import { createSearchPrototype } from '../core/prototype';
import { readCharacterProfile } from '../core/character';
import { mutableJson } from './fixtures';
import { doorCharacter, doorCommand, doorFixture, doorMetadata, oldCommand } from './door-fixtures';

describe('G1-008: strict door history and compatibility', () => {
  it.each(['no-scope', 'no-npc', 'two-npcs', 'npc-kind', 'npc-extra', 'npc-location', 'npc-id', 'npc-appearance',
    'scope-version', 'scope-extra', 'scope-id', 'scope-type', 'scope-target', 'scope-private', 'scope-actor',
    'door-collision', 'npc-collision', 'rooms-equal', 'adjacency', 'route', 'initial-rng', 'initial-alertness',
    'scope-skill', 'scope-light', 'scope-fact', 'known-fact', 'initial-memory', 'fractional-alertness'])('rejects corrupt initialization: %s', mode => {
    const w = doorFixture(); const scope = w.eventJournal.find((e: any) => e.type === 'DoorGapInitialized');
    if (mode === 'no-scope') w.eventJournal = w.eventJournal.filter((e: any) => e !== scope);
    if (mode === 'no-npc') w.npcs = []; if (mode === 'two-npcs') w.npcs.push({ ...w.npcs[0], npcId: 'other' });
    if (mode === 'npc-kind') w.npcs[0].kind = 'g4-npc'; if (mode === 'npc-extra') w.npcs[0].secret = 'gun';
    if (mode === 'npc-location') w.npcs[0].locationId = 'prototype-location'; if (mode === 'npc-id') w.npcs[0].npcId = 'other';
    if (mode === 'npc-appearance') w.npcs[0].appearance = 'gun'; if (mode === 'scope-version') scope.payload.rule = 'door-gap-scope-v2';
    if (mode === 'scope-extra') scope.payload.secret = true; if (mode === 'scope-id') scope.eventId = 'other';
    if (mode === 'scope-type') scope.type = 'Other'; if (mode === 'scope-target') scope.targetIds.reverse();
    if (mode === 'scope-private') scope.visibility = 'public'; if (mode === 'scope-actor') scope.actorId = null;
    if (mode === 'door-collision') scope.payload.doorId = w.player.playerId;
    if (mode === 'npc-collision') { scope.payload.npcId = 'prototype-tin'; w.npcs[0].npcId = 'prototype-tin'; }
    if (mode === 'rooms-equal') scope.payload.corridorId = scope.payload.roomId;
    if (mode === 'adjacency') w.locations['prototype-corridor'].adjacentLocationIds = [];
    if (mode === 'route') w.eventJournal[0].payload.corridorId = 'other';
    if (mode === 'initial-rng') scope.payload.initialRng.state = 35;
    if (mode === 'initial-alertness') scope.payload.initialAlertness = 40;
    if (mode === 'scope-skill') scope.payload.perception = 30; if (mode === 'scope-light') scope.payload.corridorLight = 1;
    if (mode === 'scope-fact') w.knowledge.find((k: any) => k.factId.startsWith('known-door-')).source = 'false';
    if (mode === 'known-fact') w.player.knownFactIds = w.player.knownFactIds.filter((id: string) => !id.startsWith('known-door-'));
    if (mode === 'initial-memory') w.npcs[0].firstNoticed = { playerId: w.player.playerId, locationId: w.player.locationId, observedAt: 0, sourceEventId: 'imaginary' };
    if (mode === 'fractional-alertness') w.npcs[0].alertness = 30.5;
    expect(() => createEngine(w)).toThrow();
  });

  it.each(['visual', 'notice', 'visual-roll', 'notice-roll', 'one-draw', 'rng-before', 'rng-after', 'current-rng',
    'before-alert', 'after-alert', 'npc-alert', 'first-source', 'first-player', 'first-location', 'first-time', 'forgotten',
    'no-sound', 'no-notice-event', 'sound-cue', 'notice-amount', 'notice-actor', 'sound-npc', 'request-location', 'request-door',
    'request-revision', 'receipt-version', 'receipt-extra', 'time-version', 'knowledge-source', 'knowledge-expiry', 'lost-knowledge',
    'extra-knowledge', 'orphan-sound', 'orphan-notice', 'clock', 'scope-after', 'duplicate-command'])('rejects corrupt committed history: %s', mode => {
    const engine = createEngine(createDoorPrototype()); expect(engine.dispatch(doorCommand()).ok).toBe(true);
    const w = mutableJson(engine.snapshot()); const result = w.eventJournal.find((e: any) => e.type === 'DoorObservationRecorded');
    const notice = w.eventJournal.find((e: any) => e.type === 'NPCAlertnessChanged'), sound = w.eventJournal.find((e: any) => e.type === 'DoorReactionHeard');
    const r = result.payload, first = w.npcs[0].firstNoticed;
    if (mode === 'visual') r.visual = 'none'; if (mode === 'notice') r.noticed = false;
    if (mode === 'visual-roll') r.visualRoll = 0.99; if (mode === 'notice-roll') r.noticeRoll = r.visualRoll;
    if (mode === 'one-draw') { r.rngAfter.state = 270369; w.rngState.state = 270369; }
    if (mode === 'rng-before') r.rngBefore.state = 35; if (mode === 'rng-after') r.rngAfter.state = 35;
    if (mode === 'current-rng') w.rngState.state = 35;
    if (mode === 'before-alert') r.beforeAlertness = 40; if (mode === 'after-alert') r.afterAlertness = 50;
    if (mode === 'npc-alert') w.npcs[0].alertness = 30;
    if (mode === 'first-source') first.sourceEventId = sound.eventId; if (mode === 'first-player') first.playerId = 'other';
    if (mode === 'first-location') first.locationId = 'prototype-corridor'; if (mode === 'first-time') first.observedAt = 0;
    if (mode === 'forgotten') w.npcs[0].firstNoticed = null;
    if (mode === 'no-sound') w.eventJournal = w.eventJournal.filter((e: any) => e !== sound);
    if (mode === 'no-notice-event') w.eventJournal = w.eventJournal.filter((e: any) => e !== notice);
    if (mode === 'sound-cue') sound.payload.cue = 'gun-shot'; if (mode === 'notice-amount') notice.payload.toAlertness = 31;
    if (mode === 'notice-actor') notice.actorId = null; if (mode === 'sound-npc') sound.payload.npcId = 'other';
    if (mode === 'request-location') r.request.locationId = 'prototype-corridor'; if (mode === 'request-door') r.request.doorId = 'prototype-tin';
    if (mode === 'request-revision') r.request.expectedWorldRevision = 1; if (mode === 'receipt-version') r.rule = 'door-observe-v2';
    if (mode === 'receipt-extra') r.extra = true;
    if (mode === 'time-version') w.eventJournal.find((e: any) => e.type === 'TimeAdvanced').payload.rule = 'observe-v1';
    const fact = w.knowledge.find((k: any) => k.factId === 'door-observation-door-0');
    if (mode === 'knowledge-source') fact.source = sound.eventId; if (mode === 'knowledge-expiry') fact.expiresAt = 2;
    if (mode === 'lost-knowledge') { w.knowledge = w.knowledge.filter((k: any) => k !== fact); w.player.knownFactIds = w.player.knownFactIds.filter((id: string) => id !== fact.factId); }
    if (mode === 'extra-knowledge') { w.knowledge.push({ ...fact, factId: 'door-observation-forged' }); w.player.knownFactIds.push('door-observation-forged'); }
    if (mode === 'orphan-sound') w.eventJournal.push({ ...sound, eventId: 'orphan-sound' });
    if (mode === 'orphan-notice') w.eventJournal.push({ ...notice, eventId: 'orphan-notice' });
    if (mode === 'clock') w.campaign.gameClockMinutes++;
    if (mode === 'scope-after') { const scope = w.eventJournal.splice(2, 1)[0]; scope.worldTimeMinutes = 1; w.eventJournal.push(scope); }
    if (mode === 'duplicate-command') w.eventJournal.push(...w.eventJournal.slice(3).map((e: any) => ({ ...e, eventId: e.eventId + '-extra' })));
    w.eventJournal.forEach((e: any, index: number) => { e.seq = index + 1; });
    expect(() => createEngine(w)).toThrow();
  });

  it('rebuilds 24 mixed actions for a created character and retries all original requests from each location', () => {
    let engine = createEngine(createDoorGame(doorCharacter, doorMetadata));
    const untouched = createEngine(createDoorGame(doorCharacter, doorMetadata)), initial = engine.snapshot(), commands = [];
    for (let n = 0; n < 24; n++) {
      const phase = n % 8;
      const cmd = phase === 0 || phase === 3 ? doorCommand(n) : phase === 1 ? oldCommand(n, 'search', 'prototype-location')
        : phase === 2 ? oldCommand(n, 'inspect', 'prototype-tin') : phase === 4 ? oldCommand(n, 'move', 'prototype-corridor')
        : phase === 6 ? oldCommand(n, 'move', 'prototype-location') : oldCommand(n, 'observe', phase === 5 ? 'prototype-corridor' : 'prototype-location');
      cmd.actorId = doorMetadata.playerId;
      expect(engine.dispatch(cmd)).toMatchObject({ ok: true, replayed: false }); commands.push(cmd);
      const snapshot = engine.snapshot(); engine = createEngine(mutableJson(snapshot)); expect(engine.snapshot()).toEqual(snapshot);
      const before = engine.snapshot();
      for (const old of commands) expect(engine.dispatch(old)).toMatchObject({ ok: true, replayed: true });
      expect(engine.snapshot()).toBe(before);
      expect(before.campaign).toMatchObject({ worldRevision: n + 1, gameClockMinutes: n + 1 });
      expect(before.items).toEqual(initial.items); expect(before.player.stats).toEqual(initial.player.stats);
      expect(before.player.skills).toEqual(initial.player.skills); expect(readCharacterProfile(before)).toEqual(readCharacterProfile(initial));
    }
    expect(untouched.snapshot()).toEqual(initial); expect(engine.snapshot().rngState).not.toEqual(initial.rngState);
    expect(engine.snapshot().npcs[0]?.firstNoticed).not.toBeNull();
  });

  it('all fixed legacy samples still parse; baseline-created character retries and appends without introducing a witness', () => {
    for (const file of readdirSync('src/tests/snapshots').filter(f => f.endsWith('.json'))) {
      const input = JSON.parse(readFileSync(`src/tests/snapshots/${file}`, 'utf8'));
      expect(createEngine(input).snapshot()).toEqual(input);
    }
    const p = JSON.parse(readFileSync('docs/evidence/g1-008/legacy-provenance.json', 'utf8'));
    const bytes = readFileSync(p.file); expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.sha256);
    const engine = createEngine(JSON.parse(bytes.toString()));
    for (const cmd of p.requests) expect(engine.dispatch(cmd)).toMatchObject({ ok: true, replayed: true });
    const cmd = { ...oldCommand(4, 'observe', 'prototype-corridor'), actorId: p.metadata.playerId };
    expect(engine.dispatch(cmd).ok).toBe(true); expect(engine.snapshot().npcs).toEqual([]);
    expect(createEngine(mutableJson(engine.snapshot())).snapshot()).toEqual(engine.snapshot());
    expect(() => createEngine({ ...createSearchPrototype(), npcs: [{ arbitrary: true }] })).toThrow();
  });
});

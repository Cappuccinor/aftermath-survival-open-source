import { canonicalJSON, decodeSave } from '../../adapters/storage/save-format';
import { createEngine } from '../../core/engine';
import { visibleDoorTargets } from '../../core/door-observation';

export async function verifyDownloadedFile(text: string, original: string) {
  if (text !== original) throw Error('Downloaded original text changed');
  const saved = await decodeSave(text), reference = await decodeSave(original);
  const restored = createEngine(saved.worldState), uninterrupted = createEngine(reference.worldState);
  if (canonicalJSON(restored.snapshot()) !== canonicalJSON(reference.worldState)) throw Error('Full world lost');
  const door = visibleDoorTargets(reference.worldState)[0];
  const command = { commandId: 'cmd-export-next-rng', actorId: reference.worldState.player.playerId, source: 'button', verb: 'observe',
    targetIds: door ? [door.targetId] : [], toolIds: [], arguments: door ? { through: 'door_gap', careful: true } : {}, utterance: '', expectedWorldRevision: reference.worldRevision };
  const a = restored.dispatch(command), b = uninterrupted.dispatch(command);
  if (!a.ok || !b.ok || canonicalJSON(restored.snapshot()) !== canonicalJSON(uninterrupted.snapshot())) throw Error('Next RNG/full world differs');
  return { worldRevision: saved.worldRevision, eventCount: saved.eventJournal.length, fullWorldEqual: true, nextRngEqual: true };
}

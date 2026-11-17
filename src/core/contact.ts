import type { Command } from './commands';
import type { WorldState } from './world';
import { contactGroup, judgeContact } from './contact-model';
import type { ContactReceipt } from './contact-model';

export function createContactCandidate(world: WorldState, command: Command) {
  if (world.stateSchema !== 'g2-world-v2') throw Error('Contact requires v2');
  const receipt: ContactReceipt = { rule: 'talk-v1', commandId: command.commandId,
    request: { actorId: command.actorId, locationId: world.player.locationId, expectedWorldRevision: command.expectedWorldRevision, topic: 'greeting' },
    elapsedMinutes: 1, observedAt: world.campaign.gameClockMinutes + 1, committedRevision: world.campaign.worldRevision + 1,
    ...judgeContact(world.npcs[0], world.player.locationId, world.relationships[0]) };
  const group = contactGroup(receipt, world.eventJournal.length + 1, world.relationships[0]);
  const perception = group.perception && !world.player.knownFactIds.includes(group.perception.factId) ? group.perception : null;
  return { ...world,
    campaign: { ...world.campaign, gameClockMinutes: receipt.observedAt, worldRevision: receipt.committedRevision },
    relationships: group.relation ? [group.relation] : world.relationships,
    npcMemories: group.memory ? [...world.npcMemories, group.memory] : world.npcMemories,
    player: perception ? { ...world.player, knownFactIds: [...world.player.knownFactIds, perception.factId] } : world.player,
    knowledge: perception ? [...world.knowledge, perception] : world.knowledge,
    eventJournal: [...world.eventJournal, ...group.events] };
}

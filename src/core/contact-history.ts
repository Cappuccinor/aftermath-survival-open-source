import { contactCanonical, contactGroup, contactReceiptSchema, isContactEvent, judgeContact } from './contact-model';
import type { ContactMemory, ContactRelation, ContactWorld } from './contact-model';
import { doorScopeSchema } from './door-model';
import { movementReceiptSchema, routeSchema } from './movement';

function ensure(value: unknown): asserts value { if (!value) throw Error('Invalid contact history'); }
export function validateContactHistory(world: ContactWorld): void {
  if (world.stateSchema !== 'g2-world-v2') {
    ensure(!world.eventJournal.some(isContactEvent) && !world.knowledge.some(k => k.factId.startsWith('contact-heard-'))
      && !world.player.knownFactIds.some(id => id.startsWith('contact-heard-')));
    return;
  }
  const route = routeSchema.safeParse(world.eventJournal.find(e => e.eventId === 'evt-initial-route')?.payload);
  const door = doorScopeSchema.safeParse(world.eventJournal.find(e => e.eventId === 'evt-initial-door-gap')?.payload);
  let location = route.success ? route.data.roomId : world.player.locationId;
  let alertness = door.success ? door.data.initialAlertness : 0;
  let relation: ContactRelation | undefined;
  const memories: ContactMemory[] = [], perceptions = new Map<string, NonNullable<ReturnType<typeof contactGroup>['perception']>>();
  const commandIds = new Set<string>();
  for (let i = 0; i < world.eventJournal.length; i++) {
    const event = world.eventJournal[i]!;
    if (event.type === 'PlayerMoved') location = movementReceiptSchema.parse(event.payload).request.destinationId;
    if (event.type === 'DoorObservationRecorded') alertness = Number(event.payload.afterAlertness);
    if (event.type === 'TimeAdvanced' && event.payload.rule === 'talk-v1') {
      const receipt = contactReceiptSchema.parse(world.eventJournal[i + 1]?.payload);
      const npc = world.npcs[0] ? { ...world.npcs[0], alertness } : undefined;
      const expected = judgeContact(npc, location, relation);
      ensure(receipt.request.actorId === world.player.playerId && receipt.request.locationId === location
        && !commandIds.has(receipt.commandId) && receipt.committedRevision === receipt.request.expectedWorldRevision + 1);
      ensure(contactCanonical({ result: receipt.result, npcId: receipt.npcId, ...(receipt.alertnessBefore === undefined ? {} : { alertnessBefore: receipt.alertnessBefore }) }) === contactCanonical(expected));
      const group = contactGroup(receipt, event.seq, relation);
      ensure(contactCanonical(world.eventJournal.slice(i, i + group.events.length)) === contactCanonical(group.events));
      commandIds.add(receipt.commandId);
      if (group.relation) relation = group.relation;
      if (group.memory) memories.push(group.memory);
      if (group.perception && !perceptions.has(group.perception.factId)) perceptions.set(group.perception.factId, group.perception);
      i += group.events.length - 1;
    } else ensure(!isContactEvent(event));
  }
  ensure(contactCanonical(world.relationships) === contactCanonical(relation ? [relation] : []));
  ensure(contactCanonical(world.npcMemories) === contactCanonical(memories));
  const actual = world.knowledge.filter(k => k.factId.startsWith('contact-heard-'));
  ensure(contactCanonical(actual) === contactCanonical([...perceptions.values()]));
  ensure(world.player.knownFactIds.filter(id => id.startsWith('contact-heard-')).length === perceptions.size);
  for (const fact of perceptions.values()) ensure(world.player.knownFactIds.includes(fact.factId));
}

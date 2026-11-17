export const initialInput = {
  seed: 1,
  saveId: 'save-1',
  playerId: 'player-1',
  locationId: 'location-1',
  createdAt: '2026-10-23T00:00:00.000Z',
};

// Deliberately mutable external JSON, as at a future import boundary.
export function mutableJson(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

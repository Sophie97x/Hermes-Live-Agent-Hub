import assert from 'node:assert/strict';
import test from 'node:test';
import { destinationFor } from './agentRooms.js';
import {
  allocateStableSeats,
  applyReplayContext,
  currentLocationFor,
  isTemporaryAgent,
  placementsDiffer,
  prepareReplayEvents,
  resolveMovementOriginRoom,
  tempAgentLifecycleChanges,
} from './officeState.js';

test('only the backend subagent flag marks a temporary agent', () => {
  assert.equal(isTemporaryAgent({ id: 'temp-name', name: 'Temp agent' }), false);
  assert.equal(isTemporaryAgent({ id: 'worker', subagent: true }), true);
});

test('temporary roster changes retain the full arrival and departure snapshots', () => {
  const permanent = { id: 'friday', subagent: false };
  const leaving = { id: 'temp-a', subagent: true, room: 'coding', destination: [13, 22] };
  const arriving = { id: 'temp-b', subagent: true, room: 'research', destination: [40, 20] };
  const changes = tempAgentLifecycleChanges([permanent, leaving], [permanent, arriving]);
  assert.deepEqual(changes.arrivals, [arriving]);
  assert.deepEqual(changes.departures, [leaving]);
});

test('replay uses the latest events in chronological order regardless of input order', () => {
  const events = [
    { id: '3', agent: 'Atlas', kind: 'completed', timestamp: '2026-07-22T12:03:00Z' },
    { id: '1', agent: 'Atlas', kind: 'claimed', timestamp: '2026-07-22T12:01:00Z' },
    { id: '4', agent: 'Atlas', kind: 'review', timestamp: '2026-07-22T12:04:00Z' },
    { id: '2', agent: 'Atlas', kind: 'started', timestamp: '2026-07-22T12:02:00Z' },
  ];
  assert.deepEqual(prepareReplayEvents(events, 'Atlas', 3).map((event) => event.id), ['2', '3', '4']);
});

test('replay context cannot relocate a live agent', () => {
  const agent = { id: 'atlas', name: 'Atlas', status: 'idle', current_task: 'Taking a break' };
  const before = destinationFor(agent);
  const replayed = applyReplayContext(agent, {
    agent: 'Atlas', kind: 'started', task_title: 'Deploy backend system', timestamp: '2026-07-22T12:00:00Z',
  });
  assert.equal(replayed.status, agent.status);
  assert.equal(replayed.current_task, agent.current_task);
  assert.equal(destinationFor(replayed), before);
  assert.equal(replayed.replayTaskTitle, 'Deploy backend system');
});

test('stable seat allocation does not move incumbents when input order changes or an id is inserted', () => {
  const counts = { coding: 4 };
  const initial = allocateStableSeats([
    { id: 'bravo', room: 'coding' },
    { id: 'charlie', room: 'coding' },
  ], counts);
  const next = allocateStableSeats([
    { id: 'charlie', room: 'coding' },
    { id: 'alpha', room: 'coding' },
    { id: 'bravo', room: 'coding' },
  ], counts, initial);
  assert.equal(next.bravo.slot, initial.bravo.slot);
  assert.equal(next.charlie.slot, initial.charlie.slot);
  assert.notEqual(next.alpha.slot, next.bravo.slot);
  assert.notEqual(next.alpha.slot, next.charlie.slot);
});

test('preferred lounge seats override stale assignments without creating duplicates', () => {
  const result = allocateStableSeats([
    { id: 'alpha', room: 'breakroom' },
    { id: 'bravo', room: 'breakroom' },
  ], { breakroom: 3 }, {
    alpha: { room: 'breakroom', slot: 0 },
    bravo: { room: 'breakroom', slot: 1 },
  }, { bravo: 2 });
  assert.equal(result.bravo.slot, 2);
  assert.equal(result.alpha.slot, 0);
});

test('placement changes include seat changes, not only room changes', () => {
  assert.equal(placementsDiffer('coding', [13.2, 22.4], 'coding', [23.8, 22.8]), true);
  assert.equal(placementsDiffer('coding', [13.2, 22.4], 'coding', [13.2, 22.4]), false);
  assert.equal(placementsDiffer('coding', [13.2, 22.4], 'meeting', [38.3, 71.7]), true);
});

test('a new movement without an active route starts on its previous floor', () => {
  const floors = { coding: 'ground', breakroom: 'upper' };
  assert.equal(resolveMovementOriginRoom(null, undefined, 'breakroom', floors), 'breakroom');
  assert.equal(resolveMovementOriginRoom(
    { fromRoom: 'breakroom', toRoom: 'coding' },
    'ground',
    'breakroom',
    floors,
  ), 'coding');
});

test('live coordinates resolve to the visible room, corridor, or stairwell', () => {
  assert.equal(currentLocationFor('ground', [13.2, 22.4]), 'coding');
  assert.equal(currentLocationFor('ground', [42.5, 50]), 'corridor');
  assert.equal(currentLocationFor('ground', [90, 52]), 'stairs');
  assert.equal(currentLocationFor('upper', [29.5, 59]), 'breakroom');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { assignSeats } from './assignSeats.js';
import { CHARACTER_KEYS, characterKeyForAgent } from './characterAnims.js';
import { FLOOR1_ROOMS } from './floor1Rooms.js';
import { generateFloor } from './generateFloor.js';

test('idle agents appear on exactly one pixel-office floor', () => {
  const idleAgent = { id: 'idle-1', name: 'Idle Agent', status: 'idle' };
  const groundSeats = FLOOR1_ROOMS.map((room, index) => ({
    x: index * 32, y: 0, depth: 0, direction: 'down', room: room.id,
  }));
  const upperSeats = generateFloor('upper').seats;

  const ground = assignSeats(groundSeats, [idleAgent]);
  const upper = assignSeats(upperSeats, [idleAgent]);

  assert.equal(ground.placements.length, 0);
  assert.equal(ground.offFloorCount, 1);
  assert.equal(upper.placements.length, 1);
  assert.equal(upper.offFloorCount, 0);
});

test('character art remains stable when roster state or order changes', () => {
  const agents = [
    { id: 'alpha', name: 'Alpha', status: 'working' },
    { id: 'beta', name: 'Beta', status: 'idle' },
    { id: 'gamma', name: 'Gamma', status: 'waiting' },
  ];
  const original = Object.fromEntries(agents.map((agent) => [agent.id, characterKeyForAgent(agent)]));
  const reordered = Object.fromEntries([...agents].reverse().map((agent) => [
    agent.id,
    characterKeyForAgent({ ...agent, status: 'working', current_task: 'Changed task' }),
  ]));

  assert.deepEqual(reordered, original);
  Object.values(original).forEach((key) => assert.ok(CHARACTER_KEYS.includes(key)));
});

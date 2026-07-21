import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRoute,
  buildRoutePhases,
  buildWanderPhases,
  interpolatePath,
  interpolateRoute,
  isNearPoint,
  isOnStairs,
  OFFICE_PATH,
  pathLength,
  routeLength,
} from './pathfinding.js';

const groundNorth = {
  floor: 'ground',
  entry: { door: [17.5, 42.5], inside: [17.5, 39], axis: 'vertical' },
};
const groundSouth = {
  floor: 'ground',
  entry: { door: [42.5, 58], inside: [42.5, 61.5], axis: 'vertical' },
};
const upper = {
  floor: 'upper',
  entry: { door: [84.5, 52], inside: [81, 52], axis: 'horizontal' },
};

test('same-floor route crosses both room doors and central corridor', () => {
  const route = buildRoute([10, 50], [40, 82], groundNorth, groundSouth);
  assert.deepEqual(route[route.length - 1], [40, 82]);
  assert.ok(route.some(([x, y]) => x === 17.5 && y === 42.5));
  assert.ok(route.some(([x, y]) => x === 42.5 && y === 58));
  assert.ok(route.some(([, y]) => y === OFFICE_PATH.corridorY));
});

test('ground-to-upper route exits at the ground stair portal and enters upstairs once', () => {
  const phases = buildRoutePhases([10, 50], [28, 18], groundNorth, upper);
  assert.deepEqual(phases.map((phase) => phase.floor), ['ground', 'upper']);
  assert.deepEqual(phases[0].path.at(-1), OFFICE_PATH.stairPortal.ground);
  assert.deepEqual(phases[1].path[0], OFFICE_PATH.stairPortal.upper);
  assert.deepEqual(phases[1].path.at(-1), [28, 18]);
  assert.ok(phases[0].path.some(([, y]) => y === OFFICE_PATH.corridorY));
  assert.ok(phases[1].path.some(([x, y]) => x === 84.5 && y === 52));
});

test('upper-to-ground route changes floor only at the paired stair portals', () => {
  const phases = buildRoutePhases([28, 18], [40, 82], upper, groundSouth);
  assert.deepEqual(phases.map((phase) => phase.floor), ['upper', 'ground']);
  assert.deepEqual(phases[0].path.at(-1), OFFICE_PATH.stairPortal.upper);
  assert.deepEqual(phases[1].path[0], OFFICE_PATH.stairPortal.ground);
  assert.deepEqual(phases[1].path.at(-1), [40, 82]);
  assert.ok(routeLength(phases) > 0);
});

test('interpolation remains distance weighted and door proximity is bounded', () => {
  const route = [[0, 0], [3, 0], [3, 4]];
  assert.equal(pathLength(route), 7);
  assert.deepEqual(interpolatePath(route, 3 / 7), [3, 0]);
  assert.equal(isNearPoint([17.5, 45.5], [17.5, 42.5]), true);
  assert.equal(isNearPoint([17.5, 47.5], [17.5, 42.5]), false);
});

test('route interpolation exposes the floor of the active phase', () => {
  const phases = [
    { floor: 'ground', path: [[0, 0], [10, 0]] },
    { floor: 'upper', path: [[0, 0], [0, 10]] },
  ];
  assert.deepEqual(interpolateRoute(phases, 0.25, 1), {
    floor: 'ground',
    position: [5, 0],
    phaseIndex: 0,
  });
  assert.deepEqual(interpolateRoute(phases, 0.75, 1), {
    floor: 'upper',
    position: [0, 5],
    phaseIndex: 1,
  });
});

const breakroom = {
  floor: 'upper',
  spots: [[13, 22], [25, 22], [67, 76]],
  egress: [
    [[13, 33], [31, 33], [31, 52], [78, 52]],
    [[25, 33], [31, 33], [31, 52], [78, 52]],
    [[78, 76], [78, 52]],
  ],
};

test('wander between nearby seats trims the shared egress tail', () => {
  const phases = buildWanderPhases(breakroom, 0, 1);
  assert.equal(phases.length, 1);
  assert.equal(phases[0].floor, 'upper');
  const path = phases[0].path;
  assert.deepEqual(path[0], [13, 22]);
  assert.deepEqual(path.at(-1), [25, 22]);
  assert.ok(!path.some(([x]) => x === 78));
});

test('wander across the room keeps the shared junction exactly once', () => {
  const path = buildWanderPhases(breakroom, 0, 2)[0].path;
  assert.deepEqual(path.at(-1), [67, 76]);
  assert.equal(path.filter(([x, y]) => x === 78 && y === 52).length, 1);
});

test('wander to the same seat or an unknown seat stays put', () => {
  assert.deepEqual(buildWanderPhases(breakroom, 1, 1)[0].path, [[25, 22]]);
  assert.deepEqual(buildWanderPhases(breakroom, 0, 9), []);
});

test('isOnStairs matches the stair zone and rejects everything else', () => {
  assert.ok(isOnStairs(OFFICE_PATH.stairPortal.ground));
  assert.ok(isOnStairs([84.5, 32]));
  assert.ok(isOnStairs([98, 79]));
  assert.ok(!isOnStairs([84.4, 52]));
  assert.ok(!isOnStairs([50, 50]));
  assert.ok(!isOnStairs(null));
});

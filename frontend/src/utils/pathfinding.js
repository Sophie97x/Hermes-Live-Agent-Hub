// Shared route geometry for the full-floor photo maps. Coordinates are map percents.
// Room entry points live with room data in OfficeFloor so rendered doors and
// walking routes always use the same source of truth.

export const OFFICE_PATH = Object.freeze({
  corridorY: 50,
  stairPortal: Object.freeze({
    ground: [87, 52],
    upper: [87, 52],
  }),
  xScale: 1.5,
});

// Architectural collision lines traced from the two photo maps. Doorways are
// literal gaps in these spans, so every route is checked against the same wall
// geometry the agent sees rather than against a loose room bounding box.
const wall = (x1, y1, x2, y2) => Object.freeze([[x1, y1], [x2, y2]]);

export const OFFICE_WALL_CLEARANCE = 0.85;
export const OFFICE_WALLS = Object.freeze({
  ground: Object.freeze([
    wall(1.2, 1.2, 98.4, 1.2),
    wall(1.2, 1.2, 1.2, 96.2),
    wall(1.2, 96.2, 98.4, 96.2),
    wall(98.4, 1.2, 98.4, 96.2),
    wall(30.7, 1.2, 30.7, 42.5),
    wall(58.4, 1.2, 58.4, 42.5),
    wall(30.4, 59, 30.4, 96.2),
    wall(56.8, 59, 56.8, 96.2),
    wall(84.5, 1.2, 84.5, 42.5),
    wall(84.5, 59, 84.5, 96.2),
    // North room wall, split around the three glass doors.
    wall(1.2, 42.5, 12.3, 42.5),
    wall(22.7, 42.5, 37.2, 42.5),
    wall(47.8, 42.5, 64.1, 42.5),
    wall(74.9, 42.5, 84.5, 42.5),
    // South room wall, split around its three glass doors.
    wall(1.2, 59, 15.2, 59),
    wall(25.8, 59, 37.2, 59),
    wall(47.8, 59, 61.8, 59),
    wall(72.2, 59, 84.5, 59),
  ]),
  upper: Object.freeze([
    wall(1.2, 1.2, 98.4, 1.2),
    wall(1.2, 1.2, 1.2, 96.2),
    wall(1.2, 96.2, 98.4, 96.2),
    wall(98.4, 1.2, 98.4, 96.2),
    // Glass partitions have a shared circulation opening around y=59.
    wall(31.1, 1.2, 31.1, 51.8),
    wall(31.1, 65, 31.1, 96.2),
    wall(58.4, 1.2, 58.4, 51.8),
    wall(58.4, 65, 58.4, 96.2),
    // Stairwell wall, split around the open landing threshold.
    wall(84.5, 1.2, 84.5, 47.5),
    wall(84.5, 56.5, 84.5, 96.2),
  ]),
});

function segmentIntersectsRect(start, end, minX, minY, maxX, maxY) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let near = 0;
  let far = 1;
  const clips = [
    [-dx, start[0] - minX],
    [dx, maxX - start[0]],
    [-dy, start[1] - minY],
    [dy, maxY - start[1]],
  ];
  for (const [direction, distance] of clips) {
    if (Math.abs(direction) < 1e-9) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) near = Math.max(near, ratio);
    else far = Math.min(far, ratio);
    if (near > far) return false;
  }
  return true;
}

export function segmentCrossesWall(floor, start, end, clearance = OFFICE_WALL_CLEARANCE) {
  if (!Array.isArray(start) || !Array.isArray(end)) return true;
  return (OFFICE_WALLS[floor] || []).some(([from, to]) => segmentIntersectsRect(
    start,
    end,
    Math.min(from[0], to[0]) - clearance,
    Math.min(from[1], to[1]) - clearance,
    Math.max(from[0], to[0]) + clearance,
    Math.max(from[1], to[1]) + clearance,
  ));
}

export function routeCrossesWall(phases, clearance = OFFICE_WALL_CLEARANCE) {
  return (phases || []).some((phase) => (phase.path || []).some((point, index, path) => (
    index > 0 && segmentCrossesWall(phase.floor, path[index - 1], point, clearance)
  )));
}

export function distanceToSegment(point, start, end, xScale = OFFICE_PATH.xScale) {
  if (!Array.isArray(point) || !Array.isArray(start) || !Array.isArray(end)) return Infinity;
  const ax = start[0] * xScale;
  const ay = start[1];
  const bx = end[0] * xScale;
  const by = end[1];
  const px = point[0] * xScale;
  const py = point[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(px - ax, py - ay);
  const progress = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * progress), py - (ay + dy * progress));
}

function compactPath(points) {
  const kept = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last && Math.abs(point[0] - last[0]) <= 0.05 && Math.abs(point[1] - last[1]) <= 0.05) continue;
    kept.push(point);
  }
  return kept;
}

function projectToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return [...start];
  const progress = Math.max(0, Math.min(1, (
    (point[0] - start[0]) * dx + (point[1] - start[1]) * dy
  ) / lengthSquared));
  return [start[0] + dx * progress, start[1] + dy * progress];
}

// Join an arbitrary live position back onto a room's known egress network.
// This matters when an agent is rerouted mid-walk: a straight line to the
// Break Room door would otherwise cut through both glass partition walls.
function routeForKnownEgress(position, room) {
  if (!Array.isArray(room?.spots) || !Array.isArray(room?.egress)) return null;
  let best = null;
  room.spots.forEach((spot, routeIndex) => {
    if (!Array.isArray(room.egress[routeIndex])) return;
    const route = [spot, ...room.egress[routeIndex]];
    for (let index = 1; index < route.length; index += 1) {
      const projected = projectToSegment(position, route[index - 1], route[index]);
      if (segmentCrossesWall(room.floor, position, projected)) continue;
      const distance = Math.hypot(
        (position[0] - projected[0]) * OFFICE_PATH.xScale,
        position[1] - projected[1],
      );
      if (!best || distance < best.distance) {
        best = { distance, path: compactPath([position, projected, ...route.slice(index)]) };
      }
    }
  });
  return best?.path || null;
}

function roomToDoor(position, room) {
  const entry = room?.entry;
  if (!entry?.door || !entry?.inside) {
    throw new TypeError('Every office room needs an entry door and inside waypoint.');
  }
  // A live reroute can begin after the agent has already left its room. Keep a
  // point in the ground-floor corridor in that corridor instead of pulling it
  // back through whichever room happens to own the stale route metadata.
  if (
    room.floor === 'ground'
    && position[1] >= 42.5
    && position[1] <= 59
  ) {
    return compactPath([position, [position[0], OFFICE_PATH.corridorY]]);
  }
  const egressRoute = routeForKnownEgress(position, room);
  const alignment = entry.axis === 'horizontal'
    ? [entry.inside[0], position[1]]
    : [position[0], entry.inside[1]];
  return compactPath(egressRoute
    ? [...egressRoute, entry.inside, entry.door]
    : [position, alignment, entry.inside, entry.door]);
}

function sameFloorRoute(start, end, startRoom, endRoom) {
  const startLeg = roomToDoor(start, startRoom);
  const endLeg = [...roomToDoor(end, endRoom)].reverse();
  if (startRoom.floor === 'upper') return compactPath([...startLeg, ...endLeg]);
  return compactPath([
    ...startLeg,
    [startRoom.entry.door[0], OFFICE_PATH.corridorY],
    [endRoom.entry.door[0], OFFICE_PATH.corridorY],
    ...endLeg,
  ]);
}

function roomToStairs(position, room) {
  const leg = roomToDoor(position, room);
  if (room.floor === 'upper') {
    return compactPath([...leg, OFFICE_PATH.stairPortal.upper]);
  }
  return compactPath([
    ...leg,
    [room.entry.door[0], OFFICE_PATH.corridorY],
    OFFICE_PATH.stairPortal.ground,
  ]);
}

function stairsToRoom(position, room) {
  const leg = [...roomToDoor(position, room)].reverse();
  if (room.floor === 'upper') {
    return compactPath([OFFICE_PATH.stairPortal.upper, ...leg]);
  }
  return compactPath([
    OFFICE_PATH.stairPortal.ground,
    [room.entry.door[0], OFFICE_PATH.corridorY],
    ...leg,
  ]);
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
}

// A stroll between two seats of the same room. Both seats' egress lanes are
// joined at their first shared junction so the walk never detours through the
// room's far corner.
export function buildWanderPhases(room, fromIndex, toIndex) {
  const from = room?.spots?.[fromIndex];
  const to = room?.spots?.[toIndex];
  if (!from || !to) return [];
  const floor = room.floor || 'ground';
  if (fromIndex === toIndex) return [{ floor, path: [from] }];
  const out = Array.isArray(room.egress?.[fromIndex]) ? [...room.egress[fromIndex]] : [];
  const back = Array.isArray(room.egress?.[toIndex]) ? [...room.egress[toIndex]].reverse() : [];
  let junction = null;
  while (out.length && back.length && samePoint(out[out.length - 1], back[0])) {
    junction = out.pop();
    back.shift();
  }
  return [{
    floor,
    path: compactPath([from, ...out, ...(junction ? [junction] : []), ...back, to]),
  }];
}

export function buildRoutePhases(start, end, startRoom, endRoom) {
  if (startRoom.floor === endRoom.floor) {
    return [{ floor: startRoom.floor, path: sameFloorRoute(start, end, startRoom, endRoom) }];
  }
  return [
    { floor: startRoom.floor, path: roomToStairs(start, startRoom) },
    { floor: endRoom.floor, path: stairsToRoom(end, endRoom) },
  ];
}

// Backwards-compatible flattened route for diagnostics and same-floor consumers.
export function buildRoute(start, end, startRoom, endRoom) {
  return compactPath(buildRoutePhases(start, end, startRoom, endRoom)
    .flatMap((phase) => phase.path));
}

export function pathLength(path, xScale = 1) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(
      (path[i][0] - path[i - 1][0]) * xScale,
      path[i][1] - path[i - 1][1],
    );
  }
  return total;
}

// Distance-weighted interpolation keeps walking speed constant across route
// segments of different lengths.
export function interpolatePath(path, progress, xScale = 1) {
  if (!path || !path.length) return [0, 0];
  if (path.length < 2) return path[0];
  const clamped = Math.max(0, Math.min(1, progress));
  const total = pathLength(path, xScale);
  if (!total) return path[0];
  let remaining = clamped * total;
  for (let i = 1; i < path.length; i += 1) {
    const [x1, y1] = path[i - 1];
    const [x2, y2] = path[i];
    const segment = Math.hypot((x2 - x1) * xScale, y2 - y1);
    if (remaining <= segment) {
      const t = segment ? remaining / segment : 0;
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    remaining -= segment;
  }
  return path[path.length - 1];
}

export function routeLength(phases, xScale = OFFICE_PATH.xScale) {
  return phases.reduce((total, phase) => total + pathLength(phase.path, xScale), 0);
}

export function interpolateRoute(phases, progress, xScale = OFFICE_PATH.xScale) {
  if (!Array.isArray(phases) || !phases.length) {
    return { floor: 'ground', position: [0, 0], phaseIndex: 0 };
  }
  const clamped = Math.max(0, Math.min(1, progress));
  const lengths = phases.map((phase) => pathLength(phase.path, xScale));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) {
    const last = phases[phases.length - 1];
    return { floor: last.floor, position: last.path.at(-1) || [0, 0], phaseIndex: phases.length - 1 };
  }
  let remaining = clamped * total;
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    const length = lengths[index];
    if (remaining <= length || index === phases.length - 1) {
      return {
        floor: phase.floor,
        position: interpolatePath(phase.path, length ? remaining / length : 1, xScale),
        phaseIndex: index,
      };
    }
    remaining -= length;
  }
  const last = phases[phases.length - 1];
  return { floor: last.floor, position: last.path.at(-1), phaseIndex: phases.length - 1 };
}

export function isNearPoint(point, target, radius = 3.8) {
  if (!Array.isArray(point) || !Array.isArray(target)) return false;
  return Math.hypot(point[0] - target[0], point[1] - target[1]) <= radius;
}

export function isOnStairs(point) {
  return Array.isArray(point)
    && point[0] >= 84.5
    && point[0] <= 98
    && point[1] >= 32
    && point[1] <= 79;
}

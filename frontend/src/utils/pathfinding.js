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

function compactPath(points) {
  const kept = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last && Math.abs(point[0] - last[0]) <= 0.05 && Math.abs(point[1] - last[1]) <= 0.05) continue;
    kept.push(point);
  }
  return kept;
}

function routeForKnownSeat(position, room) {
  if (!Array.isArray(room?.spots) || !Array.isArray(room?.egress)) return null;
  const index = room.spots.findIndex((spot) => (
    Math.hypot(position[0] - spot[0], position[1] - spot[1]) < 2.6
  ));
  return index >= 0 && Array.isArray(room.egress[index]) ? room.egress[index] : null;
}

function roomToDoor(position, room) {
  const entry = room?.entry;
  if (!entry?.door || !entry?.inside) {
    throw new TypeError('Every office room needs an entry door and inside waypoint.');
  }
  const seatRoute = routeForKnownSeat(position, room);
  const alignment = entry.axis === 'horizontal'
    ? [entry.inside[0], position[1]]
    : [position[0], entry.inside[1]];
  return compactPath([
    position,
    ...(seatRoute || [alignment]),
    entry.inside,
    entry.door,
  ]);
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

const REPLAY_KINDS = new Set(['claimed', 'started', 'completed', 'blocked', 'failed', 'review']);

export function isTemporaryAgent(agent) {
  return agent?.subagent === true;
}

export function tempAgentLifecycleChanges(previousAgents, nextAgents) {
  const previous = new Map((previousAgents || [])
    .filter(isTemporaryAgent)
    .map((agent) => [agent.id, agent]));
  const next = new Map((nextAgents || [])
    .filter(isTemporaryAgent)
    .map((agent) => [agent.id, agent]));
  return {
    arrivals: [...next.values()].filter((agent) => !previous.has(agent.id)),
    departures: [...previous.values()].filter((agent) => !next.has(agent.id)),
  };
}

function timestampOf(event) {
  const value = Date.parse(event?.timestamp || '');
  return Number.isFinite(value) ? value : 0;
}

export function prepareReplayEvents(timeline, agent = 'all', limit = 30) {
  return [...(timeline || [])]
    .filter((event) => event?.agent && REPLAY_KINDS.has(event.kind))
    .filter((event) => agent === 'all' || event.agent === agent)
    .sort((left, right) => (
      timestampOf(left) - timestampOf(right)
      || String(left.id || '').localeCompare(String(right.id || ''))
    ))
    .slice(-Math.max(1, limit));
}

// Replay is a presentation layer over the live office. Historical task events
// do not contain a room or coordinate snapshot, so they must never rewrite the
// live status/task fields that destinationFor() uses for physical placement.
export function applyReplayContext(agent, event) {
  if (!event || agent?.name?.toLowerCase() !== event.agent?.toLowerCase()) return agent;
  return {
    ...agent,
    replayTaskTitle: event.task_title || '',
    replayKind: event.kind || '',
    replayTimestamp: event.timestamp || '',
  };
}

export function allocateStableSeats(items, spotCounts, previous = {}, preferred = {}) {
  const ordered = [...(items || [])].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const result = {};
  const taken = Object.fromEntries(Object.keys(spotCounts).map((room) => [room, new Set()]));

  const claim = (item, slot) => {
    const count = spotCounts[item.room] || 0;
    if (!count || !Number.isInteger(slot) || slot < 0 || taken[item.room]?.has(slot)) return false;
    taken[item.room].add(slot);
    result[item.id] = {
      room: item.room,
      slot,
      seatIndex: slot % count,
      overflow: Math.floor(slot / count),
    };
    return true;
  };

  // A deliberate lounge wander wins first, then an incumbent keeps its slot.
  for (const item of ordered) {
    const seat = preferred[item.id];
    if (Number.isInteger(seat) && seat >= 0 && seat < (spotCounts[item.room] || 0)) claim(item, seat);
  }
  for (const item of ordered) {
    if (result[item.id]) continue;
    const prior = previous[item.id];
    if (prior?.room === item.room) claim(item, prior.slot);
  }
  for (const item of ordered) {
    if (result[item.id]) continue;
    let slot = 0;
    while (taken[item.room]?.has(slot)) slot += 1;
    claim(item, slot);
  }
  return result;
}

export function placementsDiffer(previousRoom, previousPosition, nextRoom, nextPosition, tolerance = 0.05) {
  if (previousRoom !== nextRoom) return true;
  if (!Array.isArray(previousPosition) || !Array.isArray(nextPosition)) return false;
  return Math.hypot(
    previousPosition[0] - nextPosition[0],
    previousPosition[1] - nextPosition[1],
  ) > tolerance;
}

export function resolveMovementOriginRoom(active, sampleFloor, previousRoom, roomFloors) {
  if (active && sampleFloor && roomFloors?.[active.toRoom] === sampleFloor) return active.toRoom;
  return active?.fromRoom || previousRoom;
}

export function currentLocationFor(floor, position) {
  if (!Array.isArray(position)) return null;
  const [x, y] = position;
  if (x >= 84.5 && x <= 98 && y >= 32 && y <= 79) return 'stairs';
  if (floor === 'upper') return 'breakroom';
  if (floor !== 'ground') return null;
  if (y >= 42.5 && y <= 59) return 'corridor';
  if (y < 42.5 && x < 30.7) return 'coding';
  if (y < 42.5 && x < 58.4) return 'research';
  if (y < 42.5 && x < 84.5) return 'creative';
  if (y > 59 && x < 30.4) return 'operations';
  if (y > 59 && x < 56.8) return 'meeting';
  if (y > 59 && x < 84.5) return 'quality';
  return null;
}

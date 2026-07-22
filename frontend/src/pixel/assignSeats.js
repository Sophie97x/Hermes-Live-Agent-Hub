import { destinationFor } from '../utils/agentRooms.js';

// Seats agents on the current floor: each agent's canonical room
// (destinationFor) gets first claim on that room's own seats. If that room
// exists on this floor but every one of its seats is taken, the agent
// falls back to any other still-free seat here (Part B's "falling back to
// any free seat if that room is full"). But if the canonical room does not
// exist on this floor AT ALL, the agent gets no fallback seat here — their
// room genuinely lives on a different floor, so they are counted in
// `offFloorCount` instead of being dumped into an unrelated room, which
// would defeat the point of floors having distinct room rosters.
export function assignSeats(seats, agents) {
  const byRoom = new Map();
  seats.forEach((seat) => {
    const list = byRoom.get(seat.room);
    if (list) list.push(seat); else byRoom.set(seat.room, [seat]);
  });

  const used = new Set();
  const placements = [];
  const roomFullOverflow = [];

  agents.forEach((agent) => {
    const roomSeats = byRoom.get(destinationFor(agent));
    if (!roomSeats) return; // canonical room isn't on this floor at all
    const seat = roomSeats.find((candidate) => !used.has(candidate));
    if (seat) {
      used.add(seat);
      placements.push({ agent, seat });
    } else {
      roomFullOverflow.push(agent);
    }
  });

  roomFullOverflow.forEach((agent) => {
    const seat = seats.find((candidate) => !used.has(candidate));
    if (seat) {
      used.add(seat);
      placements.push({ agent, seat });
    }
  });

  return { placements, offFloorCount: agents.length - placements.length };
}

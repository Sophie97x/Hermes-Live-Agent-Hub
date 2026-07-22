// Generates the upper floor in code, in the same coordinate space as the
// real ground-floor map (1280x960, 32px tiles) so the scene's camera/bounds
// code does not need to know which floor is active.
//
// Unlike the first version of this file — which emitted three detached room
// boxes floating in the void — the upper floor is a single contiguous
// office: one carpeted building footprint, partitioned into rooms by
// interior walls, with a corridor running between the two room rows and a
// doorway from every room onto it. Nothing here is an island.
//
// Every furniture piece comes from `tilePalette.js`, which documents where
// each frame index was verified — nothing here invents a new tile index.
import {
  CHAIR_FRAME_BY_DIRECTION, DESK, FLOOR_TILE, PLANT, ROUND_TABLE, SERVER_RACKS, SOFA_3SEAT, WALL, WHITEBOARD,
} from './tilePalette.js';

const TILE = 32;

// The whole upper floor is one building. Rooms are carved out of this single
// footprint rather than each carrying its own floor patch, which is what
// makes the floor read as one office instead of separate blocks.
const BUILDING = { x1: 96, y1: 128, x2: 1184, y2: 800 };

// Horizontal corridor splitting the building into a top and a bottom row of
// rooms. Every room opens onto it, so the floor is fully walkable end to end
// — which also matters for the agent pathfinding still to come.
const CORRIDOR = { y1: 448, y2: 512 };

const DOOR_WIDTH = 2 * TILE;

function floorTiles(rect) {
  const tiles = [];
  for (let y = rect.y1; y < rect.y2; y += TILE) {
    for (let x = rect.x1; x < rect.x2; x += TILE) {
      tiles.push({ x: x + TILE / 2, y: y + TILE / 2, texture: FLOOR_TILE.texture, frame: FLOOR_TILE.frame });
    }
  }
  return tiles;
}

// A run of wall between two points, skipping any tile whose centre falls
// inside one of the `gaps` — that is how doorways are cut. Runs are either
// horizontal or vertical; diagonals are not a thing in a floor plan.
//
// Walls are two tiles tall (see tilePalette.js): a horizontal run draws a
// capped top row with a body row beneath it, using the left/right end
// variants so the run terminates cleanly; a vertical run draws the narrow
// single-column piece, capped once at the top.
function wallRun(x1, y1, x2, y2, gaps = []) {
  const tiles = [];
  const horizontal = y1 === y2;
  const blocked = (centre) => gaps.some((gap) => centre > gap.from && centre < gap.to);

  if (horizontal) {
    for (let x = x1; x < x2; x += TILE) {
      const cx = x + TILE / 2;
      if (blocked(cx)) continue;
      const end = x === x1 ? 'left' : (x + TILE >= x2 ? 'right' : 'middle');
      tiles.push({ x: cx, y: y1 + TILE / 2, texture: WALL.texture, frame: WALL.horizontal.top[end], depth: y1 });
      tiles.push({ x: cx, y: y1 + TILE + TILE / 2, texture: WALL.texture, frame: WALL.horizontal.body[end], depth: y1 + TILE });
    }
    return tiles;
  }

  for (let y = y1; y < y2; y += TILE) {
    const cy = y + TILE / 2;
    if (blocked(cy)) continue;
    const frame = y === y1 ? WALL.vertical.top : WALL.vertical.body;
    tiles.push({ x: x1 + TILE / 2, y: cy, texture: WALL.texture, frame, depth: cy });
  }
  return tiles;
}

// A doorway gap centred on a room's corridor-facing edge.
function doorGap(rect) {
  const centre = rect.x1 + (rect.x2 - rect.x1) / 2;
  return { from: centre - DOOR_WIDTH / 2, to: centre + DOOR_WIDTH / 2 };
}

function chair(x, y, direction, room) {
  return { x, y, depth: y, direction, room };
}

function chairProp(x, y, direction) {
  return { x, y, texture: 'chairs', frame: CHAIR_FRAME_BY_DIRECTION[direction] ?? CHAIR_FRAME_BY_DIRECTION.down, depth: y };
}

function desk(x, y, variant = 0) {
  return { x, y, texture: DESK.texture, frame: DESK.frames[variant % DESK.frames.length], depth: y + 64 * 0.27 };
}

function plant(x, y) {
  return { x, y, texture: PLANT.texture, frame: PLANT.frame, depth: y };
}

function roundTable(x, y) {
  return { x, y, texture: ROUND_TABLE.texture, frame: ROUND_TABLE.frame, depth: y };
}

function whiteboard(x, y) {
  return { x, y, texture: WHITEBOARD.texture, frame: WHITEBOARD.frame, depth: y };
}

// Each rack is a 2x2-tile stamp (see tilePalette.js), so successive racks
// are spaced 2 tiles apart along the row to avoid overlapping.
function serverRackRow(x0, y0, count) {
  const tiles = [];
  for (let i = 0; i < count; i += 1) {
    const rack = SERVER_RACKS[i % SERVER_RACKS.length];
    const x = x0 + i * TILE * 2;
    rack.tiles.forEach((t) => {
      const tx = x + t.dx * TILE;
      const ty = y0 + t.dy * TILE;
      tiles.push({
        x: tx, y: ty, texture: rack.texture, frame: t.frame, depth: ty,
      });
    });
  }
  return tiles;
}

function sofa(x0, y0) {
  return SOFA_3SEAT.tiles.map((t) => ({
    x: x0 + t.dx * TILE, y: y0 + t.dy * TILE, texture: SOFA_3SEAT.texture, frame: t.frame, depth: y0 + t.dy * TILE,
  }));
}

// Room rects tile the building exactly: three across the top row, two across
// the bottom, with the corridor between them. Shared edges are deliberate —
// neighbouring rooms sit wall-to-wall like a real floor plan.
const UPPER_ROOMS = [
  { id: 'creative', label: 'Design Studio', kind: 'desks', row: 'top', rect: { x1: 96, y1: 128, x2: 480, y2: CORRIDOR.y1 } },
  { id: 'breakroom', label: 'Break-out Lounge', kind: 'lounge', row: 'top', rect: { x1: 480, y1: 128, x2: 832, y2: CORRIDOR.y1 } },
  { id: 'quality', label: 'War Room', kind: 'war', row: 'top', rect: { x1: 832, y1: 128, x2: 1184, y2: CORRIDOR.y1 } },
  { id: 'server', label: 'Server Room', kind: 'server', row: 'bottom', rect: { x1: 96, y1: CORRIDOR.y2, x2: 544, y2: 800 } },
  { id: 'quiet', label: 'Quiet Room', kind: 'quiet', row: 'bottom', rect: { x1: 544, y1: CORRIDOR.y2, x2: 1184, y2: 800 } },
];

function furnishDesks(rect, roomId, furniture, seats) {
  furniture.push(whiteboard(rect.x1 + 160, rect.y1 + 64));
  furniture.push(plant(rect.x2 - 48, rect.y1 + 72));
  const positions = [
    [rect.x1 + 120, rect.y1 + 180], [rect.x1 + 264, rect.y1 + 180],
    [rect.x1 + 120, rect.y1 + 280], [rect.x1 + 264, rect.y1 + 280],
  ];
  positions.forEach(([x, y], i) => {
    furniture.push(desk(x, y, i));
    const seatY = y + 40;
    seats.push(chair(x, seatY, 'down', roomId));
    furniture.push(chairProp(x, seatY, 'down'));
  });
}

function furnishLounge(rect, roomId, furniture, seats) {
  furniture.push(...sofa(rect.x1 + 64, rect.y1 + 88));
  furniture.push(roundTable(rect.x1 + 176, rect.y1 + 232));
  furniture.push(plant(rect.x2 - 48, rect.y1 + 72), plant(rect.x1 + 48, rect.y2 - 64));
  seats.push(chair(rect.x1 + 144, rect.y1 + 232, 'right', roomId));
  seats.push(chair(rect.x1 + 208, rect.y1 + 232, 'left', roomId));
  seats.push(chair(rect.x1 + 176, rect.y1 + 292, 'up', roomId));
  furniture.push(chairProp(rect.x1 + 144, rect.y1 + 232, 'right'));
  furniture.push(chairProp(rect.x1 + 208, rect.y1 + 232, 'left'));
  furniture.push(chairProp(rect.x1 + 176, rect.y1 + 292, 'up'));
}

function furnishWarRoom(rect, roomId, furniture, seats) {
  furniture.push(whiteboard(rect.x1 + 96, rect.y1 + 64), whiteboard(rect.x1 + 216, rect.y1 + 64));
  const positions = [[rect.x1 + 112, rect.y1 + 232], [rect.x1 + 240, rect.y1 + 232]];
  positions.forEach(([x, y], i) => {
    furniture.push(desk(x, y, i));
    seats.push(chair(x, y + 40, 'down', roomId));
    seats.push(chair(x, y - 40, 'up', roomId));
    furniture.push(chairProp(x, y + 40, 'down'));
    furniture.push(chairProp(x, y - 40, 'up'));
  });
  furniture.push(plant(rect.x2 - 48, rect.y2 - 64));
}

function furnishServerRoom(rect, roomId, furniture, seats) {
  furniture.push(...serverRackRow(rect.x1 + 80, rect.y1 + 96, 3));
  furniture.push(desk(rect.x1 + 160, rect.y1 + 200));
  seats.push(chair(rect.x1 + 160, rect.y1 + 240, 'down', roomId));
  seats.push(chair(rect.x1 + 80, rect.y1 + 240, 'down', roomId));
  furniture.push(chairProp(rect.x1 + 160, rect.y1 + 240, 'down'));
  furniture.push(chairProp(rect.x1 + 80, rect.y1 + 240, 'down'));
  furniture.push(plant(rect.x2 - 48, rect.y2 - 64));
}

function furnishQuietRoom(rect, roomId, furniture, seats) {
  furniture.push(roundTable(rect.x1 + 176, rect.y1 + 152));
  furniture.push(plant(rect.x1 + 48, rect.y1 + 72), plant(rect.x2 - 48, rect.y2 - 64));
  seats.push(chair(rect.x1 + 176, rect.y1 + 112, 'down', roomId));
  seats.push(chair(rect.x1 + 176, rect.y1 + 192, 'up', roomId));
  furniture.push(chairProp(rect.x1 + 176, rect.y1 + 112, 'down'));
  furniture.push(chairProp(rect.x1 + 176, rect.y1 + 192, 'up'));
}

const FURNISHERS = {
  desks: furnishDesks,
  lounge: furnishLounge,
  war: furnishWarRoom,
  server: furnishServerRoom,
  quiet: furnishQuietRoom,
};

function buildUpper() {
  const furniture = [];
  const seats = [];
  const rooms = [];

  // One carpet under the whole building, so no room is visually detached.
  const floors = floorTiles(BUILDING);

  const topRooms = UPPER_ROOMS.filter((room) => room.row === 'top');
  const bottomRooms = UPPER_ROOMS.filter((room) => room.row === 'bottom');

  const walls = [
    // Building perimeter.
    ...wallRun(BUILDING.x1, BUILDING.y1, BUILDING.x2, BUILDING.y1),
    ...wallRun(BUILDING.x1, BUILDING.y2 - TILE, BUILDING.x2, BUILDING.y2 - TILE),
    ...wallRun(BUILDING.x1, BUILDING.y1, BUILDING.x1, BUILDING.y2),
    ...wallRun(BUILDING.x2 - TILE, BUILDING.y1, BUILDING.x2 - TILE, BUILDING.y2),
    // Corridor walls, one doorway per room.
    ...wallRun(BUILDING.x1, CORRIDOR.y1 - TILE, BUILDING.x2, CORRIDOR.y1 - TILE, topRooms.map((room) => doorGap(room.rect))),
    ...wallRun(BUILDING.x1, CORRIDOR.y2, BUILDING.x2, CORRIDOR.y2, bottomRooms.map((room) => doorGap(room.rect))),
  ];

  // Interior partitions between neighbouring rooms in the same row. The
  // first room's left edge is the building wall, so only the shared edges
  // from the second room onwards get a partition.
  topRooms.slice(1).forEach((room) => {
    walls.push(...wallRun(room.rect.x1, BUILDING.y1, room.rect.x1, CORRIDOR.y1 - TILE));
  });
  bottomRooms.slice(1).forEach((room) => {
    walls.push(...wallRun(room.rect.x1, CORRIDOR.y2, room.rect.x1, BUILDING.y2));
  });

  UPPER_ROOMS.forEach((room) => {
    FURNISHERS[room.kind](room.rect, room.id, furniture, seats);
    rooms.push({ id: room.id, label: room.label, rect: room.rect });
  });

  return {
    id: 'upper', label: 'Upper floor', floorTiles: floors, walls, furniture, seats, rooms,
  };
}

const GENERATORS = { upper: buildUpper };

export function generateFloor(floorId) {
  const build = GENERATORS[floorId];
  return build ? build() : null;
}

// Real, verified frame indices for the generated-floor furniture. Every
// number here was derived from the artist's own tileset usage, not guessed:
//
//  - "map.json usage": found by dumping map/map.json's Objects/Chair/
//    Computer/Whiteboard layers (gid minus the owning tileset's firstgid)
//    and reading off frames the artist already placed on floor 1.
//  - "visual grid crop": floor 1 has no server room, war room, sofa, or
//    round table, so there is no real usage to copy for those. For these,
//    the raw tileset PNG was cropped with a labelled 32px grid overlaid
//    (see the one-off script used during development) and read visually,
//    tile by tile, before picking a frame — not a blind index guess.
//
// Frame numbering: tileset image width / 32 = columns; frame = row * columns + col.

// Floor tile: FloorAndGround frame 411 (Ground tilelayer's most-used value,
// 235 of ~1200 cells — the plain grey carpet).
export const FLOOR_TILE = { texture: 'tiles_wall', frame: 411 };

// Walls are two tiles tall in this tileset: a capped top row over a body
// row. Frames read off a labelled grid crop of FloorAndGround rows 11-12,
// which is also where floor 1's own Wall objects come from (721 is its most
// common, 19 of 38 uses — the middle top cap).
//
// A horizontal run uses left/middle/right variants so its ends are capped;
// a vertical run uses the narrow single-column piece (723 over repeated
// 787), which is what the artist provides for wall stubs running away from
// the viewer. Drawing a vertical partition out of the horizontal middle
// tile instead renders as disconnected white stripes.
export const WALL = {
  texture: 'tiles_wall',
  horizontal: { top: { left: 720, middle: 721, right: 722 }, body: { left: 784, middle: 785, right: 786 } },
  vertical: { top: 723, body: 787 },
};

// Potted plant: Modern_Office_Black_Shadow frame 118, used twice in the
// real Objects layer.
export const PLANT = { texture: 'office', frame: 118 };

// Server racks: Modern_Office_Black_Shadow, 2-wide x 2-tall stamps (a first
// pass mistook these for six standalone 32x32 frames — a tight, high-scale
// grid crop of rows 23-25 showed each rack is actually a top pair over a
// bottom pair, the bottom carrying the red/green status-light detail). Not
// used anywhere on floor 1.
export const SERVER_RACKS = [
  { texture: 'office', tiles: [{ dx: 0, dy: 0, frame: 368 }, { dx: 1, dy: 0, frame: 369 }, { dx: 0, dy: 1, frame: 384 }, { dx: 1, dy: 1, frame: 385 }] },
  { texture: 'office', tiles: [{ dx: 0, dy: 0, frame: 370 }, { dx: 1, dy: 0, frame: 371 }, { dx: 0, dy: 1, frame: 386 }, { dx: 1, dy: 1, frame: 387 }] },
];

// Round table: Basement frame 17 (visual grid crop, row1 col1 — a small
// single-tile wooden table).
export const ROUND_TABLE = { texture: 'basement', frame: 17 };

// Three-seat sofa: Basement frames 6/7/8 (backrest) over 22/23/24 (seat
// cushions) — a 3-wide x 2-tall stamp, visually confirmed the same way.
export const SOFA_3SEAT = {
  texture: 'basement',
  tiles: [
    { dx: 0, dy: 0, frame: 6 }, { dx: 1, dy: 0, frame: 7 }, { dx: 2, dy: 0, frame: 8 },
    { dx: 0, dy: 1, frame: 22 }, { dx: 1, dy: 1, frame: 23 }, { dx: 2, dy: 1, frame: 24 },
  ],
};

// Whiteboard: the same already-loaded 64x64 whiteboard spritesheet floor 1
// uses (Whiteboard layer, frame 0).
export const WHITEBOARD = { texture: 'whiteboards', frame: 0 };

// Desk + monitor: the same already-loaded 96x64 combo sprite floor 1's own
// Computer layer places at every coding-pit desk.
export const DESK = { texture: 'computers', frames: [0, 1, 2, 3, 4] };

// Chair furniture frame per facing direction: real values pulled from the
// Chair layer's own frame-per-direction usage on floor 1.
export const CHAIR_FRAME_BY_DIRECTION = { down: 13, up: 5, left: 3, right: 2 };

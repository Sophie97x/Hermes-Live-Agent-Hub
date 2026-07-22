// Tile-level walkability + pathfinding for the pixel office.
//
// This is deliberately NOT `src/utils/pathfinding.js`. That module routes the
// photo office through a hand-authored corridor graph in percent-of-stage
// coordinates, with named door/stairs waypoints per room. Here we have a real
// tile grid, so walkability is derived from the map itself and paths come out
// of a plain breadth-first search — no waypoints to maintain by hand.
export const TILE = 32;

// Object layers whose contents an agent cannot walk through. `Objects` and
// `GenericObjects` are deliberately absent: those are the non-colliding decor
// layers (rugs, wall art, ceiling bits) that the map's own collision setup
// also lets the player walk over. The Chair layer is absent for the opposite
// reason — agents must be able to reach a chair to sit in it.
const BLOCKING_OBJECT_LAYERS = ['Wall', 'ObjectsOnCollide', 'GenericObjectsOnCollide', 'Basement', 'VendingMachine'];

function index(cols, tx, ty) {
  return ty * cols + tx;
}

export function tileX(worldX) {
  return Math.floor(worldX / TILE);
}

export function tileY(worldY) {
  return Math.floor(worldY / TILE);
}

function centreOf(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

// Tiled objects are anchored bottom-left, so the covered band runs upward
// from `object.y`.
function blockObject(grid, cols, rows, object) {
  const x1 = tileX(object.x);
  const x2 = Math.ceil((object.x + object.width) / TILE);
  const y1 = tileY(object.y - object.height);
  const y2 = Math.ceil(object.y / TILE);
  for (let ty = y1; ty < y2; ty += 1) {
    for (let tx = x1; tx < x2; tx += 1) {
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      grid[index(cols, tx, ty)] = 0;
    }
  }
}

function openSeats(grid, cols, rows, seats) {
  seats.forEach((seat) => {
    const tx = tileX(seat.x);
    const ty = tileY(seat.y);
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return;
    grid[index(cols, tx, ty)] = 1;
  });
}

// Ground floor: walkable wherever the Ground tile layer actually painted a
// tile, minus everything the colliding object layers sit on.
export function buildFloor1Grid(map, groundLayer, seats, cols, rows) {
  const grid = new Uint8Array(cols * rows);
  groundLayer.forEachTile((tile) => {
    if (tile && tile.index !== -1) grid[index(cols, tile.x, tile.y)] = 1;
  });
  BLOCKING_OBJECT_LAYERS.forEach((name) => {
    map.getObjectLayer(name)?.objects.forEach((object) => blockObject(grid, cols, rows, object));
  });
  openSeats(grid, cols, rows, seats);
  return grid;
}

// Generated floor: walkable across the building's carpet, minus walls and
// furniture. Seats are re-opened last so a chair tucked under a desk stays
// reachable.
export function buildGeneratedGrid(data, cols, rows) {
  const grid = new Uint8Array(cols * rows);
  const mark = (tiles, value) => {
    tiles.forEach((tile) => {
      const tx = tileX(tile.x);
      const ty = tileY(tile.y);
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return;
      grid[index(cols, tx, ty)] = value;
    });
  };
  mark(data.floorTiles, 1);
  mark(data.walls, 0);
  mark(data.furniture, 0);
  openSeats(grid, cols, rows, data.seats);
  return grid;
}

export function isWalkable(grid, cols, rows, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return false;
  return grid[index(cols, tx, ty)] === 1;
}

// Breadth-first search, 4-directional. The grid is 40x30, so exhaustive BFS
// costs nothing and avoids the heuristic-tuning that A* would need here.
// Returns world-space tile centres from the step after `start` through
// `goal`, or null when no route exists (the caller then places the agent
// directly rather than leaving it stranded mid-floor).
export function findPath(grid, cols, rows, start, goal) {
  const startX = tileX(start.x);
  const startY = tileY(start.y);
  const goalX = tileX(goal.x);
  const goalY = tileY(goal.y);
  if (startX === goalX && startY === goalY) return [];
  if (!isWalkable(grid, cols, rows, goalX, goalY)) return null;

  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const queue = [index(cols, startX, startY)];
  const goalIndex = index(cols, goalX, goalY);
  cameFrom[queue[0]] = queue[0];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === goalIndex) break;
    const cx = current % cols;
    const cy = Math.floor(current / cols);
    const neighbours = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
    for (const [nx, ny] of neighbours) {
      if (!isWalkable(grid, cols, rows, nx, ny)) continue;
      const next = index(cols, nx, ny);
      if (cameFrom[next] !== -1) continue;
      cameFrom[next] = current;
      queue.push(next);
    }
  }

  if (cameFrom[goalIndex] === -1) return null;

  const path = [];
  let node = goalIndex;
  while (node !== cameFrom[node]) {
    path.push(centreOf(node % cols, Math.floor(node / cols)));
    node = cameFrom[node];
  }
  return path.reverse();
}

// A random walkable tile inside a room rect — where break-room wandering
// picks its next stop.
export function randomWalkableInRect(grid, cols, rows, rect) {
  const candidates = [];
  for (let ty = tileY(rect.y1); ty <= tileY(rect.y2); ty += 1) {
    for (let tx = tileX(rect.x1); tx <= tileX(rect.x2); tx += 1) {
      if (isWalkable(grid, cols, rows, tx, ty)) candidates.push(centreOf(tx, ty));
    }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

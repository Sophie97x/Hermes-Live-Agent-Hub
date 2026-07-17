// Corridor routing for the office floor. Rooms open onto the central
// horizontal corridor through a door at a known x position; a route walks
// from the seat to its room door, along the corridor, through the
// destination door and to the new seat. All coordinates are map percents.

const CORRIDOR_Y = 51.5;

export function buildRoute(start, end, startDoorX, endDoorX) {
  const points = [
    start,
    [startDoorX, start[1]],
    [startDoorX, CORRIDOR_Y],
    [endDoorX, CORRIDOR_Y],
    [endDoorX, end[1]],
    end,
  ];
  // Drop consecutive duplicates so interpolation never stalls on a
  // zero-length segment.
  return points.filter((point, index) => {
    if (!index) return true;
    const [px, py] = points[index - 1];
    return Math.abs(point[0] - px) > 0.05 || Math.abs(point[1] - py) > 0.05;
  });
}

export function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return total;
}

// Distance-weighted interpolation so walking speed stays constant across
// segments of different lengths.
export function interpolatePath(path, progress) {
  if (!path || !path.length) return [0, 0];
  if (path.length < 2) return path[0];
  const clamped = Math.max(0, Math.min(1, progress));
  const total = pathLength(path);
  if (!total) return path[0];
  let remaining = clamped * total;
  for (let i = 1; i < path.length; i += 1) {
    const [x1, y1] = path[i - 1];
    const [x2, y2] = path[i];
    const segment = Math.hypot(x2 - x1, y2 - y1);
    if (remaining <= segment) {
      const t = segment ? remaining / segment : 0;
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    remaining -= segment;
  }
  return path[path.length - 1];
}

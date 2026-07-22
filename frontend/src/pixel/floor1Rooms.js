// Named-room rects for floor 1 (the real SkyOffice map, 1280x960). Every
// rect below was derived from the Chair object layer's actual seat
// coordinates (map/map.json), not eyeballed — a one-off validation script
// assigned all 33 real seats to these rects and confirmed zero unmatched
// and zero overlaps before this was written down.
//
// `id` doubles as the value `syncAgents` compares against `destinationFor()`
// — five of the six rooms use one of the seven canonical room ids so real
// routing lands agents there; `sofaNook` does not match any canonical id on
// purpose. Both lounge clusters are overflow-only: the canonical break room
// lives upstairs, matching the photo office, while creative and quality also
// live upstairs. Keeping canonical ids on exactly one floor prevents the same
// agent from appearing on both floors.
export const FLOOR1_ROOMS = [
  { id: 'coding', label: 'Desk Pit', rect: { x1: 928, y1: 112, x2: 1232, y2: 848 } },
  { id: 'meeting', label: 'Conference Room', rect: { x1: 224, y1: 576, x2: 560, y2: 736 } },
  { id: 'operations', label: 'Reception', rect: { x1: 624, y1: 64, x2: 736, y2: 128 } },
  { id: 'groundLounge', label: 'Lounge', rect: { x1: 208, y1: 352, x2: 336, y2: 416 } },
  { id: 'research', label: 'Reading Table', rect: { x1: 432, y1: 218, x2: 592, y2: 328 } },
  { id: 'sofaNook', label: 'Sofa Nook', rect: { x1: 448, y1: 352, x2: 624, y2: 416 } },
];

export function roomForSeat(x, y) {
  const match = FLOOR1_ROOMS.find((room) => (
    x >= room.rect.x1 && x <= room.rect.x2 && y >= room.rect.y1 && y <= room.rect.y2
  ));
  return match ? match.id : 'unassigned';
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { agentArtFor } from '../agentArt';
import groundFloorPhoto from '../assets/office-ground-real.png';
import firstFloorPhoto from '../assets/office-first-real.png';
import doorGlassTexture from '../assets/door-glass-ground.png';
import './OfficeFloor.css';
import {
  buildRoutePhases,
  buildWanderPhases,
  interpolateRoute,
  isNearPoint,
  isOnStairs,
  OFFICE_PATH,
  routeLength,
} from '../utils/pathfinding';

// Fixed coordinate space matching the 3:2 floor photos. Every percent-positioned
// overlay lives on this stage, which scales uniformly to fit the map container,
// so seats, doors and the workstation screens stay glued to the artwork at any
// window size, including full screen.
const STAGE_WIDTH = 1440;
const STAGE_HEIGHT = 960;

// Sliding doors take this long to open (matches the CSS leaf transition). A
// walking agent that reaches a still-closed door holds at the threshold until
// the door has been open at least this long, then walks through.
const DOOR_OPEN_MS = 600;
// How near a door counts as "at the threshold" (hold here) versus "approaching"
// (the door starts opening). The approach radius matches the render proximity.
const DOOR_GATE_RADIUS = 2.4;
const DOOR_APPROACH_RADIUS = 3.8;

// Cartoon scuffle: two walking agents whose paths cross close enough get
// pulled into a 5-second dust-cloud brawl before continuing on their way.
const FIGHT_TRIGGER_DISTANCE = 5.5;
const FIGHT_DURATION_MS = 5000;
const FIGHT_COOLDOWN_MS = 20000;

// A synthetic "room" anchored exactly where an agent happens to be (a fight,
// a doorway), used to resume a route from there rather than from a real
// room's door. Door and inside both equal the waypoint itself, so the normal
// same-floor routing (which always crosses the shared corridor line on the
// ground floor) picks it up with zero detour.
function corridorWaypointRoom(floor, position) {
  return { floor, entry: { door: position, inside: position, axis: 'vertical' } };
}

// The closest seat/standing spot in a room to an arbitrary point — used to
// resume a walk from wherever a fight broke out inside a room with its own
// internal egress lanes (the Break Room), rather than routing it back out
// through the room's front door and in again.
function nearestSpotIndex(room, position) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  room.spots.forEach((spot, index) => {
    const distance = Math.hypot(spot[0] - position[0], spot[1] - position[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

const DESK_FACINGS = {
  coding: ['front', 'front', 'front', 'front'],
  research: ['front', 'front', 'front', 'front'],
  creative: ['front', 'front', 'front', 'front'],
  operations: ['front', 'front', 'front', 'front'],
  quality: ['front', 'front', 'front', 'front'],
};

const PC_WORKSTATION_ROOMS = new Set(['coding', 'operations', 'quality']);

// Seat coordinates are calibrated against the floor photos (stage percent):
// every spot sits on a chair, sofa cushion, stool or standing position that
// exists in the artwork.
const ROOMS = {
  coding: {
    label: 'Coding Studio', icon: '⌘', subtitle: 'Building & shipping',
    floor: 'ground',
    spots: [[13.2, 22.4], [23.8, 22.8], [13.2, 39.4], [23.8, 39.8]],
    facings: DESK_FACINGS.coding,
    entry: { door: [17.5, 42.5], inside: [17.5, 39], axis: 'vertical', orientation: 'south' },
  },
  research: {
    label: 'Research Library', icon: '⌕', subtitle: 'Reading & analysis',
    floor: 'ground',
    spots: [[40.4, 20.5], [49.8, 20.5], [40.4, 26.4], [49.8, 26.4]],
    facings: ['right', 'left', 'right', 'left'],
    subzones: ['chair', 'chair', 'chair', 'chair'],
    entry: { door: [42.5, 42.5], inside: [42.5, 39], axis: 'vertical', orientation: 'south' },
  },
  creative: {
    label: 'Creative Studio', icon: '✦', subtitle: 'Designing & making',
    floor: 'ground',
    spots: [[66.9, 9.5], [67.7, 37.3], [75.5, 24], [62.8, 31.5]],
    facings: ['front', 'front', 'right', 'left'],
    subzones: ['chair', 'chair', 'art', 'art'],
    entry: { door: [69.5, 42.5], inside: [69.5, 39], axis: 'vertical', orientation: 'south' },
  },
  operations: {
    label: 'Operations', icon: '◎', subtitle: 'Monitoring systems',
    floor: 'ground',
    spots: [[14, 73.7], [23.4, 73.7], [14, 88.6], [23.4, 88.6]],
    facings: DESK_FACINGS.operations,
    entry: { door: [20.5, 59], inside: [20.5, 62], axis: 'vertical', orientation: 'north' },
  },
  meeting: {
    label: 'Meeting Room', icon: '◇', subtitle: 'Waiting & collaborating',
    floor: 'ground',
    spots: [
      [38.3, 71.7], [50.9, 71.7], [38.3, 78.6], [50.9, 78.2],
      [38.3, 84.5], [50.9, 84.2], [45, 66.3], [45, 90.6],
    ],
    facings: ['right', 'left', 'right', 'left', 'right', 'left', 'front', 'front'],
    subzones: ['chair', 'chair', 'chair', 'chair', 'chair', 'chair', 'chair', 'chair'],
    entry: { door: [42.5, 59], inside: [42.5, 62], axis: 'vertical', orientation: 'north' },
  },
  quality: {
    label: 'Quality Lab', icon: '✓', subtitle: 'Testing & reviewing',
    floor: 'ground',
    spots: [[63.5, 74.2], [72.3, 74.2], [63.5, 88.9], [72.3, 88.9]],
    facings: DESK_FACINGS.quality,
    entry: { door: [67, 59], inside: [67, 62], axis: 'vertical', orientation: 'north' },
  },
  breakroom: {
    label: 'Break Room', icon: '☕', subtitle: 'Resting & recharging',
    floor: 'upper',
    // Lounge sofas and armchairs, foosball and pool players, reading chairs,
    // kitchen stools and dining seats. Walking lanes: x=29.5 (lounge), x=55
    // (games), x=61 (kitchen), main corridor y=59 leading to the stair door.
    spots: [
      [16.5, 22.2], [22.1, 22.7], [25.7, 32.6],
      [15, 42.3], [21.2, 42.7],
      [16.5, 57.3], [22.4, 57.8],
      [14.4, 68.6], [23.7, 69.1],
      [12.2, 85.9], [23.7, 85.9],
      [38.9, 23.7], [52.1, 23.7],
      [41.2, 39], [50.5, 39],
      [40.6, 69.1], [49.5, 69.6], [45.2, 77],
      [66.3, 33.1], [69.6, 33.6], [72.9, 33.6],
      [67.9, 54.8], [71.9, 55.3],
      [67.9, 75], [71.9, 75.5],
    ],
    egress: [
      [[16.5, 26], [29.5, 26], [29.5, 59], [78, 59], [78, 52]],
      [[22.1, 26], [29.5, 26], [29.5, 59], [78, 59], [78, 52]],
      [[29.5, 32.6], [29.5, 59], [78, 59], [78, 52]],
      [[15, 47], [29.5, 47], [29.5, 59], [78, 59], [78, 52]],
      [[21.2, 47], [29.5, 47], [29.5, 59], [78, 59], [78, 52]],
      [[16.5, 61.5], [29.5, 61.5], [29.5, 59], [78, 59], [78, 52]],
      [[22.4, 61.5], [29.5, 61.5], [29.5, 59], [78, 59], [78, 52]],
      [[14.4, 73], [29.5, 73], [29.5, 59], [78, 59], [78, 52]],
      [[23.7, 73], [29.5, 73], [29.5, 59], [78, 59], [78, 52]],
      [[12.2, 92.5], [29.5, 92.5], [29.5, 59], [78, 59], [78, 52]],
      [[29.5, 85.9], [29.5, 59], [78, 59], [78, 52]],
      [[38.9, 30.5], [55, 30.5], [55, 59], [78, 59], [78, 52]],
      [[55, 23.7], [55, 59], [78, 59], [78, 52]],
      [[41.2, 44], [55, 44], [55, 59], [78, 59], [78, 52]],
      [[50.5, 44], [55, 44], [55, 59], [78, 59], [78, 52]],
      [[36.5, 69.1], [36.5, 59], [78, 59], [78, 52]],
      [[55, 69.6], [55, 59], [78, 59], [78, 52]],
      [[45.2, 82.5], [55, 82.5], [55, 59], [78, 59], [78, 52]],
      [[66.3, 38.5], [61, 38.5], [61, 59], [78, 59], [78, 52]],
      [[69.6, 38.5], [61, 38.5], [61, 59], [78, 59], [78, 52]],
      [[72.9, 38.5], [61, 38.5], [61, 59], [78, 59], [78, 52]],
      [[67.9, 59], [78, 59], [78, 52]],
      [[71.9, 59], [78, 59], [78, 52]],
      [[67.9, 80], [61, 80], [61, 59], [78, 59], [78, 52]],
      [[71.9, 80], [61, 80], [61, 59], [78, 59], [78, 52]],
    ],
    facings: [
      'front', 'front', 'left',
      'front', 'front',
      'front', 'front',
      'right', 'left',
      'right', 'left',
      'right', 'left',
      'right', 'left',
      'right', 'left', 'front',
      'front', 'front', 'front',
      'front', 'front',
      'front', 'front',
    ],
    subzones: [
      'sofa', 'sofa', 'sofa',
      'chair', 'chair',
      'sofa', 'sofa',
      'chair', 'chair',
      'art', 'art',
      'art', 'art',
      'chair', 'chair',
      'chair', 'chair', 'chair',
      'chair', 'chair', 'chair',
      'chair', 'chair',
      'chair', 'chair',
    ],
    // The lounge opens onto the stairwell through an open threshold in the
    // photo, not a glass slider, so it renders no door graphic.
    hasDoor: false,
    entry: { door: [84.5, 52], inside: [81, 52], axis: 'horizontal', orientation: 'east' },
  },
};

const roomOrder = ['coding', 'research', 'creative', 'operations', 'meeting', 'quality', 'breakroom'];
const THEMES = {
  midnight: { label: 'Midnight' },
  daylight: { label: 'Daylight' },
  botanical: { label: 'Botanical' },
};

const HOME_ROOMS = {
  Friday: 'operations', Atlas: 'meeting', Orion: 'research', Devin: 'coding',
  Quinn: 'quality', Scribe: 'research', Maya: 'creative', Scout: 'research', Studio: 'creative',
};

function destinationFor(agent) {
  const task = `${agent.current_task || ''} ${agent.name || ''}`.toLowerCase();
  if (/taking a break|recharging|break time/.test(task)) return 'breakroom';
  if (agent.status === 'idle') return 'breakroom';
  if (agent.name === 'Friday') return 'operations';
  if (['queued', 'waiting', 'error'].includes(agent.status)) return 'meeting';
  if (agent.name === 'Atlas') return 'meeting';
  if (agent.name === 'Quinn' || /quality|test|testing|qa|verify|validation/.test(task)) return 'quality';
  if (['Maya', 'Studio'].includes(agent.name) || /design|creative|image|video|visual|ux|ui/.test(task)) return 'creative';
  if (/waiting|blocked|approval|review|sync|meeting/.test(task)) return 'meeting';
  if (/research|search|analyse|analyze|document|obsidian|read|investigate/.test(task)) return 'research';
  if (/monitor|cron|deploy|backend|server|gateway|schedule|incident|system/.test(task)) return 'operations';
  if (HOME_ROOMS[agent.name]) return HOME_ROOMS[agent.name];
  return agent.home === 'meeting' ? 'meeting' : agent.home === 'quality' ? 'quality' : agent.home === 'creative' ? 'creative' : 'coding';
}

// Seat plan for the Break Room: wandering agents keep their chosen spot, the
// rest fill the remaining seats in arrival order.
function planBreakroomSeats(ids, overrides) {
  const spotCount = ROOMS.breakroom.spots.length;
  const plan = {};
  const taken = new Set();
  for (const id of ids) {
    const seat = overrides[id];
    if (Number.isInteger(seat) && seat >= 0 && seat < spotCount && !taken.has(seat)) {
      plan[id] = seat;
      taken.add(seat);
    }
  }
  let cursor = 0;
  for (const id of ids) {
    if (plan[id] != null) continue;
    while (taken.has(cursor) && cursor < spotCount) cursor += 1;
    plan[id] = cursor;
    taken.add(cursor);
    cursor += 1;
  }
  return plan;
}

const PLAN_DESKS = [
  [6.5, 47.5], [18.5, 47.5], [6.5, 53.5], [18.5, 53.5],
  [63, 47.5], [74.5, 47.5], [63, 53.5], [74.5, 53.5],
  [6.5, 77], [18, 77], [6.5, 86.5], [18, 86.5],
  [63, 77], [74.5, 77], [63, 86.5], [74.5, 86.5],
];

const PLAN_PLANTS = [
  [6, 7], [48, 30], [79, 29], [80, 7],
  [5.5, 57], [28, 47], [34, 47], [57, 57], [63, 57], [81, 57],
  [5.5, 93], [27.5, 93], [34, 93], [57, 93], [63, 93], [81, 93],
];

function OfficeMapArtwork() {
  return (
    <svg className="office-blueprint" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="office-grid" width="2.6" height="2.6" patternUnits="userSpaceOnUse">
          <rect className="grid-base" width="2.6" height="2.6" />
          <path className="grid-line" d="M0 1.3H2.6M1.3 0V2.6" />
          <circle className="carpet-fleck" cx=".55" cy=".7" r=".08" />
          <circle className="carpet-fleck" cx="2" cy="1.95" r=".07" />
        </pattern>
        <pattern id="office-wood" width="8" height="2.6" patternUnits="userSpaceOnUse">
          <rect className="wood-base" width="8" height="2.6" />
          <path className="wood-line" d="M0 2.6H8M4 0V2.6M1 .55C2 .2 3 .25 4 .55M5.2 1.9c.8-.25 1.7-.25 2.6 0" />
        </pattern>
        <pattern id="office-terrazzo" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect className="terrazzo-base" width="4" height="4" />
          <circle className="terrazzo-chip chip-a" cx=".6" cy="1" r=".12" />
          <circle className="terrazzo-chip chip-b" cx="2.7" cy=".55" r=".09" />
          <circle className="terrazzo-chip chip-a" cx="3.35" cy="2.8" r=".1" />
          <circle className="terrazzo-chip chip-b" cx="1.4" cy="3.35" r=".08" />
        </pattern>
        <linearGradient id="corridor-glow" x1="0" x2="1">
          <stop offset="0" className="corridor-stop edge" />
          <stop offset=".5" className="corridor-stop middle" />
          <stop offset="1" className="corridor-stop edge" />
        </linearGradient>
        <linearGradient id="office-wall-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="wall-stop wall-top" />
          <stop offset="1" className="wall-stop wall-bottom" />
        </linearGradient>
        <linearGradient id="office-glass" x1="0" x2="1">
          <stop offset="0" className="glass-stop glass-edge" />
          <stop offset=".48" className="glass-stop glass-middle" />
          <stop offset="1" className="glass-stop glass-edge" />
        </linearGradient>
        <linearGradient id="desk-finish" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="desk-stop desk-top" />
          <stop offset="1" className="desk-stop desk-bottom" />
        </linearGradient>
        <filter id="office-furniture-shadow" x="-25%" y="-35%" width="150%" height="180%">
          <feDropShadow dx="0" dy=".55" stdDeviation=".45" floodOpacity=".34" />
        </filter>
        <filter id="office-room-shadow" x="-15%" y="-20%" width="130%" height="150%">
          <feDropShadow dx="0" dy="1" stdDeviation=".8" floodOpacity=".42" />
        </filter>
      </defs>

      <rect className="office-atmosphere" width="100" height="100" />
      <rect className="building-ground-shadow" x="1.2" y="1.8" width="96" height="96" rx="2" />
      <path className="exterior-paving" d="M0 39H100V41H0zM0 99H100V100H0z" />

      <g className="upper-storey-plan">
        <rect className="storey-shadow" x="2" y="2" width="83" height="34" rx="1.4" />
        <rect className="upper-lounge-floor" x="3" y="3" width="49" height="31" />
        <rect className="upper-kitchen-floor" x="52" y="3" width="32" height="31" />
        <rect className="room-outline upper-outline" x="3" y="3" width="81" height="31" rx=".7" />
        <rect className="wall-cap upper-wall-cap" x="3" y="3" width="81" height="1.35" rx=".45" />
        <path className="window-glass" d="M10 3.08H29V4.2H10zM34 3.08H48V4.2H34zM57 3.08H74V4.2H57z" />
        <path className="window-mullion" d="M16.3 3.1V4.2M22.6 3.1V4.2M41 3.1V4.2M62.7 3.1V4.2M68.4 3.1V4.2" />
        <path className="upper-divider" d="M52 4V33" />
        <path className="glass-partition" d="M52.7 8V18M52.7 22V31" />
        <rect className="ceiling-light warm-light" x="12" y="6" width="9" height=".65" rx=".3" />
        <rect className="ceiling-light warm-light" x="36" y="6" width="9" height=".65" rx=".3" />
        <rect className="ceiling-light kitchen-light" x="58" y="11" width="15" height=".65" rx=".3" />

        <rect className="sofa sofa-long" x="11" y="10" width="20" height="5.5" rx="1.2" />
        <rect className="sofa-cushion" x="12" y="10.8" width="8.5" height="2.5" rx=".7" />
        <rect className="sofa-cushion" x="21.2" y="10.8" width="8.5" height="2.5" rx=".7" />
        <path className="sofa-seam" d="M21 10.8v4.1" />
        <rect className="sofa sofa-side" x="8" y="20" width="7" height="9" rx="1.2" />
        <rect className="rug" x="17" y="18" width="22" height="11" rx="1.2" />
        <ellipse className="coffee-table" cx="28" cy="23.5" rx="5.2" ry="2.7" />
        <circle className="coffee-cup" cx="27" cy="23" r=".65" />
        <circle className="coffee-cup" cx="30" cy="24.1" r=".55" />
        <rect className="game-table" x="39.5" y="11" width="9" height="6" rx="1" />
        <circle className="game-piece" cx="42" cy="13" r=".55" />
        <circle className="game-piece" cx="46" cy="15" r=".55" />
        <rect className="wall-screen" x="18" y="4.5" width="15" height="2.7" rx=".4" />
        <rect className="media-console" x="18" y="7.5" width="15" height="1.25" rx=".25" />
        <circle className="floor-lamp-base" cx="45.5" cy="27.8" r="1.2" />
        <path className="floor-lamp-stem" d="M45.5 27.8V22.5" />
        <path className="floor-lamp-shade" d="M43.8 22.7h3.4l-1-2h-1.4z" />
        <rect className="lounge-shelf" x="4.7" y="5.5" width="2" height="11.5" rx=".25" />
        <path className="shelf-lines" d="M4.9 8H6.5M4.9 11H6.5M4.9 14H6.5" />

        <rect className="kitchen-counter" x="76.5" y="6" width="5" height="20" rx=".5" />
        <rect className="kitchen-counter" x="55" y="6" width="16" height="4" rx=".5" />
        <rect className="kitchen-island" x="58" y="13" width="13" height="4.5" rx=".8" />
        <rect className="sink-basin" x="62" y="6.7" width="4.5" height="2.4" rx=".5" />
        <path className="sink-tap" d="M64.2 6.8v-.8c0-.6 1.3-.6 1.3 0v.55" />
        <circle className="hob-ring" cx="78.8" cy="10" r="1" />
        <circle className="hob-ring" cx="78.8" cy="13" r="1" />
        <path className="cabinet-lines" d="M55.5 9.6V6.4M59.2 9.6V6.4M68 9.6V6.4M76.9 18h4.2M76.9 22h4.2" />
        <circle className="counter-stool" cx="60" cy="18.5" r="1" />
        <circle className="counter-stool" cx="65" cy="18.5" r="1" />
        <circle className="counter-stool" cx="69" cy="18.5" r="1" />
        <ellipse className="dining-table" cx="63" cy="26" rx="7" ry="3.2" />
        <circle className="dining-chair" cx="55" cy="26" r="1.2" />
        <circle className="dining-chair" cx="71" cy="26" r="1.2" />
        <circle className="dining-chair" cx="60" cy="30.2" r="1.2" />
        <circle className="dining-chair" cx="66" cy="30.2" r="1.2" />
        <rect className="fridge" x="73" y="6" width="2.3" height="7" rx=".4" />
        <path className="fridge-handle" d="M73.5 7V10" />
        <g className="coffee-station">
          <rect x="77.4" y="22.2" width="3.2" height="2.8" rx=".35" />
          <circle cx="79" cy="23.2" r=".42" />
          <rect x="78.5" y="24.7" width="1" height=".7" rx=".2" />
        </g>
      </g>

      <g className="ground-storey-plan">
        <rect className="storey-shadow" x="2" y="43" width="83" height="55" rx="1.4" />
        <rect className="work-room-floor room-tile" x="3" y="44" width="27" height="17" />
        <rect className="work-room-floor room-wood" x="32" y="44" width="27" height="17" />
        <rect className="work-room-floor room-tile" x="61" y="44" width="23" height="17" />
        <rect className="corridor-floor" x="3" y="61" width="81" height="9" />
        <rect className="work-room-floor room-ops" x="3" y="70" width="27" height="27" />
        <rect className="work-room-floor room-wood" x="32" y="70" width="27" height="27" />
        <rect className="work-room-floor room-tile" x="61" y="70" width="23" height="27" />

        <rect className="room-outline" x="3" y="44" width="27" height="17" />
        <rect className="room-outline" x="32" y="44" width="27" height="17" />
        <rect className="room-outline" x="61" y="44" width="23" height="17" />
        <rect className="room-outline" x="3" y="70" width="27" height="27" />
        <rect className="room-outline" x="32" y="70" width="27" height="27" />
        <rect className="room-outline" x="61" y="70" width="23" height="27" />
        <path className="wall-cap" d="M3 44h81v1.15H3zM3 95.85h81V97H3z" />
        <path className="window-glass" d="M7 44.08h16v1H7zM36 44.08h17v1H36zM65 44.08h15v1H65zM7 95.9h17v1H7zM36 95.9h17v1H36zM65 95.9h15v1H65z" />
        <path className="window-mullion" d="M15 44.1V45M44.5 44.1V45M72.5 44.1V45M15.5 96V96.9M44.5 96V96.9M72.5 96V96.9" />
        <path className="corridor-skirting" d="M3.4 61.4H83.6M3.4 69.6H83.6" />
        <rect className="corridor-runner" x="5" y="64" width="75" height="3" rx="1.4" />
        <rect className="ceiling-light" x="9" y="62.1" width="10" height=".55" rx=".25" />
        <rect className="ceiling-light" x="35" y="62.1" width="10" height=".55" rx=".25" />
        <rect className="ceiling-light" x="62" y="62.1" width="10" height=".55" rx=".25" />
        <g className="corridor-furniture">
          <rect className="corridor-bench" x="23.5" y="66.3" width="9" height="1.6" rx=".55" />
          <rect className="copier" x="56" y="65" width="2.8" height="3.2" rx=".35" />
          <circle className="water-cooler" cx="77.5" cy="66" r="1.05" />
          <rect className="fire-extinguisher" x="5" y="67" width=".8" height="1.6" rx=".25" />
        </g>

        {PLAN_DESKS.map(([x, y], index) => (
          <g className="plan-desk" key={`${x}-${y}`}>
            <rect className="desk-surface" x={x} y={y} width="8" height="2.8" rx=".45" />
            <path className="desk-frame" d={`M${x + .65} ${y + 2.5}v1.1M${x + 7.35} ${y + 2.5}v1.1`} />
            <rect className="desk-monitor" x={x + 2.5} y={y - 1.3} width="3" height="1.7" rx=".25" />
            <rect className="desk-keyboard" x={x + 2.55} y={y + .65} width="2.9" height=".7" rx=".18" />
            <circle className="desk-mouse" cx={x + 6.15} cy={y + 1.05} r=".28" />
            <circle className="desk-chair" cx={x + 4} cy={y + 3.4} r="1.05" />
            {index % 3 === 0 && <circle className="desk-mug" cx={x + 1.1} cy={y + .8} r=".35" />}
            {index >= 8 && index < 12 && <circle className="ops-led" cx={x + 1} cy={y + 1.35} r=".35" />}
          </g>
        ))}

        <rect className="bookcase" x="33.5" y="45.5" width="23.5" height="2.3" rx=".3" />
        <path className="book-spines" d="M35 46V47 M37 45.8V47.4 M39 46V47 M42 45.7V47.4 M45 46V47.4 M48 45.8V47.3 M51 46V47.4 M54 45.7V47.3" />
        <rect className="library-table" x="38" y="50.5" width="15" height="3" rx=".8" />
        <path className="open-books" d="M41 51.2l2.1-.45 2.1.45v1.3l-2.1-.45-2.1.45zM47 51.2l2.1-.45 2.1.45v1.3l-2.1-.45-2.1.45z" />
        <rect className="creative-board" x="64" y="45.5" width="17" height="2.4" rx=".35" />
        <circle className="swatch swatch-a" cx="67" cy="46.7" r=".65" />
        <circle className="swatch swatch-b" cx="70" cy="46.7" r=".65" />
        <circle className="swatch swatch-c" cx="73" cy="46.7" r=".65" />
        <path className="pinboard-notes" d="M75 46h2v1.2h-2zM78 46h1.5v1.2H78z" />

        <rect className="ops-screen-wall" x="5.5" y="72" width="22" height="3.7" rx=".45" />
        <path className="ops-screen-data" d="M7 74L10 73l2 1 3-1 3 1 3-1 4 1" />
        <ellipse className="meeting-rug" cx="45.5" cy="84.5" rx="11" ry="9" />
        <ellipse className="meeting-table" cx="45.5" cy="84.5" rx="7.7" ry="5" />
        <circle className="meeting-center" cx="45.5" cy="84.5" r="1.2" />
        <rect className="quality-rack" x="79.5" y="73" width="2.2" height="9" rx=".3" />
        <circle className="quality-led" cx="80.6" cy="74.5" r=".3" />
        <circle className="quality-led" cx="80.6" cy="76.5" r=".3" />
        <circle className="quality-led" cx="80.6" cy="78.5" r=".3" />
        <rect className="acoustic-panel" x="6" y="93.5" width="7" height="1" rx=".25" />
        <rect className="acoustic-panel" x="14" y="93.5" width="7" height="1" rx=".25" />
        <rect className="whiteboard" x="39" y="72" width="13" height="2.6" rx=".3" />
        <path className="whiteboard-writing" d="M40 73l3-.4 2 .55 2.5-.35 3 .5" />
      </g>

      <g className="stairwell-plan">
        <rect className="stair-shadow" x="85" y="33" width="12" height="38" rx="1.2" />
        <rect className="stair-floor" x="85.5" y="33.5" width="11" height="37" rx=".8" />
        <rect className="stair-void" x="87.2" y="39" width="7.6" height="25" rx=".4" />
        <rect className="stair-mid-landing" x="87.2" y="50" width="7.6" height="3.3" rx=".2" />
        <path className="stair-route-line" d="M88 35L92 39 88 43 92 47 88 51 92 55 88 59 92 63 88 65.5" />
        <path className="stair-rail" d="M86.5 35V69 M95.5 35V69" />
        <path className="stair-treads" d="M87.5 40H94.5M87.5 42H94.5M87.5 44H94.5M87.5 46H94.5M87.5 48H94.5M87.5 55H94.5M87.5 57H94.5M87.5 59H94.5M87.5 61H94.5M87.5 63H94.5" />
        <path className="stair-balustrade" d="M87.1 39V64M94.9 39V64M87.1 50h7.8M87.1 53h7.8" />
        <path className="stair-arrow" d="M90 37v27m0-27-1.3 2m1.3-2 1.3 2" />
        <rect className="upper-landing" x="83" y="31.5" width="13.5" height="5" rx=".8" />
        <rect className="ground-landing" x="83" y="63" width="13.5" height="7" rx=".8" />
        <path className="landing-mat" d="M84.5 33h8v2h-8zM84.5 66h8v2h-8z" />
      </g>

      {PLAN_PLANTS.map(([x, y]) => (
        <g className={`plan-plant plant-${y < 40 ? 'upper' : 'ground'}`} key={`${x}-${y}`}>
          <ellipse className="plant-shadow" cx={x} cy={y + .9} rx="1.6" ry=".55" />
          <circle className="plant-pot" cx={x} cy={y} r="1" />
          <path className="plant-leaves" d={`M${x} ${y - .4}c-2-2-2.2-3-.2-2 .4-2.5 1.5-2.5 1.6 0 .2-2 1.5-2.8 2.2-1.2 1.7.2 1.8 2.3 1.1.8 2.7 1 2.1 2.3-1 1.7-2.2-.2-2.8-2`} />
        </g>
      ))}
    </svg>
  );
}

function OfficeFloor({ agents = [], onSelectAgent, selectedAgent, timeline = [], projectRooms = [], onSelectProject, kanban = {} }) {
  const mapRef = useRef(null);
  const viewControlRef = useRef(null);
  const [openBubble, setOpenBubble] = useState(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [movingAgents, setMovingAgents] = useState([]);
  const [agentPositions, setAgentPositions] = useState({});
  const previousRooms = useRef({});
  const previousPositions = useRef({});
  const movementRef = useRef({});
  const movementFrameRef = useRef(null);
  const movementTickRef = useRef(null);
  const [movementFloors, setMovementFloors] = useState({});
  const [stageScale, setStageScale] = useState(1);
  const [wanderSeats, setWanderSeats] = useState({});
  const wanderStateRef = useRef([]);
  const [fights, setFights] = useState([]);
  const fightsRef = useRef([]);
  const fightingIdsRef = useRef(new Set());
  const fightCooldownRef = useRef({});
  const fightTimeoutsRef = useRef({});
  // Per-door: when it first started opening (an agent came within approach
  // range). Used to hold walkers at a still-closed threshold. And the previous
  // frame time, for pausing progress by real elapsed delta.
  const doorOpenSinceRef = useRef({});
  const lastTickRef = useRef(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [showBubbles, setShowBubbles] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [floorView, setFloorView] = useState('ground');
  const [replayActive, setReplayActive] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayAgent, setReplayAgent] = useState('all');
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [agentQuery, setAgentQuery] = useState('');
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem('hermes-office-theme');
    return THEMES[savedTheme] ? savedTheme : 'midnight';
  });

  useEffect(() => {
    window.localStorage.setItem('hermes-office-theme', theme);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const syncScale = () => {
      const rect = map.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setStageScale(Math.min(rect.width / STAGE_WIDTH, rect.height / STAGE_HEIGHT));
    };
    // Fullscreen transitions can report a mid-animation size; measure again
    // once the layout settles.
    let settleTimer = null;
    const syncSoon = () => {
      syncScale();
      if (settleTimer != null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(syncScale, 150);
    };
    syncScale();
    const observer = new ResizeObserver(syncScale);
    observer.observe(map);
    window.addEventListener('resize', syncSoon);
    document.addEventListener('fullscreenchange', syncSoon);
    document.addEventListener('webkitfullscreenchange', syncSoon);
    return () => {
      if (settleTimer != null) window.clearTimeout(settleTimer);
      observer.disconnect();
      window.removeEventListener('resize', syncSoon);
      document.removeEventListener('fullscreenchange', syncSoon);
      document.removeEventListener('webkitfullscreenchange', syncSoon);
    };
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      const activeElement = document.fullscreenElement || document.webkitFullscreenElement;
      setIsFullscreen(activeElement === mapRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!controlsOpen) return undefined;
    const closeOnOutsideOrEscape = (event) => {
      if (event.type === 'keydown') {
        if (event.key === 'Escape') setControlsOpen(false);
        return;
      }
      if (!viewControlRef.current?.contains(event.target)) setControlsOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideOrEscape);
    document.addEventListener('keydown', closeOnOutsideOrEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideOrEscape);
      document.removeEventListener('keydown', closeOnOutsideOrEscape);
    };
  }, [controlsOpen]);

  const toggleFullscreen = async () => {
    const map = mapRef.current;
    if (!map) return;
    const activeElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (activeElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      await exit?.call(document);
      return;
    }
    const request = map.requestFullscreen || map.webkitRequestFullscreen;
    await request?.call(map);
  };
  const replayAgents = useMemo(() => [...new Set(timeline.map((event) => event.agent).filter(Boolean))].sort(), [timeline]);
  const replayable = useMemo(() => timeline
    .filter((event) => event.agent && ['claimed', 'started', 'completed', 'blocked', 'failed', 'review'].includes(event.kind))
    .filter((event) => replayAgent === 'all' || event.agent === replayAgent)
    .slice(0, replayAgent === 'all' ? 30 : 60)
    .reverse(), [timeline, replayAgent]);
  const replayEvent = replayActive ? replayable[replayIndex] : null;
  useEffect(() => {
    setReplayIndex(0);
  }, [replayAgent]);
  useEffect(() => {
    if (!replayActive || !replayable.length) return undefined;
    const timer = window.setTimeout(() => {
      if (replayIndex >= replayable.length - 1) {
        setReplayActive(false);
        setReplayIndex(0);
      } else {
        setReplayIndex((index) => index + 1);
      }
    }, 1800 / replaySpeed);
    return () => window.clearTimeout(timer);
  }, [replayActive, replayIndex, replayable.length, replaySpeed]);

  const demoAgents = demoMode ? agents.map((agent, index) => ({
    ...agent,
    status: 'working',
    current_task: agent.current_task || `Demo shift ${index + 1}: heads-down at the desk`,
  })) : agents;
  const displayAgents = demoAgents.map((agent) => agent.name.toLowerCase() === replayEvent?.agent.toLowerCase() ? {
    ...agent,
    status: ['blocked', 'failed'].includes(replayEvent.kind) ? 'waiting' : 'working',
    current_task: replayEvent.task_title,
  } : agent);
  const roomUse = Object.fromEntries(roomOrder.map((room) => [room, 0]));
  const orderedAgents = [...displayAgents].slice(0, 24).sort((left, right) => {
    const roomDifference = roomOrder.indexOf(destinationFor(left)) - roomOrder.indexOf(destinationFor(right));
    return roomDifference || left.id.localeCompare(right.id);
  });
  const breakroomSeatPlan = planBreakroomSeats(
    orderedAgents.filter((agent) => destinationFor(agent) === 'breakroom').map((agent) => agent.id),
    wanderSeats,
  );
  const placedAgents = orderedAgents.map((agent) => {
    const room = destinationFor(agent);
    const slot = room === 'breakroom' ? breakroomSeatPlan[agent.id] : roomUse[room]++;
    const spots = ROOMS[room].spots;
    const seatIndex = slot % spots.length;
    const [targetLeft, targetTop] = spots[seatIndex];
    const overflow = Math.floor(slot / spots.length);
    const left = targetLeft + overflow * 1.6;
    const top = targetTop + overflow * 1.5;
    const previous = previousPositions.current[agent.id];
    const movement = movementRef.current[agent.id];
    const movementSample = movement ? interpolateRoute(movement.phases, movement.progress) : null;
    const positionOverride = agentPositions[agent.id];
    const previousRoom = previousRooms.current[agent.id];
    const pendingFloor = previousRoom && previousRoom !== room
      ? ROOMS[previousRoom]?.floor
      : ROOMS[room].floor;
    const currentPosition = Array.isArray(positionOverride)
      ? positionOverride
      : Array.isArray(previous) ? previous : [left, top];
    return {
      ...agent,
      room,
      left,
      top,
      seatIndex,
      seatFacing: ROOMS[room].facings?.[seatIndex],
      seatType: ROOMS[room].subzones?.[seatIndex] || 'desk',
      currentFloor: movementFloors[agent.id] || movementSample?.floor || pendingFloor,
      currentPosition: movementSample?.position || currentPosition,
      destination: [left, top],
    };
  });
  wanderStateRef.current = placedAgents;

  const roomSignature = placedAgents.map((agent) => `${agent.id}:${agent.room}`).join('|');

  // Pause two agents mid-route for a comic dust-cloud brawl, then send them
  // back on their original way from wherever they were standing.
  const triggerFight = (idA, idB, floor, position) => {
    delete movementRef.current[idA];
    delete movementRef.current[idB];
    fightingIdsRef.current.add(idA);
    fightingIdsRef.current.add(idB);
    const roster = wanderStateRef.current || [];
    const agentA = roster.find((agent) => agent.id === idA);
    const agentB = roster.find((agent) => agent.id === idB);
    const pairKey = [idA, idB].sort().join('|');
    const fightId = `fight-${pairKey}-${Date.now()}`;
    const entry = {
      id: fightId,
      pairKey,
      agentIds: [idA, idB],
      floor,
      position,
      duration: FIGHT_DURATION_MS,
      names: [agentA?.name || 'Agent', agentB?.name || 'Agent'],
      arts: [agentArtFor(agentA || {}), agentArtFor(agentB || {})],
    };
    fightsRef.current = [...fightsRef.current, entry];
    setFights(fightsRef.current);
    setAgentPositions((current) => ({ ...current, [idA]: position, [idB]: position }));
    setMovementFloors((current) => ({ ...current, [idA]: floor, [idB]: floor }));
    setMovingAgents((current) => current.filter((id) => id !== idA && id !== idB));
    fightTimeoutsRef.current[fightId] = window.setTimeout(() => resolveFight(fightId), entry.duration);
  };

  const resolveFight = (fightId) => {
    delete fightTimeoutsRef.current[fightId];
    const entry = fightsRef.current.find((fight) => fight.id === fightId);
    if (!entry) return;
    fightsRef.current = fightsRef.current.filter((fight) => fight.id !== fightId);
    setFights(fightsRef.current);
    fightCooldownRef.current[entry.pairKey] = performance.now() + FIGHT_COOLDOWN_MS;
    const roster = wanderStateRef.current || [];
    const now = performance.now();
    const resumed = [];
    for (const id of entry.agentIds) {
      fightingIdsRef.current.delete(id);
      const agent = roster.find((candidate) => candidate.id === id);
      if (!agent) continue;
      const destinationRoom = ROOMS[agent.room];
      // Inside a room with its own egress lanes (the Break Room), walk out via
      // the nearest known spot's lane instead of exiting through the front
      // door and back in — everywhere else, resume from the exact spot.
      const phases = Array.isArray(destinationRoom.egress) && destinationRoom.floor === entry.floor
        ? buildWanderPhases(destinationRoom, nearestSpotIndex(destinationRoom, entry.position), agent.seatIndex)
        : buildRoutePhases(entry.position, agent.destination, corridorWaypointRoom(entry.floor, entry.position), destinationRoom);
      const duration = Math.min(12000, Math.max(1200, routeLength(phases) * 52));
      movementRef.current[id] = { fromRoom: 'fight', toRoom: agent.room, phases, progress: 0, start: now, duration };
      resumed.push(id);
    }
    if (resumed.length) setMovingAgents((current) => [...new Set([...current, ...resumed])]);
    if (movementFrameRef.current == null && movementTickRef.current) {
      movementFrameRef.current = requestAnimationFrame(movementTickRef.current);
    }
  };

  useEffect(() => {
    const tick = () => {
      const entries = Object.entries(movementRef.current);
      if (!entries.length) {
        movementFrameRef.current = null;
        lastTickRef.current = 0;
        doorOpenSinceRef.current = {};
        return;
      }

      const time = performance.now();
      // Real elapsed since last frame, clamped so a paused/resumed loop or a
      // background tab does not jump an agent forward.
      const delta = lastTickRef.current ? Math.min(100, time - lastTickRef.current) : 16;
      lastTickRef.current = time;

      const positions = {};
      const floors = {};
      const finished = [];
      for (const [id, entry] of entries) {
        if (entry.pausedMs == null) entry.pausedMs = 0;
        let progress = Math.min(1, (time - entry.start - entry.pausedMs) / entry.duration);
        let sample = interpolateRoute(entry.phases, progress);

        // Doors: coming within approach range starts the door opening; reaching
        // the threshold of a door that has not finished opening holds the agent
        // there until it has.
        const approachRoom = roomOrder.find((room) => (
          ROOMS[room].hasDoor !== false
          && ROOMS[room].floor === sample.floor
          && isNearPoint(sample.position, ROOMS[room].entry.door, DOOR_APPROACH_RADIUS)
        ));
        if (approachRoom && doorOpenSinceRef.current[approachRoom] == null) {
          doorOpenSinceRef.current[approachRoom] = time;
        }
        const atGate = approachRoom
          && isNearPoint(sample.position, ROOMS[approachRoom].entry.door, DOOR_GATE_RADIUS)
          && (time - doorOpenSinceRef.current[approachRoom]) < DOOR_OPEN_MS;
        if (atGate && progress < 1) {
          // Freeze progress this frame by absorbing the elapsed delta.
          entry.pausedMs += delta;
          progress = Math.min(1, (time - entry.start - entry.pausedMs) / entry.duration);
          sample = interpolateRoute(entry.phases, progress);
        }

        entry.progress = progress;
        positions[id] = sample.position;
        floors[id] = sample.floor;
        if (progress >= 1) finished.push(id);
      }

      // Release door-open timers once no walker is near a given door, so the
      // next agent through has to wait for it to open again.
      for (const room of Object.keys(doorOpenSinceRef.current)) {
        const stillNear = Object.keys(positions).some((id) => (
          floors[id] === ROOMS[room]?.floor
          && isNearPoint(positions[id], ROOMS[room].entry.door, DOOR_APPROACH_RADIUS)
        ));
        if (!stillNear) delete doorOpenSinceRef.current[room];
      }

      setAgentPositions((current) => ({ ...current, ...positions }));
      setMovementFloors((current) => ({ ...current, ...floors }));
      if (finished.length) {
        for (const id of finished) delete movementRef.current[id];
        setMovingAgents((current) => current.filter((id) => !finished.includes(id)));
        setAgentPositions((current) => {
          const next = { ...current };
          for (const id of finished) delete next[id];
          return next;
        });
        setMovementFloors((current) => {
          const next = { ...current };
          for (const id of finished) delete next[id];
          return next;
        });
      }

      // Two agents whose live positions cross paths closely enough bump into
      // each other and break into a brawl instead of walking through.
      const activeIds = Object.keys(positions);
      const now = time;
      for (let i = 0; i < activeIds.length; i += 1) {
        const idA = activeIds[i];
        if (fightingIdsRef.current.has(idA)) continue;
        for (let j = i + 1; j < activeIds.length; j += 1) {
          const idB = activeIds[j];
          if (fightingIdsRef.current.has(idB)) continue;
          // Scuffles only break out in the Break Room, not on the work floor.
          if (floors[idA] !== floors[idB] || floors[idA] !== 'upper') continue;
          const pairKey = [idA, idB].sort().join('|');
          if ((fightCooldownRef.current[pairKey] || 0) > now) continue;
          const [ax, ay] = positions[idA];
          const [bx, by] = positions[idB];
          const distance = Math.hypot((ax - bx) * OFFICE_PATH.xScale, ay - by);
          if (distance < FIGHT_TRIGGER_DISTANCE) {
            triggerFight(idA, idB, floors[idA], [(ax + bx) / 2, (ay + by) / 2]);
            break;
          }
        }
      }

      movementFrameRef.current = Object.keys(movementRef.current).length
        ? requestAnimationFrame(tick)
        : null;
    };

    movementTickRef.current = tick;
    return () => {
      if (movementFrameRef.current != null) cancelAnimationFrame(movementFrameRef.current);
      movementFrameRef.current = null;
      movementRef.current = {};
      for (const timeoutId of Object.values(fightTimeoutsRef.current)) window.clearTimeout(timeoutId);
      fightTimeoutsRef.current = {};
    };
  }, []);

  // Break Room life: settled agents on break occasionally stroll to a free
  // sofa, chair or standing spot along the room's own walking lanes.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const placed = wanderStateRef.current || [];
      const breakAgents = placed.filter((agent) => agent.room === 'breakroom');
      const settled = breakAgents.filter((agent) => agent.status === 'idle' && !movementRef.current[agent.id]);
      const wandering = breakAgents.filter((agent) => movementRef.current[agent.id]).length;
      if (!settled.length || wandering >= 2 || Math.random() > 0.35) return;
      const agent = settled[Math.floor(Math.random() * settled.length)];
      const occupied = new Set(breakAgents.filter((other) => other.id !== agent.id).map((other) => other.seatIndex));
      const free = ROOMS.breakroom.spots
        .map((_, index) => index)
        .filter((index) => index !== agent.seatIndex && !occupied.has(index));
      if (!free.length) return;
      const target = free[Math.floor(Math.random() * free.length)];
      const phases = buildWanderPhases(ROOMS.breakroom, agent.seatIndex, target);
      if (!phases.length || phases[0].path.length < 2) return;
      // The room does not change, so the room-signature effect never refreshes
      // the settled-position fallback; anchor it to the new seat here.
      previousPositions.current[agent.id] = [...ROOMS.breakroom.spots[target]];
      movementRef.current[agent.id] = {
        fromRoom: 'breakroom',
        toRoom: 'breakroom',
        phases,
        progress: 0,
        start: performance.now(),
        duration: Math.min(12000, Math.max(1400, routeLength(phases) * 52)),
      };
      setWanderSeats((current) => ({ ...current, [agent.id]: target }));
      setMovingAgents((current) => [...new Set([...current, agent.id])]);
      if (movementFrameRef.current == null && movementTickRef.current) {
        movementFrameRef.current = requestAnimationFrame(movementTickRef.current);
      }
    }, 3200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextRooms = Object.fromEntries(placedAgents.map((agent) => [agent.id, agent.room]));
    const nextPositions = Object.fromEntries(placedAgents.map((agent) => [agent.id, agent.destination]));
    const prevRooms = previousRooms.current;
    const prevPositions = previousPositions.current;
    const liveIds = new Set(Object.keys(nextRooms));
    const moved = placedAgents
      .filter((agent) => prevRooms[agent.id] && prevRooms[agent.id] !== agent.room)
      .map((agent) => agent.id);

    previousRooms.current = nextRooms;
    previousPositions.current = nextPositions;

    for (const id of Object.keys(movementRef.current)) {
      if (!liveIds.has(id)) delete movementRef.current[id];
    }
    setAgentPositions((current) => {
      const stale = Object.keys(current).filter((id) => (
        !liveIds.has(id) || (!movementRef.current[id] && !moved.includes(id) && !fightingIdsRef.current.has(id))
      ));
      if (!stale.length) return current;
      const next = { ...current };
      for (const id of stale) delete next[id];
      return next;
    });
    setMovementFloors((current) => {
      const stale = Object.keys(current).filter((id) => (
        !liveIds.has(id) || (!movementRef.current[id] && !moved.includes(id) && !fightingIdsRef.current.has(id))
      ));
      if (!stale.length) return current;
      const next = { ...current };
      for (const id of stale) delete next[id];
      return next;
    });
    setMovingAgents((current) => current.filter((id) => (
      liveIds.has(id) && (movementRef.current[id] || moved.includes(id))
    )));
    setWanderSeats((current) => {
      const stale = Object.keys(current).filter((id) => !liveIds.has(id) || nextRooms[id] !== 'breakroom');
      if (!stale.length) return current;
      const next = { ...current };
      for (const id of stale) delete next[id];
      return next;
    });

    if (!moved.length) return undefined;

    const now = performance.now();
    for (const agent of placedAgents) {
      if (!moved.includes(agent.id)) continue;
      const active = movementRef.current[agent.id];
      const activeSample = active ? interpolateRoute(active.phases, active.progress) : null;
      const fallbackRoom = activeSample?.floor === ROOMS[active?.toRoom]?.floor
        ? active?.toRoom
        : active?.fromRoom || prevRooms[agent.id];
      const fallbackConfig = ROOMS[fallbackRoom] || ROOMS.meeting;
      const fromSeat = activeSample?.position
        || agentPositions[agent.id]
        || (Array.isArray(prevPositions[agent.id]) ? prevPositions[agent.id] : fallbackConfig.entry.inside);

      let fromRoomConfig = fallbackConfig;
      if (activeSample?.floor === 'ground' && fromSeat[1] >= 42 && fromSeat[1] <= 59) {
        fromRoomConfig = {
          floor: 'ground',
          entry: {
            door: [fromSeat[0], OFFICE_PATH.corridorY],
            inside: [fromSeat[0], OFFICE_PATH.corridorY],
            axis: 'vertical',
          },
        };
      } else if (
        activeSample?.floor === 'upper'
        && isNearPoint(fromSeat, OFFICE_PATH.stairPortal.upper, 8)
      ) {
        fromRoomConfig = {
          floor: 'upper',
          entry: {
            door: OFFICE_PATH.stairPortal.upper,
            inside: OFFICE_PATH.stairPortal.upper,
            axis: 'horizontal',
          },
        };
      }

      const phases = buildRoutePhases(fromSeat, agent.destination, fromRoomConfig, ROOMS[agent.room]);
      const duration = Math.min(12000, Math.max(1600, routeLength(phases) * 52));
      movementRef.current[agent.id] = {
        fromRoom: fallbackRoom,
        toRoom: agent.room,
        phases,
        progress: 0,
        start: now,
        duration,
      };
    }
    setMovingAgents((current) => [...new Set([...current, ...moved])]);
    if (movementFrameRef.current == null && movementTickRef.current) {
      movementFrameRef.current = requestAnimationFrame(movementTickRef.current);
    }
    return undefined;
  }, [roomSignature]);

  // Live kanban cards grouped per assignee so each desk shows its own stack.
  const deskCardsByAgent = useMemo(() => {
    const map = {};
    [['in_progress', 0], ['review', 1], ['backlog', 2]].forEach(([column, rank]) => {
      (kanban[column] || []).forEach((card) => {
        const key = String(card.assignee || '').toLowerCase();
        if (!key) return;
        (map[key] = map[key] || []).push({ ...card, rank });
      });
    });
    Object.values(map).forEach((cards) => cards.sort((left, right) => left.rank - right.rank));
    return map;
  }, [kanban]);

  const roomCounts = Object.fromEntries(roomOrder.map((room) => [
    room,
    placedAgents.filter((agent) => agent.room === room).length,
  ]));
  const visibleAgents = placedAgents.filter((agent) => {
    const matchesStatus = statusFilter === 'all' || agent.status === statusFilter;
    const matchesRoom = roomFilter === 'all' || agent.room === roomFilter;
    return matchesStatus && matchesRoom;
  });
  const floorRooms = roomOrder.filter((room) => ROOMS[room].floor === floorView);
  const fightingIds = useMemo(() => new Set(fights.flatMap((fight) => fight.agentIds)), [fights]);
  const floorFights = fights.filter((fight) => fight.floor === floorView);
  const floorAgents = visibleAgents.filter((agent) => agent.currentFloor === floorView);
  const meetingTaskIds = new Set(placedAgents.filter((agent) => agent.room === 'meeting' && agent.task_id).map((agent) => agent.task_id));
  const featuredProjects = projectRooms
    .map((room) => ({ ...room, meetingMatches: room.tasks?.filter((task) => meetingTaskIds.has(task.id)).length || 0 }))
    .filter((room) => room.status === 'active')
    .sort((left, right) => right.meetingMatches - left.meetingMatches || String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
    .slice(0, 3);

  const resetView = () => {
    setStatusFilter('all');
    setRoomFilter('all');
    setShowBubbles(true);
    setShowLabels(true);
    setOpenBubble(null);
    setAgentQuery('');
  };

  const livePosition = (agent) => {
    const override = agentPositions[agent.id];
    return Array.isArray(override) ? override : agent.currentPosition;
  };

  // Face the direction of travel while walking a route.
  const walkFacing = (agent) => {
    const entry = movementRef.current[agent.id];
    if (!entry) return 'right';
    const here = interpolateRoute(entry.phases, entry.progress).position;
    const ahead = interpolateRoute(entry.phases, Math.min(1, entry.progress + 0.02)).position;
    const dx = ahead[0] - here[0];
    const dy = ahead[1] - here[1];
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return 'front';
  };

  const movingSamples = placedAgents
    .filter((agent) => movingAgents.includes(agent.id))
    .map((agent) => ({ floor: agent.currentFloor, position: livePosition(agent) }));
  const openDoors = new Set(roomOrder.filter((room) => (
    movingSamples.some((sample) => (
      sample.floor === ROOMS[room].floor
      && isNearPoint(sample.position, ROOMS[room].entry.door)
    ))
  )));

  return (
    <div className="office-frame realistic-office">
      <div className="office-toolbar">
        <div className="office-actions">
          <div className="agent-search"><span>⌕</span><input value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder="Find agent…" aria-label="Search agents on the office floor" />{agentQuery && <button className="agent-search-clear" onClick={() => setAgentQuery('')} aria-label="Clear agent search">×</button>}</div>
          <div className="office-legend"><span><i className="working" />Working</span><span><i className="queued" />Queued</span><span><i className="waiting" />Waiting</span><span><i />On break</span></div>
          {!!replayAgents.length && (
            <select className="replay-agent-select" value={replayAgent} onChange={(event) => setReplayAgent(event.target.value)} disabled={replayActive} aria-label="Replay a single agent's day">
              <option value="all">All agents</option>
              {replayAgents.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <div className="replay-speed" role="group" aria-label="Replay speed">
            {[0.5, 1, 2, 4].map((speed) => (
              <button key={speed} className={replaySpeed === speed ? 'active' : ''} onClick={() => setReplaySpeed(speed)}>{speed}×</button>
            ))}
          </div>
          <button className={replayActive ? 'replay-button active' : 'replay-button'} onClick={() => { setReplayIndex(0); setReplayActive((value) => !value); }} disabled={!replayable.length}>{replayActive ? '■ Stop replay' : '▶ Replay day'}</button>
          <div className="view-control" ref={viewControlRef} style={{ display: 'contents' }}>
            <button className={controlsOpen ? 'view-button active' : 'view-button'} onClick={() => setControlsOpen(!controlsOpen)} aria-expanded={controlsOpen}>☷ <span>View</span></button>
            {controlsOpen && (
              <div className="view-menu">
                <div className="view-menu-head"><strong>Office view</strong><button onClick={() => setControlsOpen(false)} aria-label="Close view controls">×</button></div>
                <label>Show agents</label>
                <div className="control-pills">
                  {['all', 'working', 'queued', 'waiting', 'error', 'idle'].map((status) => (
                    <button className={statusFilter === status ? 'active' : ''} key={status} onClick={() => setStatusFilter(status)}>{status === 'idle' ? 'Break' : titleCase(status)}</button>
                  ))}
                </div>
                <label>Focus room</label>
                <div className="room-control-grid">
                  <button className={roomFilter === 'all' ? 'active' : ''} onClick={() => setRoomFilter('all')}>All rooms</button>
                  {roomOrder.map((room) => <button className={roomFilter === room ? 'active' : ''} key={room} onClick={() => { setRoomFilter(room); setFloorView(ROOMS[room].floor); }}>{ROOMS[room].label}</button>)}
                </div>
                <label>Background theme</label>
                <div className="theme-control-grid">
                  {Object.entries(THEMES).map(([id, option]) => (
                    <button className={theme === id ? 'active' : ''} key={id} onClick={() => setTheme(id)} aria-label={`Use ${option.label} office theme`}>
                      <span className={`theme-swatch swatch-${id}`} />
                      <b>{option.label}</b>
                    </button>
                  ))}
                </div>
                <div className="switch-row"><span>Speech bubbles</span><button className={showBubbles ? 'toggle on' : 'toggle'} onClick={() => setShowBubbles(!showBubbles)} aria-pressed={showBubbles} aria-label="Toggle speech bubbles"><i /></button></div>
                <div className="switch-row"><span>Room labels</span><button className={showLabels ? 'toggle on' : 'toggle'} onClick={() => setShowLabels(!showLabels)} aria-pressed={showLabels} aria-label="Toggle room labels"><i /></button></div>
                <div className="switch-row"><span>Demo: everyone works</span><button className={demoMode ? 'toggle on' : 'toggle'} onClick={() => setDemoMode(!demoMode)} aria-pressed={demoMode} aria-label="Toggle demo mode where every agent works at a desk"><i /></button></div>
                <button className="reset-view" onClick={resetView}>Reset view</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={mapRef} className={`office-map theme-${theme} floor-${floorView}`}>
        <div className="office-stage" style={{ '--stage-scale': stageScale }}>
        <img
          key={floorView}
          className="office-photo"
          src={floorView === 'ground' ? groundFloorPhoto : firstFloorPhoto}
          alt=""
          aria-hidden="true"
          draggable="false"
        />
        <OfficeMapArtwork />
        <div className="office-vignette" />
        <button
          className={`storey-marker floor-toggle marker-${floorView}`}
          onClick={() => { setFloorView(floorView === 'ground' ? 'upper' : 'ground'); setRoomFilter('all'); }}
          aria-label={floorView === 'ground' ? 'Switch to the first floor' : 'Switch to the ground floor'}
        >
          <span>{floorView === 'upper' ? 'FIRST FLOOR' : 'GROUND FLOOR'}</span>
          <b>{floorView === 'upper' ? 'STAFF LOUNGE' : 'WORK FLOOR'}</b>
          <small>{floorView === 'upper'
            ? `${roomCounts.breakroom} upstairs`
            : `${placedAgents.length - roomCounts.breakroom} downstairs`}</small>
          <em className="floor-switch-hint">
            <i aria-hidden="true">⇅</i>
            <span>Go to {floorView === 'upper' ? 'ground floor' : 'first floor'}</span>
            <u>{floorView === 'upper'
              ? placedAgents.length - roomCounts.breakroom
              : roomCounts.breakroom}</u>
          </em>
        </button>
        {replayEvent && <div className="replay-banner"><span>REPLAY {replayIndex + 1}/{replayable.length}</span><strong>{replayEvent.agent} · {replayEvent.task_title}</strong><small>{titleCase(replayEvent.kind)} · {new Date(replayEvent.timestamp).toLocaleString()}</small></div>}
        {floorRooms.filter((room) => ROOMS[room].hasDoor !== false).map((room) => {
          const entry = ROOMS[room].entry;
          return <div
            className={`office-door door-${entry.orientation} ${openDoors.has(room) ? 'open' : ''}`}
            key={`door-${room}`}
            data-floor={ROOMS[room].floor}
            style={{ '--door-left': `${entry.door[0]}%`, '--door-top': `${entry.door[1]}%`, '--door-texture': `url(${doorGlassTexture})` }}
            aria-hidden="true"
          ><i className="door-leaf leaf-a" /><i className="door-leaf leaf-b" /><span className="door-sensor" /></div>;
        })}
        {showLabels && floorRooms.map((room) => (
          <button className={`room-label room-${room} ${roomFilter === room ? 'selected' : ''}`} key={room} onClick={() => setRoomFilter(roomFilter === room ? 'all' : room)}>
            <span>{ROOMS[room].icon}</span>
            <p><strong>{ROOMS[room].label}</strong><small>{ROOMS[room].subtitle}</small></p>
            <em>{roomCounts[room]}</em>
          </button>
        ))}

        {featuredProjects.length > 0 && <div className={`meeting-project-stack ${featuredProjects.length === 1 ? 'single' : 'multiple'}`}>
          {featuredProjects.map((project) => <button className="meeting-project-board" key={project.id} onClick={() => onSelectProject?.(project)} aria-label={`Open ${projectName(project)} project`}>
            <span>ACTIVE PROJECT</span>
            <strong>{projectName(project)}</strong>
            <small>{project.tasks.filter((task) => task.status === 'done').length} of {project.tasks.length} tasks complete</small>
            <i><i style={{ width: `${project.progress}%` }} /></i>
            <em>{project.progress}%</em>
          </button>)}
        </div>}

        {floorFights.map((fight) => (
          <FightCloud key={fight.id} fight={fight} />
        ))}

        {floorAgents.map((agent, index) => {
          if (fightingIds.has(agent.id)) return null;
          const art = agentArtFor(agent);
          const moving = movingAgents.includes(agent.id);
          const position = livePosition(agent);
          const facing = moving ? walkFacing(agent) : facingFor(agent, index);
          const atWorkstation = !moving && agent.status === 'working' && agent.seatType === 'desk';
          const atPcWorkstation = atWorkstation && PC_WORKSTATION_ROOMS.has(agent.room);
          const seated = !moving && (
            atWorkstation
            || agent.room === 'meeting'
            || ['chair', 'sofa'].includes(agent.seatType)
          );
          const stairClass = moving && isOnStairs(position) ? 'on-stairs' : '';
          const query = agentQuery.trim().toLowerCase();
          const searchClass = query ? (agent.name.toLowerCase().includes(query) ? 'search-match' : 'search-dim') : '';
          const deskCards = deskCardsByAgent[agent.name.toLowerCase()] || [];
          return (
          <div
            className={`map-agent agent-${agent.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')} ${agent.status} ${agent.room} facing-${facing} hair-${index % 4} ${agent.subagent ? 'subagent' : ''} ${moving ? 'moving' : ''} ${seated ? 'seated' : ''} ${atWorkstation ? 'at-workstation' : ''} ${atPcWorkstation ? 'pc-workstation' : ''} ${stairClass} ${selectedAgent?.id === agent.id ? 'selected' : ''} ${searchClass}`}
            style={{ '--left': `${position[0]}%`, '--top': `${position[1]}%`, '--depth': 20 + Math.round(position[1]), '--delay': `${index * -0.8}s`, '--agent-glow': art.accent }}
            key={agent.id}
            title={`${agent.name} · ${ROOMS[agent.room].label} · ${agent.current_task || agent.status}`}
          >
            {showBubbles && <button
              className={openBubble === agent.id ? 'speech-bubble expanded' : 'speech-bubble'}
              onClick={() => setOpenBubble(openBubble === agent.id ? null : agent.id)}
              aria-expanded={openBubble === agent.id}
              aria-label={`What is ${agent.name} doing?`}
            >
              <b>{speechIntro(agent)}</b>
              <span>{agent.current_task || ROOMS[agent.room].subtitle}</span>
              {openBubble === agent.id && agent.progress_label && <AgentProgress agent={agent} labelled />}
              {openBubble === agent.id && deskCards.length > 0 && <span className="desk-card-list">
                {deskCards.slice(0, 3).map((card) => (
                  <span className={`desk-card status-${cardTone(card.status)}`} key={card.id}><i /><em>{card.title}</em></span>
                ))}
                {deskCards.length > 3 && <small>+{deskCards.length - 3} more on the board</small>}
              </span>}
              <small>{openBubble === agent.id ? 'Click to close' : 'Click to read'}</small>
            </button>}
            <button className="person-button" onClick={() => onSelectAgent?.(agent)} aria-label={`Open ${agent.name} profile`}>
              <span className="map-person">
                {atWorkstation ? <>
                  <img className="map-agent-art typing-frame typing-frame-a" src={art.typingSrc} alt="" draggable="false" />
                  <img className="map-agent-art typing-frame typing-frame-b" src={art.typingAltSrc} alt="" draggable="false" />
                  {atPcWorkstation && <span className="workstation-rig" aria-hidden="true">
                    <i className="workstation-monitor"><i /></i>
                  </span>}
                </> : <img className="map-agent-art" src={seated ? art.seatedSrc : art.src} alt="" draggable="false" />}
                <i className="role-badge">{roleIcon(agent)}</i>
              </span>
            </button>
            <span className="agent-nameplate"><b>{agent.name.length > 14 ? `${agent.name.slice(0, 12)}…` : agent.name}</b><small aria-label={agent.status} title={agent.status} /></span>
            {deskCards.length > 0 && <span className={`desk-cards ${deskCards.length > 3 ? 'busy' : ''}`} title={`${deskCards.length} task card${deskCards.length === 1 ? '' : 's'} on this desk`}><i aria-hidden="true" /><b>{deskCards.length}</b></span>}
            {!moving && !atWorkstation && agent.seatType !== 'art' && <i className={`agent-chair seat-${agent.seatType || 'desk'}`} aria-hidden="true" />}
            {agent.progress_label && <AgentProgress agent={agent} />}
          </div>
          );
        })}
        </div>

        {!floorAgents.length && <div className="quiet-office"><span>☕</span><strong>{agents.length ? 'No agents on this floor' : 'The office is quiet'}</strong><small>{agents.length ? 'Switch floors to find the team.' : 'Agents will arrive when Hermes starts working.'}</small></div>}
        <button className="fullscreen-button" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit office full screen' : 'View office full screen'}>
          <span>{isFullscreen ? '×' : '⛶'}</span>{isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
    </div>
  );
}

function FightCloud({ fight }) {
  const [left, right] = fight.arts || [];
  const [nameA, nameB] = fight.names || [];
  return (
    <div
      className="fight-cloud"
      style={{ '--left': `${fight.position[0]}%`, '--top': `${fight.position[1]}%`, '--fight-duration': `${fight.duration}ms` }}
      title={`${nameA} and ${nameB} bumped into each other`}
    >
      <span className="fight-puff puff-a" />
      <span className="fight-puff puff-b" />
      <span className="fight-puff puff-c" />
      <span className="fight-puff puff-d" />
      {left && <img className="fight-face face-a" src={left.seatedSrc || left.src} alt="" draggable="false" />}
      {right && <img className="fight-face face-b" src={right.seatedSrc || right.src} alt="" draggable="false" />}
      <span className="fight-fist fist-a">👊</span>
      <span className="fight-fist fist-b">👊</span>
      <span className="fight-spark spark-a">✦</span>
      <span className="fight-spark spark-b">✦</span>
      <span className="fight-pow pow-a">POW!</span>
      <span className="fight-pow pow-b">BONK!</span>
      <span className="fight-dust" aria-hidden="true" />
    </div>
  );
}

function AgentProgress({ agent, labelled = false }) {
  const mode = String(agent.progress_mode || '');
  // Running work advances live (scaled by real median run time); the
  // bouncing activity bar remains only when no live value is available.
  const active = mode === 'active' || mode === 'activity';
  const indeterminate = agent.progress_value == null;
  const label = String(agent.progress_label || '');
  return <span className={`map-task-progress ${active ? (indeterminate ? 'activity' : 'active') : mode} ${labelled ? 'labelled' : ''}`} title={label}>
    {labelled && <b>{label}{!indeterminate ? (active ? ` · ~${agent.progress_value}% est.` : ` · ${agent.progress_value}% workflow`) : ''}</b>}
    <span role="progressbar" aria-label={`${agent.name}: ${label}`} aria-valuemin="0" aria-valuemax="100" {...(!indeterminate ? { 'aria-valuenow': Number(agent.progress_value) || 0 } : {})}>
      <i style={!indeterminate ? { width: `${agent.progress_value}%` } : undefined} />
    </span>
  </span>;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cardTone(status) {
  if (['running', 'active', 'in_progress'].includes(status)) return 'working';
  if (status === 'blocked') return 'error';
  if (['review', 'in_review'].includes(status)) return 'waiting';
  return 'queued';
}

function projectName(room) {
  const id = String(room?.project_id || '');
  if (id && !id.startsWith('p_')) return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return room?.name || 'Active project';
}

function speechIntro(agent) {
  if (agent.subagent) return 'Temp agent helping out';
  if (agent.status === 'idle') return 'Taking a break';
  if (agent.status === 'queued') return 'Queued for work';
  if (agent.status === 'waiting') return 'Waiting on this';
  if (agent.status === 'error') return 'Needs attention';
  if (agent.name === 'Friday') return 'Coordinating the team';
  if (agent.name === 'Atlas') return 'Managing the pipeline';
  return 'Working on this';
}

function facingFor(agent, index) {
  const facings = ROOMS[agent.room]?.facings;
  if (facings && facings.length && agent.seatFacing) return agent.seatFacing;
  if (agent.room === 'meeting' && agent.seatFacing) return agent.seatFacing;
  if (agent.status === 'working') return index % 2 ? 'left' : 'right';
  return 'front';
}

function roleIcon(agent) {
  const bySource = { claude: '✱', codex: '⌬', openclaw: '☍' };
  if (bySource[agent.source]) return bySource[agent.source];
  return { Friday: '◆', Atlas: '◈', Orion: '⌕', Devin: '‹›', Quinn: '✓', Scribe: '✎', Maya: '◇', Scout: '⌁', Studio: '✦' }[agent.name] || '•';
}

export default OfficeFloor;

import Phaser from 'phaser';
import { agentArtFor } from '../agentArt';
import { CHARACTER_KEYS, characterKeyForAgent, createCharacterAnims } from './characterAnims';
import { FLOOR1_ROOMS, roomForSeat } from './floor1Rooms';
import { generateFloor } from './generateFloor';
import { assignSeats } from './assignSeats';
import {
  buildFloor1Grid, buildGeneratedGrid, findPath, randomWalkableInRect, TILE,
} from './walkGrid';

export const SCENE_KEY = 'pixel-office';

const MAP_WIDTH = 1280;
const MAP_HEIGHT = 960;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.5;
const GRID_COLS = MAP_WIDTH / 32;
const GRID_ROWS = MAP_HEIGHT / 32;

// Walking pace, px/sec. Fast enough that a cross-floor move reads as
// purposeful, slow enough to actually watch.
const WALK_SPEED = 95;
// A wandering break-room agent stands still this long between strolls.
const WANDER_PAUSE_MIN = 2200;
const WANDER_PAUSE_MAX = 6000;

// Two floors, mirroring the photo office's ground/upper split: the ground
// floor is the real Tiled map, the upper floor is generated as one
// contiguous plan (see generateFloor.js).
export const FLOORS = [
  { id: 'floor1', label: 'Ground floor' },
  { id: 'upper', label: 'Upper floor' },
];

// Seat-relative offset a sprite is nudged by when sitting, keyed by the
// chair's facing direction (from the Tiled `Chair` object layer, or the
// same direction strings used by the generated floors). The third value is
// added to the seat's base depth so a character sitting in a chair that
// faces left/right draws in front of the desk it is tucked under.
const SIT_SHIFT = {
  up: [0, 3, -10],
  down: [0, 3, 1],
  left: [0, -8, 10],
  right: [0, -8, 10],
};

// Rooms whose occupants mill about instead of sitting still. 'breakroom' is
// the canonical id destinationFor() hands out; 'lounge' is the upper floor's
// break-out space.
const WANDER_ROOMS = new Set(['breakroom', 'groundLounge', 'sofaNook']);

// Where a sprite actually stands when seated, given the chair's facing.
function seatPose(seat) {
  const shift = SIT_SHIFT[seat.direction] || SIT_SHIFT.down;
  return { x: seat.x + shift[0], y: seat.y + shift[1], depth: seat.depth + shift[2] };
}

function hexToTint(hex) {
  if (typeof hex !== 'string') return 0xffffff;
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  return Number.isNaN(value) ? 0xffffff : value;
}

// Long external-session names (e.g. "Hermes-Agent-10") are wider than the
// 32px gap between neighbouring chairs, so labels are capped hard before
// they get a chance to span into the next seat.
function truncateName(name) {
  const text = typeof name === 'string' ? name : '';
  return text.length > 10 ? `${text.slice(0, 10)}…` : text;
}

export default class PixelOfficeScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEY);
    // Set by the React wrapper; called with the clicked agent object.
    this.onSelectAgent = null;
    this.seats = [];
    this.agentSprites = new Map();
    this.floorObjects = [];
    this.currentFloorId = null;
    // Walkability grid for the active floor, plus each room's rect (keyed by
    // room id) so break-room wandering knows what bounds to stay inside.
    this.walkGrid = null;
    this.roomRects = new Map();
    // Set on every syncAgents() call so the React side can show "N agents
    // on other floors" without reaching back into the scene's internals.
    this.offFloorCount = 0;
  }

  preload() {
    const base = `${import.meta.env.BASE_URL}pixel-office/`;

    this.load.tilemapTiledJSON('tilemap', `${base}map/map.json`);

    // The ground tile layer and the Wall object layer both draw from the
    // same sheet, so it is loaded once as a spritesheet (not a plain image)
    // to give the Wall objects addressable frame indices. Generated floors
    // reuse this same texture for their floor tiles and wall bands.
    this.load.spritesheet('tiles_wall', `${base}map/FloorAndGround.png`, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('chairs', `${base}items/chair.png`, { frameWidth: 32, frameHeight: 64 });
    this.load.spritesheet('computers', `${base}items/computer.png`, { frameWidth: 96, frameHeight: 64 });
    this.load.spritesheet('whiteboards', `${base}items/whiteboard.png`, { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('vendingmachines', `${base}items/vendingmachine.png`, { frameWidth: 48, frameHeight: 72 });
    this.load.spritesheet('office', `${base}tileset/Modern_Office_Black_Shadow.png`, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('basement', `${base}tileset/Basement.png`, { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('generic', `${base}tileset/Generic.png`, { frameWidth: 32, frameHeight: 32 });

    CHARACTER_KEYS.forEach((key) => {
      this.load.spritesheet(key, `${base}character/${key}.png`, { frameWidth: 32, frameHeight: 48 });
    });
  }

  create() {
    createCharacterAnims(this.anims);
    this.agentSprites = new Map();
    this.setupCamera();
    this.loadFloor('floor1');
  }

  setupCamera() {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Scale mode is RESIZE, and the canvas's real size relative to its
    // parent isn't always settled the instant create() runs (the React
    // container's CSS aspect-ratio box can still be mid-layout), so the
    // fit-to-canvas zoom is computed here AND recomputed on every
    // subsequent Scale Manager resize — not just once at boot — or the
    // camera stays zoomed for whatever size the canvas happened to be
    // during that first, possibly-too-small, layout pass.
    const fitToCanvas = (width, height) => {
      if (!width || !height) return;
      const fitZoom = Phaser.Math.Clamp(
        Math.min(width / MAP_WIDTH, height / MAP_HEIGHT),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      camera.setZoom(fitZoom);
      camera.centerOn(MAP_WIDTH / 2, MAP_HEIGHT / 2);
    };

    fitToCanvas(this.scale.width, this.scale.height);
    this.scale.on('resize', (gameSize) => fitToCanvas(gameSize.width, gameSize.height));

    this.input.on('pointermove', (pointer) => {
      if (!pointer.isDown) return;
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    });

    this.input.on('wheel', (_pointer, _objects, _deltaX, deltaY) => {
      const nextZoom = Phaser.Math.Clamp(camera.zoom - deltaY * 0.001, MIN_ZOOM, MAX_ZOOM);
      camera.setZoom(nextZoom);
    });
  }

  // Tears down every Game Object that belongs to the *previous* floor —
  // tilemap layer, furniture groups, room labels, and every agent sprite —
  // so switching floors never leaks sprites or stacks a second tilemap on
  // top of the first. Agent sprites are included because a seat on one
  // floor is meaningless on another; syncAgents() rebuilds them fresh
  // against the new floor's seat list right after this runs.
  clearFloor() {
    this.floorObjects.forEach((object) => object.destroy(true));
    this.floorObjects = [];
    if (this.tilemap) {
      this.tilemap.destroy();
      this.tilemap = null;
    }
    for (const entry of this.agentSprites.values()) {
      entry.pulseTween?.stop();
      entry.sprite.destroy();
      entry.label.destroy();
      entry.dot.destroy();
      entry.ring.destroy();
    }
    this.agentSprites.clear();
    this.seats = [];
    this.walkGrid = null;
    this.roomRects = new Map();
  }

  // Switches the active floor: floor1 is the real Tiled map; the upper
  // floor is generated in code (generateFloor.js). Called once from
  // create() and again whenever the React side changes the floor tab.
  loadFloor(floorId) {
    this.clearFloor();
    this.currentFloorId = floorId;
    if (floorId === 'floor1') this.buildFloor1();
    else this.buildGeneratedFloor(floorId);
  }

  buildFloor1() {
    const map = this.make.tilemap({ key: 'tilemap' });
    this.tilemap = map;

    const floorAndGround = map.addTilesetImage('FloorAndGround', 'tiles_wall');
    const groundLayer = map.createLayer('Ground', floorAndGround, 0, 0);

    // Every non-chair object layer is placed the same way: a Tiled object's
    // gid, offset against its tileset's firstgid, gives the frame to draw
    // from the already-loaded spritesheet, at a position derived from the
    // object's (bottom-left-anchored) x/y/width/height.
    const placeObjectLayer = (layerName, textureKey, tilesetName, depthFor) => {
      const layer = map.getObjectLayer(layerName);
      if (!layer) return;
      const tileset = map.getTileset(tilesetName);
      const group = this.add.group();
      this.floorObjects.push(group);
      layer.objects.forEach((object) => {
        const actualX = object.x + object.width * 0.5;
        const actualY = object.y - object.height * 0.5;
        const item = group.get(actualX, actualY, textureKey, object.gid - tileset.firstgid);
        item.setDepth(depthFor ? depthFor(item, actualY) : actualY);
      });
    };

    placeObjectLayer('Wall', 'tiles_wall', 'FloorAndGround');
    placeObjectLayer('Objects', 'office', 'Modern_Office_Black_Shadow');
    placeObjectLayer('ObjectsOnCollide', 'office', 'Modern_Office_Black_Shadow');
    placeObjectLayer('GenericObjects', 'generic', 'Generic');
    placeObjectLayer('GenericObjectsOnCollide', 'generic', 'Generic');
    placeObjectLayer('Basement', 'basement', 'Basement');
    placeObjectLayer('Computer', 'computers', 'computer', (item, actualY) => actualY + item.height * 0.27);
    placeObjectLayer('Whiteboard', 'whiteboards', 'whiteboard');
    placeObjectLayer('VendingMachine', 'vendingmachines', 'vendingmachine');

    // Chairs are placed like any other object layer, but each one also
    // becomes a seat record — the desk-assignment table `syncAgents` reads
    // from — tagged with the named room (floor1Rooms.js) its coordinates
    // fall inside.
    const seats = [];
    const chairLayer = map.getObjectLayer('Chair');
    if (chairLayer) {
      const chairTileset = map.getTileset('chair');
      const chairGroup = this.add.group();
      this.floorObjects.push(chairGroup);
      chairLayer.objects.forEach((object) => {
        const actualX = object.x + object.width * 0.5;
        const actualY = object.y - object.height * 0.5;
        const item = chairGroup.get(actualX, actualY, 'chairs', object.gid - chairTileset.firstgid);
        item.setDepth(actualY);
        const direction = object.properties?.[0]?.value || 'down';
        seats.push({
          x: actualX, y: actualY, depth: actualY, direction, room: roomForSeat(actualX, actualY),
        });
      });
    }
    seats.sort((a, b) => a.y - b.y || a.x - b.x);
    this.seats = seats;

    this.walkGrid = buildFloor1Grid(map, groundLayer, seats, GRID_COLS, GRID_ROWS);
    this.roomRects = new Map(FLOOR1_ROOMS.map((room) => [room.id, room.rect]));
    this.renderRoomLabels(FLOOR1_ROOMS);
  }

  buildGeneratedFloor(floorId) {
    const data = generateFloor(floorId);
    if (!data) return;

    const floorGroup = this.add.group();
    this.floorObjects.push(floorGroup);
    data.floorTiles.forEach((tile) => {
      const item = floorGroup.get(tile.x, tile.y, tile.texture, tile.frame);
      item.setDepth(0);
    });

    const wallGroup = this.add.group();
    this.floorObjects.push(wallGroup);
    data.walls.forEach((tile) => {
      const item = wallGroup.get(tile.x, tile.y, tile.texture, tile.frame);
      item.setDepth(tile.depth ?? tile.y);
    });

    const furnitureGroup = this.add.group();
    this.floorObjects.push(furnitureGroup);
    data.furniture.forEach((piece) => {
      const item = furnitureGroup.get(piece.x, piece.y, piece.texture, piece.frame);
      item.setDepth(piece.depth ?? piece.y);
    });

    this.seats = [...data.seats].sort((a, b) => a.y - b.y || a.x - b.x);
    this.walkGrid = buildGeneratedGrid(data, GRID_COLS, GRID_ROWS);
    this.roomRects = new Map(data.rooms.map((room) => [room.id, room.rect]));
    this.renderRoomLabels(data.rooms);
  }

  // A small, low-contrast label centred over each room's top edge — legible
  // at fit-zoom without competing with the tileset art underneath it.
  renderRoomLabels(rooms) {
    rooms.forEach((room) => {
      const centerX = (room.rect.x1 + room.rect.x2) / 2;
      const label = this.add.text(centerX, room.rect.y1 + 6, room.label.toUpperCase(), {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: '#e7e1f5',
        backgroundColor: '#15111ecc',
        padding: { x: 6, y: 3 },
      });
      label.setOrigin(0.5, 0);
      label.setAlpha(0.88);
      label.setDepth(4000);
      this.floorObjects.push(label);
    });
  }

  // Moves a sprite and everything pinned to it (name label, status dot,
  // selection ring) as one unit. Depth tracks y so an agent walking below a
  // desk draws in front of it.
  placeEntry(entry, x, y, depth) {
    entry.sprite.setPosition(x, y);
    entry.sprite.setDepth(depth ?? y);
    entry.label.setPosition(x, y + entry.labelOffsetY);
    entry.dot.setPosition(x, y + entry.dotOffsetY);
    entry.ring.setPosition(x, y + 14);
    entry.ring.setDepth((depth ?? y) - 1);
  }

  playIfChanged(entry, key) {
    if (entry.sprite.anims.currentAnim?.key !== key) entry.sprite.play(key);
  }

  // Ends a journey: working agents drop into the chair's sit frame, break
  // room agents start their wander timer, everyone else idles on the spot.
  settleAtSeat(entry) {
    const pose = seatPose(entry.seat);
    entry.mode = 'settled';
    entry.path = null;

    if (WANDER_ROOMS.has(entry.seat.room)) {
      this.placeEntry(entry, pose.x, pose.y, pose.depth);
      this.playIfChanged(entry, `${entry.texture}_idle_down`);
      entry.mode = 'wander';
      entry.wanderAt = this.time.now + Phaser.Math.Between(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
      return;
    }

    this.placeEntry(entry, pose.x, pose.y, pose.depth);
    const animKey = entry.status === 'working'
      ? `${entry.texture}_sit_${entry.seat.direction}`
      : `${entry.texture}_idle_down`;
    this.playIfChanged(entry, animKey);
  }

  // Starts a walk to a world point. `goal` is 'seat' (settle on arrival) or
  // 'wander' (pause, then pick another spot). An unreachable target is not
  // worth stranding an agent over — we just place it and move on.
  walkTo(entry, target, goal) {
    if (!this.walkGrid) return;
    const path = findPath(this.walkGrid, GRID_COLS, GRID_ROWS, { x: entry.sprite.x, y: entry.sprite.y }, target);
    if (!path || !path.length) {
      if (goal === 'seat') this.settleAtSeat(entry);
      return;
    }
    entry.path = path;
    entry.pathIndex = 0;
    entry.goal = goal;
    entry.mode = 'walking';
  }

  // Phaser's per-frame tick: advances every walking agent along its path and
  // decides when a loitering break-room agent should stroll somewhere new.
  update(time, delta) {
    for (const entry of this.agentSprites.values()) {
      if (entry.mode === 'walking') this.advanceWalk(entry, delta);
      else if (entry.mode === 'wander' && time >= entry.wanderAt) this.startWander(entry);
    }
  }

  advanceWalk(entry, delta) {
    let budget = (WALK_SPEED * delta) / 1000;

    while (budget > 0 && entry.path && entry.pathIndex < entry.path.length) {
      const step = entry.path[entry.pathIndex];
      const dx = step.x - entry.sprite.x;
      const dy = step.y - entry.sprite.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= budget) {
        this.placeEntry(entry, step.x, step.y);
        budget -= distance;
        entry.pathIndex += 1;
        continue;
      }

      const nx = entry.sprite.x + (dx / distance) * budget;
      const ny = entry.sprite.y + (dy / distance) * budget;
      this.placeEntry(entry, nx, ny);
      const facing = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up');
      this.playIfChanged(entry, `${entry.texture}_run_${facing}`);
      return;
    }

    if (entry.goal === 'seat') {
      this.settleAtSeat(entry);
      return;
    }
    // Arrived at a wander stop: stand around a while before the next one.
    entry.mode = 'wander';
    entry.path = null;
    entry.wanderAt = this.time.now + Phaser.Math.Between(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
    this.playIfChanged(entry, `${entry.texture}_idle_down`);
  }

  startWander(entry) {
    const rect = this.roomRects.get(entry.seat.room);
    if (!rect) {
      entry.wanderAt = this.time.now + WANDER_PAUSE_MAX;
      return;
    }
    // Pad the rect by a tile so agents can use the room's full floor rather
    // than only the strip its seats sit on.
    const padded = {
      x1: rect.x1 - TILE, y1: rect.y1 - TILE, x2: rect.x2 + TILE, y2: rect.y2 + TILE,
    };
    const target = randomWalkableInRect(this.walkGrid, GRID_COLS, GRID_ROWS, padded);
    if (!target) {
      entry.wanderAt = this.time.now + WANDER_PAUSE_MAX;
      return;
    }
    this.walkTo(entry, target, 'wander');
  }

  // Places one sprite + label per agent, at most `this.seats.length` of
  // them, reusing existing Game Objects across calls (this runs on every
  // poll tick from the React side, so rebuilding from scratch would mean
  // constant sprite churn and animation restarts). Returns the number of
  // agents that had no seat on this floor at all — either their canonical
  // room lives on a different floor, or every seat here was already taken.
  syncAgents(agents = [], selectedId = null) {
    if (!this.seats.length) {
      this.offFloorCount = agents.length;
      return { offFloorCount: this.offFloorCount };
    }

    const { placements, offFloorCount } = assignSeats(this.seats, agents);
    this.offFloorCount = offFloorCount;

    // Label stagger is a property of seat *position*, not agent order, so
    // it is computed over placements sorted by seat (the same y-then-x
    // order seats were collected in) rather than over `agents` directly.
    const bySeatOrder = [...placements].sort((a, b) => a.seat.y - b.seat.y || a.seat.x - b.seat.x);
    const labelOffsetByAgentId = new Map();
    let staggerLabel = false;
    bySeatOrder.forEach((placement, index) => {
      const prevSeat = index > 0 ? bySeatOrder[index - 1].seat : null;
      const isAdjacentSeat = !!prevSeat
        && Math.abs(placement.seat.x - prevSeat.x) <= 40
        && Math.abs(placement.seat.y - prevSeat.y) <= 24;
      staggerLabel = isAdjacentSeat ? !staggerLabel : false;
      labelOffsetByAgentId.set(placement.agent.id, staggerLabel ? -44 : -30);
    });

    const seen = new Set();

    placements.forEach(({ agent, seat }) => {
      seen.add(agent.id);

      const labelOffsetY = labelOffsetByAgentId.get(agent.id);
      const dotOffsetY = labelOffsetY - 12;

      const textureKey = characterKeyForAgent(agent);
      const { x, y } = seatPose(seat);
      const tint = hexToTint(agentArtFor(agent).accent);
      const displayName = truncateName(agent.name);

      let entry = this.agentSprites.get(agent.id);
      const isNew = !entry;
      if (!entry) {
        const sprite = this.add.sprite(x, y, textureKey);
        sprite.setInteractive({ useHandCursor: true });
        const agentRef = { current: agent };
        let clickOrigin = null;
        sprite.on('pointerdown', (pointer) => {
          clickOrigin = { x: pointer.x, y: pointer.y };
        });
        sprite.on('pointerout', () => {
          clickOrigin = null;
        });
        sprite.on('pointerup', (pointer) => {
          if (!clickOrigin) return;
          const distance = Math.hypot(pointer.x - clickOrigin.x, pointer.y - clickOrigin.y);
          clickOrigin = null;
          if (distance <= 6) this.onSelectAgent?.(agentRef.current);
        });

        const label = this.add.text(x, y + labelOffsetY, '', {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: '#ffffff',
        });
        label.setOrigin(0.5);
        label.setStroke('#000000', 3);
        label.setDepth(5000);

        const dot = this.add.circle(x, y + dotOffsetY, 3, tint);
        dot.setDepth(5000);

        const ring = this.add.ellipse(x, y + 14, 30, 12, tint, 0.35);
        ring.setStrokeStyle(2, tint, 0.9);
        ring.setVisible(false);

        entry = {
          sprite, label, dot, ring, texture: textureKey, agentRef, mode: 'settled', path: null, pathIndex: 0, wanderAt: 0,
        };
        this.agentSprites.set(agent.id, entry);
      }

      entry.agentRef.current = agent;
      entry.labelOffsetY = labelOffsetY;
      entry.dotOffsetY = dotOffsetY;
      entry.status = agent.status;

      if (entry.texture !== textureKey) {
        entry.sprite.setTexture(textureKey);
        entry.texture = textureKey;
      }
      entry.sprite.setTint(tint);
      entry.label.setText(displayName);
      entry.dot.setFillStyle(tint);

      // An agent appearing for the first time is placed at its desk — only a
      // *reassignment* is worth animating, otherwise every poll after a page
      // load would start the whole roster marching in from wherever they
      // happened to be.
      const seatChanged = !entry.seat || entry.seat.x !== seat.x || entry.seat.y !== seat.y;
      entry.seat = seat;
      if (isNew) {
        this.settleAtSeat(entry);
      } else if (seatChanged) {
        this.walkTo(entry, { x: seat.x, y: seat.y }, 'seat');
      } else if (entry.mode === 'settled') {
        // Status can flip (working <-> idle) without the seat moving, and
        // that changes whether the agent should be sitting or wandering.
        this.settleAtSeat(entry);
      }

      const isSelected = selectedId != null && agent.id === selectedId;
      entry.ring.setDepth(entry.sprite.depth - 1);
      entry.ring.setVisible(isSelected);
      if (isSelected) {
        if (!entry.pulseTween) {
          entry.pulseTween = this.tweens.add({
            targets: entry.ring,
            scale: { from: 0.85, to: 1.3 },
            alpha: { from: 0.8, to: 0.15 },
            duration: 900,
            yoyo: true,
            repeat: -1,
          });
        }
      } else if (entry.pulseTween) {
        entry.pulseTween.stop();
        entry.pulseTween = null;
        entry.ring.setScale(1);
        entry.ring.setAlpha(1);
      }
    });

    for (const [id, entry] of this.agentSprites) {
      if (seen.has(id)) continue;
      entry.pulseTween?.stop();
      entry.sprite.destroy();
      entry.label.destroy();
      entry.dot.destroy();
      entry.ring.destroy();
      this.agentSprites.delete(id);
    }

    return { offFloorCount };
  }
}

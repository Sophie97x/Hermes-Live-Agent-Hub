// Frame layout is identical across all four character spritesheets (32x48
// frames): six-frame idle/run cycles per facing, plus four single-frame sit
// poses. Generated once per texture rather than hand-written so adding a
// fifth character sheet later is a one-line change, not 12 new blocks.
const CHARACTER_KEYS = ['adam', 'ash', 'lucy', 'nancy'];

const IDLE_FRAME_RATE = 9; // 15 * 0.6, matching SkyOffice's idle pacing
const RUN_FRAME_RATE = 15;

const DIRECTIONS = ['right', 'up', 'left', 'down'];

function buildAnimDefs() {
  const defs = [];
  DIRECTIONS.forEach((direction, index) => {
    const idleStart = index * 6;
    defs.push({ name: `idle_${direction}`, start: idleStart, end: idleStart + 5, frameRate: IDLE_FRAME_RATE, repeat: -1 });
  });
  DIRECTIONS.forEach((direction, index) => {
    const runStart = 24 + index * 6;
    defs.push({ name: `run_${direction}`, start: runStart, end: runStart + 5, frameRate: RUN_FRAME_RATE, repeat: -1 });
  });
  // Sit frames: single static frame each, indices 48-51 in down/left/right/up order.
  ['down', 'left', 'right', 'up'].forEach((direction, index) => {
    const frame = 48 + index;
    defs.push({ name: `sit_${direction}`, start: frame, end: frame, frameRate: 1, repeat: 0 });
  });
  return defs;
}

const ANIM_DEFS = buildAnimDefs();

// Keeps one character sheet tied to agent identity instead of current seat
// order, which changes whenever agents join, leave, or move between floors.
export function characterKeyForAgent(agent) {
  const identity = String(agent?.id ?? agent?.name ?? 'agent');
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return CHARACTER_KEYS[(hash >>> 0) % CHARACTER_KEYS.length];
}

// Registers `${character}_${animName}` for every character/animation pair.
// Safe to call on every scene create() — animations live on the global
// AnimationManager, so re-mounting the scene (React StrictMode, HMR) would
// otherwise throw on the duplicate key.
export function createCharacterAnims(anims) {
  CHARACTER_KEYS.forEach((character) => {
    ANIM_DEFS.forEach((def) => {
      const key = `${character}_${def.name}`;
      if (anims.exists(key)) return;
      anims.create({
        key,
        frames: anims.generateFrameNumbers(character, { start: def.start, end: def.end }),
        frameRate: def.frameRate,
        repeat: def.repeat,
      });
    });
  });
}

export { CHARACTER_KEYS };

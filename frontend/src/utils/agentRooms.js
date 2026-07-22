// Shared agent -> room assignment logic. Both the photo office
// (OfficeFloor.jsx) and the pixel office (pixel/PixelOfficeScene.js) route
// agents to the same named rooms from the same rules, so this lives in one
// place rather than drifting into two copies.

// Canonical room ids, in the photo office's display order. The pixel office
// does not have to place all seven on one floor — it can spread them across
// floors — but every agent still resolves to exactly one of these ids.
export const ROOM_IDS = ['coding', 'research', 'creative', 'operations', 'meeting', 'quality', 'breakroom'];

const HOME_ROOMS = {
  Friday: 'operations', Atlas: 'meeting', Orion: 'research', Devin: 'coding',
  Quinn: 'quality', Scribe: 'research', Maya: 'creative', Scout: 'research', Studio: 'creative',
};

export function destinationFor(agent) {
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

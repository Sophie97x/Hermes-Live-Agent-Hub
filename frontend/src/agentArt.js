import atlas from './assets/agents/atlas-v3.png';
import atlasSeated from './assets/agents/atlas-seated-v3.png';
import atlasTyping from './assets/agents/atlas-typing-back-v5.png';
import atlasTypingAlt from './assets/agents/atlas-typing-back-alt-v5.png';
import claude from './assets/agents/claude-v3.png';
import claudeSeated from './assets/agents/claude-seated-v3.png';
import claudeTyping from './assets/agents/claude-typing-back-v5.png';
import claudeTypingAlt from './assets/agents/claude-typing-back-alt-v5.png';
import codex from './assets/agents/codex-v3.png';
import codexSeated from './assets/agents/codex-seated-v3.png';
import codexTyping from './assets/agents/codex-typing-back-v5.png';
import codexTypingAlt from './assets/agents/codex-typing-back-alt-v5.png';
import devin from './assets/agents/devin-v3.png';
import devinSeated from './assets/agents/devin-seated-v3.png';
import devinTyping from './assets/agents/devin-typing-back-v5.png';
import devinTypingAlt from './assets/agents/devin-typing-back-alt-v5.png';
import friday from './assets/agents/friday-v3.png';
import fridaySeated from './assets/agents/friday-seated-v3.png';
import fridayTyping from './assets/agents/friday-typing-back-v5.png';
import fridayTypingAlt from './assets/agents/friday-typing-back-alt-v5.png';
import guest from './assets/agents/guest-v3.png';
import guestSeated from './assets/agents/guest-seated-v3.png';
import guestTyping from './assets/agents/guest-typing-back-v5.png';
import guestTypingAlt from './assets/agents/guest-typing-back-alt-v5.png';
import maya from './assets/agents/maya-v3.png';
import mayaSeated from './assets/agents/maya-seated-v3.png';
import mayaTyping from './assets/agents/maya-typing-back-v5.png';
import mayaTypingAlt from './assets/agents/maya-typing-back-alt-v5.png';
import orion from './assets/agents/orion-v3.png';
import orionSeated from './assets/agents/orion-seated-v3.png';
import orionTyping from './assets/agents/orion-typing-back-v5.png';
import orionTypingAlt from './assets/agents/orion-typing-back-alt-v5.png';
import quinn from './assets/agents/quinn-v3.png';
import quinnSeated from './assets/agents/quinn-seated-v3.png';
import quinnTyping from './assets/agents/quinn-typing-back-v5.png';
import quinnTypingAlt from './assets/agents/quinn-typing-back-alt-v5.png';
import scout from './assets/agents/scout-v3.png';
import scoutSeated from './assets/agents/scout-seated-v3.png';
import scoutTyping from './assets/agents/scout-typing-back-v5.png';
import scoutTypingAlt from './assets/agents/scout-typing-back-alt-v5.png';
import scribe from './assets/agents/scribe-v3.png';
import scribeSeated from './assets/agents/scribe-seated-v3.png';
import scribeTyping from './assets/agents/scribe-typing-back-v5.png';
import scribeTypingAlt from './assets/agents/scribe-typing-back-alt-v5.png';
import studio from './assets/agents/studio-v3.png';
import studioSeated from './assets/agents/studio-seated-v3.png';
import studioTyping from './assets/agents/studio-typing-back-v5.png';
import studioTypingAlt from './assets/agents/studio-typing-back-alt-v5.png';

const AGENT_ART = {
  friday: { src: friday, seatedSrc: fridaySeated, typingSrc: fridayTyping, typingAltSrc: fridayTypingAlt, accent: '#a98cff' },
  atlas: { src: atlas, seatedSrc: atlasSeated, typingSrc: atlasTyping, typingAltSrc: atlasTypingAlt, accent: '#5ca8ff' },
  orion: { src: orion, seatedSrc: orionSeated, typingSrc: orionTyping, typingAltSrc: orionTypingAlt, accent: '#48e4d2' },
  devin: { src: devin, seatedSrc: devinSeated, typingSrc: devinTyping, typingAltSrc: devinTypingAlt, accent: '#4f94ff' },
  quinn: { src: quinn, seatedSrc: quinnSeated, typingSrc: quinnTyping, typingAltSrc: quinnTypingAlt, accent: '#ff719d' },
  scribe: { src: scribe, seatedSrc: scribeSeated, typingSrc: scribeTyping, typingAltSrc: scribeTypingAlt, accent: '#f3b34f' },
  maya: { src: maya, seatedSrc: mayaSeated, typingSrc: mayaTyping, typingAltSrc: mayaTypingAlt, accent: '#c99cff' },
  scout: { src: scout, seatedSrc: scoutSeated, typingSrc: scoutTyping, typingAltSrc: scoutTypingAlt, accent: '#55d5a4' },
  studio: { src: studio, seatedSrc: studioSeated, typingSrc: studioTyping, typingAltSrc: studioTypingAlt, accent: '#ff806f' },
  claude: { src: claude, seatedSrc: claudeSeated, typingSrc: claudeTyping, typingAltSrc: claudeTypingAlt, accent: '#f2aa48' },
  codex: { src: codex, seatedSrc: codexSeated, typingSrc: codexTyping, typingAltSrc: codexTypingAlt, accent: '#50e5ba' },
  guest: { src: guest, seatedSrc: guestSeated, typingSrc: guestTyping, typingAltSrc: guestTypingAlt, accent: '#9ac9ff' },
};

const HERMES_AGENT_KEYS = ['friday', 'atlas', 'orion', 'devin', 'quinn', 'scribe', 'maya', 'scout', 'studio'];

export function agentArtFor(agent = {}) {
  const name = String(agent.name || '').trim().toLowerCase();
  const canonical = HERMES_AGENT_KEYS.find((key) => name === key);
  if (canonical) return AGENT_ART[canonical];
  if (agent.source === 'claude' || name.includes('claude')) return AGENT_ART.claude;
  if (agent.source === 'codex' || name.includes('codex')) return AGENT_ART.codex;
  return AGENT_ART.guest;
}

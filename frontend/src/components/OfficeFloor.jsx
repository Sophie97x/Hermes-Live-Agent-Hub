import { useEffect, useMemo, useRef, useState } from 'react';
import officeBackground from '../assets/hermes-office-expanded-midnight.jpg';
import daylightBackground from '../assets/hermes-office-expanded-daylight.jpg';
import botanicalBackground from '../assets/hermes-office-expanded-botanical.jpg';
import './OfficeFloor.css';

const ROOMS = {
  coding: {
    label: 'Coding Studio', icon: '⌘', subtitle: 'Building & shipping',
    spots: [[15, 20], [27, 20], [15, 32], [27, 32]],
  },
  research: {
    label: 'Research Library', icon: '⌕', subtitle: 'Reading & analysis',
    spots: [[43, 20], [55, 20], [43, 32], [55, 32]],
  },
  creative: {
    label: 'Creative Studio', icon: '✦', subtitle: 'Designing & making',
    spots: [[72, 20], [84, 20], [72, 32], [84, 32]],
  },
  operations: {
    label: 'Operations', icon: '◎', subtitle: 'Monitoring systems',
    spots: [[12, 69], [23, 69], [12, 81], [23, 81]],
  },
  meeting: {
    label: 'Meeting Room', icon: '◇', subtitle: 'Waiting & collaborating',
    spots: [[32, 68], [39, 68], [46, 68], [32, 79], [39, 79], [46, 79], [32, 89], [39, 89], [46, 89]],
  },
  quality: {
    label: 'Quality Lab', icon: '✓', subtitle: 'Testing & reviewing',
    spots: [[57, 69], [67, 69], [57, 81], [67, 81]],
  },
  breakroom: {
    label: 'Break Room', icon: '☕', subtitle: 'Resting & recharging',
    spots: [[75, 69], [81.5, 69], [88, 69], [94.5, 69], [75, 84], [81.5, 84], [88, 84], [94.5, 84], [84.75, 92]],
  },
};

const roomOrder = ['coding', 'research', 'creative', 'operations', 'meeting', 'quality', 'breakroom'];
const THEMES = {
  midnight: { label: 'Midnight', image: officeBackground },
  daylight: { label: 'Daylight', image: daylightBackground },
  botanical: { label: 'Botanical', image: botanicalBackground },
};

const CHARACTER_PALETTES = [
  { accent: '#7557cc', dark: '#49348d', hair: '#4b2f72', skin: '#e6aa86' },
  { accent: '#3f78b8', dark: '#294f80', hair: '#273a58', skin: '#c88968' },
  { accent: '#2d9b91', dark: '#1d6862', hair: '#176d70', skin: '#e0a17e' },
  { accent: '#4e8ed2', dark: '#315f9a', hair: '#3b2f48', skin: '#d99a73' },
  { accent: '#c85f76', dark: '#843d55', hair: '#693349', skin: '#9e634e' },
  { accent: '#b78445', dark: '#75532d', hair: '#443848', skin: '#e7ad86' },
  { accent: '#8a65cf', dark: '#593d94', hair: '#623b87', skin: '#bb765b' },
  { accent: '#3a9c8b', dark: '#256b61', hair: '#285b62', skin: '#d79570' },
  { accent: '#dd725d', dark: '#98483d', hair: '#a3474d', skin: '#e3a17c' },
];

const HOME_ROOMS = {
  Friday: 'operations', Atlas: 'meeting', Orion: 'research', Devin: 'coding',
  Quinn: 'quality', Scribe: 'research', Maya: 'creative', Scout: 'research', Studio: 'creative',
};

function destinationFor(agent) {
  const task = `${agent.current_task || ''} ${agent.name || ''}`.toLowerCase();
  if (/complete|finished|done|archived|taking a break|recharging/.test(task)) return 'breakroom';
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
  if (agent.home && ROOMS[agent.home]) return agent.home;
  return 'coding';
}

function OfficeFloor({ agents = [], onSelectAgent, selectedAgent, timeline = [] }) {
  const mapRef = useRef(null);
  const [openBubble, setOpenBubble] = useState(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [movingAgents, setMovingAgents] = useState([]);
  const previousRooms = useRef({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [showBubbles, setShowBubbles] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [replayActive, setReplayActive] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [theme, setTheme] = useState(() => {
    const savedTheme = window.localStorage.getItem('hermes-office-theme');
    return THEMES[savedTheme] ? savedTheme : 'midnight';
  });

  useEffect(() => {
    window.localStorage.setItem('hermes-office-theme', theme);
  }, [theme]);

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
  const replayable = useMemo(() => timeline.filter((event) => event.agent && ['claimed', 'started', 'completed', 'blocked', 'failed', 'review'].includes(event.kind)).slice(0, 30).reverse(), [timeline]);
  const replayEvent = replayActive ? replayable[replayIndex] : null;
  useEffect(() => {
    if (!replayActive || !replayable.length) return undefined;
    const timer = window.setTimeout(() => {
      if (replayIndex >= replayable.length - 1) {
        setReplayActive(false);
        setReplayIndex(0);
      } else {
        setReplayIndex((index) => index + 1);
      }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [replayActive, replayIndex, replayable.length]);
  const displayAgents = agents.map((agent) => agent.name.toLowerCase() === replayEvent?.agent.toLowerCase() ? {
    ...agent,
    status: ['blocked', 'failed'].includes(replayEvent.kind) ? 'waiting' : 'working',
    current_task: replayEvent.task_title,
  } : agent);
  const roomUse = Object.fromEntries(roomOrder.map((room) => [room, 0]));
  const orderedAgents = [...displayAgents].slice(0, 24).sort((left, right) => {
    const roomDifference = roomOrder.indexOf(destinationFor(left)) - roomOrder.indexOf(destinationFor(right));
    return roomDifference || left.id.localeCompare(right.id);
  });
  const placedAgents = orderedAgents.map((agent) => {
    const room = destinationFor(agent);
    const slot = roomUse[room]++;
    const spots = ROOMS[room].spots;
    const [left, top] = spots[slot % spots.length];
    const overflow = Math.floor(slot / spots.length);
    return { ...agent, room, left: left + overflow * 1.6, top: top + overflow * 1.5 };
  });

  useEffect(() => {
    const nextRooms = Object.fromEntries(placedAgents.map((agent) => [agent.id, agent.room]));
    const moved = placedAgents
      .filter((agent) => previousRooms.current[agent.id] && previousRooms.current[agent.id] !== agent.room)
      .map((agent) => agent.id);
    previousRooms.current = nextRooms;
    if (!moved.length) return undefined;
    setMovingAgents((current) => [...new Set([...current, ...moved])]);
    const timer = window.setTimeout(() => {
      setMovingAgents((current) => current.filter((id) => !moved.includes(id)));
    }, 3300);
    return () => window.clearTimeout(timer);
  }, [agents]);

  const roomCounts = Object.fromEntries(roomOrder.map((room) => [
    room,
    placedAgents.filter((agent) => agent.room === room).length,
  ]));
  const visibleAgents = placedAgents.filter((agent) => {
    const matchesStatus = statusFilter === 'all' || agent.status === statusFilter;
    const matchesRoom = roomFilter === 'all' || agent.room === roomFilter;
    return matchesStatus && matchesRoom;
  });

  const resetView = () => {
    setStatusFilter('all');
    setRoomFilter('all');
    setShowBubbles(true);
    setShowLabels(true);
    setOpenBubble(null);
  };

  return (
    <div className="office-frame realistic-office">
      <div className="office-toolbar">
        <div className="office-actions">
          <div className="office-legend"><span><i className="working" />Working</span><span><i className="queued" />Queued</span><span><i className="waiting" />Waiting</span><span><i />On break</span></div>
          <button className={replayActive ? 'replay-button active' : 'replay-button'} onClick={() => { setReplayIndex(0); setReplayActive((value) => !value); }} disabled={!replayable.length}>{replayActive ? '■ Stop replay' : '▶ Replay day'}</button>
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
                {roomOrder.map((room) => <button className={roomFilter === room ? 'active' : ''} key={room} onClick={() => setRoomFilter(room)}>{ROOMS[room].label}</button>)}
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
              <button className="reset-view" onClick={resetView}>Reset view</button>
            </div>
          )}
        </div>
      </div>

      <div ref={mapRef} className={`office-map theme-${theme}`} style={{ backgroundImage: `url(${THEMES[theme]?.image || officeBackground})` }}>
        <div className="office-vignette" />
        {replayEvent && <div className="replay-banner"><span>REPLAY {replayIndex + 1}/{replayable.length}</span><strong>{replayEvent.agent} · {replayEvent.task_title}</strong><small>{titleCase(replayEvent.kind)} · {new Date(replayEvent.timestamp).toLocaleString()}</small></div>}
        {showLabels && roomOrder.map((room) => (
          <button className={`room-label room-${room} ${roomFilter === room ? 'selected' : ''}`} key={room} onClick={() => setRoomFilter(roomFilter === room ? 'all' : room)}>
            <span>{ROOMS[room].icon}</span>
            <p><strong>{ROOMS[room].label}</strong><small>{ROOMS[room].subtitle}</small></p>
            <em>{roomCounts[room]}</em>
          </button>
        ))}

        <div className="walking-path path-horizontal" />
        <div className="walking-path path-vertical" />

        {visibleAgents.map((agent, index) => {
          const palette = CHARACTER_PALETTES[index % CHARACTER_PALETTES.length];
          const moving = movingAgents.includes(agent.id);
          const facing = facingFor(agent, index, moving);
          return (
          <div
            className={`map-agent agent-${agent.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')} ${agent.status} ${agent.room} facing-${facing} hair-${index % 4} ${moving ? 'moving' : ''} ${selectedAgent?.id === agent.id ? 'selected' : ''}`}
            style={{ '--left': `${agent.left}%`, '--top': `${agent.top}%`, '--depth': 20 + Math.round(agent.top), '--delay': `${index * -0.8}s`, '--agent-accent': palette.accent, '--agent-dark': palette.dark, '--agent-hair': palette.hair, '--agent-skin': palette.skin }}
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
              <small>{openBubble === agent.id ? 'Click to close' : 'Click to read'}</small>
            </button>}
            <button className="person-button" onClick={() => onSelectAgent?.(agent)} aria-label={`Open ${agent.name} profile`}>
              <span className="map-person">
                <i className="map-head"><i className="eyes" /></i><i className="hair" />
                <i className="map-body"><i className="role-badge">{roleIcon(agent.name)}</i></i>
                <i className="map-arm left" /><i className="map-arm right" /><i className="map-legs" />
              </span>
            </button>
            <span className="agent-nameplate"><b>{agent.name.length > 14 ? `${agent.name.slice(0, 12)}…` : agent.name}</b><small aria-label={agent.status} title={agent.status} /></span>
          </div>
          );
        })}

        {!agents.length && <div className="quiet-office"><span>☕</span><strong>The office is quiet</strong><small>Agents will arrive when Hermes starts working.</small></div>}
        <button className="fullscreen-button" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit office full screen' : 'View office full screen'}>
          <span>{isFullscreen ? '×' : '⛶'}</span>{isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
    </div>
  );
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function speechIntro(agent) {
  if (agent.status === 'idle') return 'Taking a break';
  if (agent.status === 'queued') return 'Queued for work';
  if (agent.status === 'waiting') return 'Waiting on this';
  if (agent.status === 'error') return 'Needs attention';
  if (agent.name === 'Friday') return 'Coordinating the team';
  if (agent.name === 'Atlas') return 'Managing the pipeline';
  return 'Working on this';
}

function facingFor(agent, index, moving) {
  if (moving) return index % 2 ? 'left' : 'right';
  if (agent.status === 'working') return index % 2 ? 'left' : 'right';
  return 'front';
}

function roleIcon(name) {
  return { Friday: '◆', Atlas: '◈', Orion: '⌕', Devin: '‹›', Quinn: '✓', Scribe: '✎', Maya: '◇', Scout: '⌁', Studio: '✦' }[name] || '•';
}

export default OfficeFloor;

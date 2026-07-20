import { useEffect, useMemo, useRef, useState } from 'react';
import officeBackground from '../assets/hermes-office-expanded-midnight.jpg';
import daylightBackground from '../assets/hermes-office-expanded-daylight.jpg';
import botanicalBackground from '../assets/hermes-office-expanded-botanical.jpg';
import './OfficeFloor.css';
import { buildRoute, interpolatePath, pathLength } from '../utils/pathfinding';

const DESK_FACINGS = {
  coding: ['right', 'front', 'front', 'right'],
  research: ['left', 'front', 'front', 'left'],
  creative: ['left', 'left', 'front', 'front'],
  operations: ['front', 'front', 'front', 'front'],
  quality: ['left', 'left', 'front', 'front'],
};

const ROOMS = {
  coding: {
    label: 'Coding Studio', icon: '⌘', subtitle: 'Building & shipping',
    spots: [[15, 20], [27, 20], [15, 32], [27, 32]],
    facings: DESK_FACINGS.coding,
  },
  research: {
    label: 'Research Library', icon: '⌕', subtitle: 'Reading & analysis',
    spots: [[43, 20], [55, 20], [43, 32], [55, 32]],
    facings: DESK_FACINGS.research,
  },
  creative: {
    label: 'Creative Studio', icon: '✦', subtitle: 'Designing & making',
    spots: [[72, 20], [84, 20], [72, 32], [84, 32]],
    facings: DESK_FACINGS.creative,
  },
  operations: {
    label: 'Operations', icon: '◎', subtitle: 'Monitoring systems',
    // The four monitor stations on the two painted desks.
    spots: [[10.5, 77.5], [18.7, 77.5], [13.2, 77.5], [21.2, 77.5]],
    facings: DESK_FACINGS.operations,
  },
  meeting: {
    label: 'Meeting Room', icon: '◇', subtitle: 'Waiting & collaborating',
    // Ordered around the real round-table chairs, alternating sides to avoid overlap.
    spots: [[36, 68.5], [41.7, 74], [38.7, 81.5], [33.2, 81.5], [31.6, 74], [38.7, 70.5], [41.7, 78.4], [36, 82.8], [31.6, 78.4], [33.2, 70.5]],
    facings: ['front', 'left', 'left', 'right', 'right', 'left', 'left', 'front', 'right', 'right'],
    subzones: ['art', 'art', 'art', 'art', 'art', 'art', 'art', 'art', 'art', 'art'],
  },
  quality: {
    label: 'Quality Lab', icon: '✓', subtitle: 'Testing & reviewing',
    spots: [[57, 69], [67, 69], [57, 81], [67, 81]],
    facings: DESK_FACINGS.quality,
  },
  breakroom: {
    label: 'Break Room', icon: '☕', subtitle: 'Resting & recharging',
    // Seats match the painted furniture: long sofa, dining table chairs,
    // right armchair and standing spots along the kitchen counter.
    spots: [
      [79.4, 75.5], [71.9, 80.5], [91.6, 81.5], [74.5, 76.5],
      [79.4, 82.5], [83, 70], [76.5, 80.9], [87, 70],
      [74.5, 85], [89.8, 70],
    ],
    facings: ['right', 'right', 'left', 'front', 'right', 'front', 'left', 'front', 'front', 'front'],
    subzones: ['art', 'art', 'art', 'art', 'art', 'art', 'art', 'art', 'art', 'art'],
  },
};

// Where each room's doorway meets the central corridor (map x percent).
// Measured against the painted floor plan so walks stay in the corridors.
const DOORS = {
  coding: 21.5,
  research: 55.5,
  creative: 86,
  operations: 21,
  meeting: 36.5,
  quality: 50.7,
  breakroom: 76.8,
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
  { accent: '#4e8ed2', dark: '#315f9a', hair: '#3b2b48', skin: '#d99a73' },
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

function OfficeFloor({ agents = [], onSelectAgent, selectedAgent, timeline = [], projectRooms = [], onSelectProject }) {
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
  const [statusFilter, setStatusFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [showBubbles, setShowBubbles] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
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
  const placedAgents = orderedAgents.map((agent) => {
    const room = destinationFor(agent);
    const slot = roomUse[room]++;
    const spots = ROOMS[room].spots;
    const [targetLeft, targetTop] = spots[slot % spots.length];
    const overflow = Math.floor(slot / spots.length);
    const left = targetLeft + overflow * 1.6;
    const top = targetTop + overflow * 1.5;
    const previous = previousPositions.current[agent.id];
    const currentPosition = Array.isArray(previous) ? previous : [left, top];
    const movement = movementRef.current[agent.id];
    const settled = movement?.room === room && Array.isArray(movement?.path);
    const position = settled ? interpolatePath(movement.path, movement.progress) : currentPosition;
    return {
      ...agent,
      room,
      left,
      top,
      seatFacing: ROOMS[room].facings?.[slot % spots.length],
      seatType: ROOMS[room].subzones?.[slot % spots.length] || 'desk',
      currentPosition: position,
      destination: [left, top],
    };
  });

  const roomSignature = placedAgents.map((agent) => `${agent.id}:${agent.room}`).join('|');
  useEffect(() => {
    const nextRooms = Object.fromEntries(placedAgents.map((agent) => [agent.id, agent.room]));
    const nextPositions = Object.fromEntries(placedAgents.map((agent) => [agent.id, agent.destination]));
    const prevRooms = previousRooms.current;
    const prevPositions = previousPositions.current;
    const moved = placedAgents
      .filter((agent) => prevRooms[agent.id] && prevRooms[agent.id] !== agent.room)
      .map((agent) => agent.id);

    previousRooms.current = nextRooms;
    previousPositions.current = nextPositions;

    // Drop overrides left behind by an interrupted walk (cancelled loop,
    // hot reload) so nobody freezes mid-corridor.
    setAgentPositions((current) => {
      const stale = Object.keys(current).filter((id) => !movementRef.current[id] && !moved.includes(id));
      if (!stale.length) return current;
      const next = { ...current };
      for (const id of stale) delete next[id];
      return next;
    });
    setMovingAgents((current) => current.filter((id) => movementRef.current[id] || moved.includes(id)));

    if (!moved.length) return undefined;

    const now = performance.now();
    for (const agent of placedAgents) {
      if (!moved.includes(agent.id)) continue;
      const fromRoom = prevRooms[agent.id];
      const fromSeat = Array.isArray(prevPositions[agent.id])
        ? prevPositions[agent.id]
        : [DOORS[fromRoom] ?? 50, 51.5];
      const path = buildRoute(fromSeat, agent.destination, DOORS[fromRoom] ?? 50, DOORS[agent.room] ?? 50);
      // Constant walking speed: duration scales with route length.
      const duration = Math.min(6500, Math.max(1600, pathLength(path) * 55));
      movementRef.current[agent.id] = { room: agent.room, path, progress: 0, start: now, duration };
    }
    setMovingAgents((current) => [...new Set([...current, ...moved])]);
    let frame = 0;
    const tick = () => {
      const time = performance.now();
      const positions = {};
      const finished = [];
      let anyMoving = false;
      for (const id of moved) {
        const entry = movementRef.current[id];
        if (!entry) continue;
        const progress = Math.min(1, (time - entry.start) / entry.duration);
        entry.progress = progress;
        positions[id] = interpolatePath(entry.path, progress);
        if (progress < 1) anyMoving = true;
        else finished.push(id);
      }
      if (Object.keys(positions).length) setAgentPositions((current) => ({ ...current, ...positions }));
      if (finished.length) {
        setMovingAgents((current) => current.filter((id) => !finished.includes(id)));
        setAgentPositions((current) => {
          const next = { ...current };
          for (const id of finished) delete next[id];
          return next;
        });
        for (const id of finished) delete movementRef.current[id];
      }
      if (anyMoving) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const id of moved) delete movementRef.current[id];
    };
  }, [roomSignature]);

  const roomCounts = Object.fromEntries(roomOrder.map((room) => [
    room,
    placedAgents.filter((agent) => agent.room === room).length,
  ]));
  const visibleAgents = placedAgents.filter((agent) => {
    const matchesStatus = statusFilter === 'all' || agent.status === statusFilter;
    const matchesRoom = roomFilter === 'all' || agent.room === roomFilter;
    return matchesStatus && matchesRoom;
  });
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
    const here = interpolatePath(entry.path, entry.progress);
    const ahead = interpolatePath(entry.path, Math.min(1, entry.progress + 0.02));
    const dx = ahead[0] - here[0];
    const dy = ahead[1] - here[1];
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return 'front';
  };

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
                <div className="switch-row"><span>Demo: everyone works</span><button className={demoMode ? 'toggle on' : 'toggle'} onClick={() => setDemoMode(!demoMode)} aria-pressed={demoMode} aria-label="Toggle demo mode where every agent works at a desk"><i /></button></div>
                <button className="reset-view" onClick={resetView}>Reset view</button>
              </div>
            )}
          </div>
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
        {featuredProjects.length > 0 && <div className={`meeting-project-stack ${featuredProjects.length === 1 ? 'single' : 'multiple'}`}>
          {featuredProjects.map((project) => <button className="meeting-project-board" key={project.id} onClick={() => onSelectProject?.(project)} aria-label={`Open ${projectName(project)} project`}>
            <span>ACTIVE PROJECT</span>
            <strong>{projectName(project)}</strong>
            <small>{project.tasks.filter((task) => task.status === 'done').length} of {project.tasks.length} tasks complete</small>
            <i><i style={{ width: `${project.progress}%` }} /></i>
            <em>{project.progress}%</em>
          </button>)}
        </div>}

        {visibleAgents.map((agent, index) => {
          const palette = CHARACTER_PALETTES[index % CHARACTER_PALETTES.length];
          const moving = movingAgents.includes(agent.id);
          const position = livePosition(agent);
          const facing = moving ? walkFacing(agent) : facingFor(agent, index);
          const query = agentQuery.trim().toLowerCase();
          const searchClass = query ? (agent.name.toLowerCase().includes(query) ? 'search-match' : 'search-dim') : '';
          return (
          <div
            className={`map-agent agent-${agent.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')} ${agent.status} ${agent.room} facing-${facing} hair-${index % 4} ${moving ? 'moving' : ''} ${!moving ? 'seated' : ''} ${selectedAgent?.id === agent.id ? 'selected' : ''} ${searchClass}`}
            style={{ '--left': `${position[0]}%`, '--top': `${position[1]}%`, '--depth': 20 + Math.round(position[1]), '--delay': `${index * -0.8}s`, '--agent-accent': palette.accent, '--agent-dark': palette.dark, '--agent-hair': palette.hair, '--agent-skin': palette.skin }}
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
              <small>{openBubble === agent.id ? 'Click to close' : 'Click to read'}</small>
            </button>}
            <button className="person-button" onClick={() => onSelectAgent?.(agent)} aria-label={`Open ${agent.name} profile`}>
              <span className="map-person">
                <i className="map-head"><i className="eyes" /></i><i className="hair" />
                <i className="map-body"><i className="role-badge">{roleIcon(agent)}</i></i>
                <i className="map-arm left" /><i className="map-arm right" /><i className="map-legs" />
              </span>
            </button>
            <span className="agent-nameplate"><b>{agent.name.length > 14 ? `${agent.name.slice(0, 12)}…` : agent.name}</b><small aria-label={agent.status} title={agent.status} /></span>
            {!moving && agent.seatType !== 'art' && <i className={`agent-chair seat-${agent.seatType || 'desk'}`} aria-hidden="true" />}
            {agent.progress_label && <AgentProgress agent={agent} />}
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

function AgentProgress({ agent, labelled = false }) {
  const mode = String(agent.progress_mode || '');
  // Running work advances live (scaled by real median run time); the
  // bouncing activity bar remains only when no live value is available.
  const active = mode === 'active' || mode === 'activity';
  const indeterminate = agent.progress_value == null;
  const label = String(agent.progress_label || '');
  return <span className={`map-task-progress ${active ? (indeterminate ? 'activity' : 'active') : mode} ${labelled ? 'labelled' : ''}`} title={label}>
    {labelled && <b>{label}{!indeterminate ? ` · ${agent.progress_value}% workflow` : ''}</b>}
    <span role="progressbar" aria-label={`${agent.name}: ${label}`} aria-valuemin="0" aria-valuemax="100" {...(!indeterminate ? { 'aria-valuenow': Number(agent.progress_value) || 0 } : {})}>
      <i style={!indeterminate ? { width: `${agent.progress_value}%` } : undefined} />
    </span>
  </span>;
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function projectName(room) {
  const id = String(room?.project_id || '');
  if (id && !id.startsWith('p_')) return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return room?.name || 'Active project';
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

import { useEffect, useMemo, useRef, useState } from 'react';
import KanbanBoard from './components/KanbanBoard';
import CronJobs from './components/CronJobs';
import OfficeFloor from './components/OfficeFloor';
import ProjectRooms, { ProjectRoomDrawer } from './components/ProjectRooms';
import TaskTimeline from './components/TaskTimeline';
import CommandPalette from './components/CommandPalette';
import './App.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

const navItems = [
  ['office', 'Office', '⌂'],
  ['agents', 'Agents', '◉'],
  ['projects', 'Projects', '◆'],
  ['timeline', 'Timeline', 'ϟ'],
  ['tasks', 'Task board', '▦'],
  ['schedule', 'Schedules', '◷'],
];

function formatUptime(seconds = 0) {
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function App() {
  const [agents, setAgents] = useState([]);
  const [kanban, setKanban] = useState({});
  const [cron, setCron] = useState([]);
  const [projectRooms, setProjectRooms] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [conversations, setConversations] = useState({});
  const [view, setView] = useState('office');
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [agentFilter, setAgentFilter] = useState('all');
  const [health, setHealth] = useState({ uptime_seconds: 0, alerts: [], stuck_jobs: [] });
  const [showHealth, setShowHealth] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [toast, setToast] = useState(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [desktopAlerts, setDesktopAlerts] = useState(() => window.localStorage.getItem('hermes-desktop-alerts') === 'on');
  const knownAlerts = useRef(new Set());
  const alertsReady = useRef(false);
  const knownTimeline = useRef(new Set());
  const timelineReady = useRef(false);

  useEffect(() => {
    let mounted = true;
    let disconnectTimer = null;

    const markOnline = () => {
      window.clearTimeout(disconnectTimer);
      disconnectTimer = null;
      if (mounted) setConnected(true);
    };

    const markOfflineAfterGrace = () => {
      if (disconnectTimer) return;
      disconnectTimer = window.setTimeout(() => {
        disconnectTimer = null;
        if (mounted) setConnected(false);
        fetchData();
      }, 5000);
    };

    const fetchData = async () => {
      try {
        const responses = await Promise.all([
          fetch(`${API}/api/agents`),
          fetch(`${API}/api/activity`),
          fetch(`${API}/api/kanban`),
          fetch(`${API}/api/cron`),
          fetch(`${API}/api/health`),
          fetch(`${API}/api/project-rooms`),
          fetch(`${API}/api/timeline`),
          fetch(`${API}/api/conversations`),
        ]);
        if (!responses[0].ok) throw new Error('Core API unavailable');
        const [nextAgents, , nextKanban, nextCron, nextHealth, nextRooms, nextTimeline, nextConversations] = await Promise.all(
          responses.map((response) => response.ok ? response.json() : null),
        );
        if (!mounted) return;
        setAgents(nextAgents || []);
        if (nextKanban) setKanban(nextKanban);
        if (nextCron) setCron(nextCron);
        if (nextHealth) setHealth(nextHealth);
        if (nextRooms) setProjectRooms(nextRooms);
        if (nextTimeline) setTimeline(nextTimeline);
        if (nextConversations) setConversations(nextConversations);
        markOnline();
        setLastUpdate(new Date());
      } catch {
        markOfflineAfterGrace();
      }
    };

    fetchData();
    // SSE handles the live agent state. This low-frequency refresh only picks up
    // activity/task/schedule changes and pauses completely in background tabs.
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchData();
    }, 60000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    const eventSource = new EventSource(`${API}/api/events`);
    eventSource.onopen = markOnline;
    eventSource.onerror = markOfflineAfterGrace;
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!mounted || data.type !== 'heartbeat') return;
      if (Array.isArray(data.agents)) setAgents(data.agents);
      if (data.health) setHealth(data.health);
      if (data.timeline) setTimeline(data.timeline);
      if (data.project_rooms) setProjectRooms(data.project_rooms);
      setConnected(true);
      setLastUpdate(new Date(data.timestamp || Date.now()));
    };

    return () => {
      mounted = false;
      window.clearTimeout(disconnectTimer);
      window.clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    const handleKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    const nextIds = new Set((health.alerts || []).map((alert) => alert.id));
    const newAlert = (health.alerts || []).find((alert) => !knownAlerts.current.has(alert.id));
    if (alertsReady.current && newAlert) {
      setToast(newAlert);
      window.setTimeout(() => setToast(null), 6000);
      if (desktopAlerts && window.Notification?.permission === 'granted') new window.Notification(newAlert.title, { body: newAlert.detail, tag: `hermes-${newAlert.id}` });
    }
    knownAlerts.current = nextIds;
    alertsReady.current = true;
  }, [health.alerts, desktopAlerts]);

  useEffect(() => {
    const nextIds = new Set(timeline.map((event) => event.id));
    const important = timeline.find((event) => !knownTimeline.current.has(event.id) && ['completed', 'blocked', 'failed', 'crashed', 'timed_out', 'review'].includes(event.kind));
    if (timelineReady.current && important) {
      const title = important.kind === 'completed' ? 'Task completed' : 'Hermes task needs attention';
      if (desktopAlerts && window.Notification?.permission === 'granted') new window.Notification(title, { body: `${important.agent}: ${important.task_title}`, tag: `hermes-${important.id}` });
    }
    knownTimeline.current = nextIds;
    timelineReady.current = true;
  }, [timeline, desktopAlerts]);

  const toggleDesktopAlerts = async () => {
    if (desktopAlerts) {
      setDesktopAlerts(false);
      window.localStorage.setItem('hermes-desktop-alerts', 'off');
      return;
    }
    const permission = await window.Notification?.requestPermission();
    const enabled = permission === 'granted';
    setDesktopAlerts(enabled);
    window.localStorage.setItem('hermes-desktop-alerts', enabled ? 'on' : 'off');
    if (!enabled) setToast({ title: 'Notifications remain off', detail: 'Allow notifications in your browser to enable desktop alerts.' });
  };

  const restartHub = async () => {
    setRestarting(true);
    setShowHealth(false);
    try {
      await fetch(`${API}/api/restart`, { method: 'POST' });
      window.setTimeout(() => window.location.reload(), 1800);
    } catch {
      setRestarting(false);
      setToast({ title: 'Restart failed', detail: 'The hub could not be restarted.' });
    }
  };

  const activeCount = agents.filter((agent) => agent.status === 'working').length;
  const attentionCount = agents.filter((agent) => ['waiting', 'error'].includes(agent.status)).length;
  const taskCount = useMemo(
    () => ['backlog', 'in_progress', 'review'].reduce((count, column) => count + (kanban[column]?.length || 0), 0),
    [kanban],
  );
  const allTaskCount = useMemo(
    () => Object.values(kanban).reduce((count, tasks) => count + tasks.length, 0),
    [kanban],
  );
  const allTasks = useMemo(() => Object.values(kanban).flat(), [kanban]);
  const filteredAgents = agents.filter((agent) => (
    agentFilter === 'all'
    || (agentFilter === 'attention' && ['waiting', 'error'].includes(agent.status))
    || agent.status === agentFilter
  ));

  const openAgentView = (filter) => {
    setAgentFilter(filter);
    setView('agents');
  };

  const runCommand = (command) => {
    if (command.type === 'view') setView(command.value);
    if (command.type === 'agent') setSelectedAgent(command.value);
    if (command.type === 'project') { setSelectedProject(command.value); setView('projects'); }
    if (command.type === 'task') setView('tasks');
  };

  return (
    <div className="hub-shell">
      <aside className="sidebar">
        <div className="brand-mark">H</div>
        <nav aria-label="Hub views">
          {navItems.map(([id, label, icon]) => (
            <button
              className={view === id ? 'nav-button active' : 'nav-button'}
              key={id}
              onClick={() => setView(id)}
              title={label}
            >
              <span>{icon}</span>
              <small>{label}</small>
            </button>
          ))}
        </nav>
        <button className="command-trigger" onClick={() => setCommandOpen(true)} aria-label="Open command palette">⌘ K</button>
        <div className="sidebar-footer-wrap">
          <button className="sidebar-footer" onClick={() => setShowHealth((value) => !value)} aria-expanded={showHealth}>
            <span className={connected ? 'connection-dot online' : 'connection-dot'} />
            <small>{connected ? `Online · ${formatUptime(health.uptime_seconds)}` : restarting ? 'Restarting…' : 'Hub offline'}</small>
            {!!health.alerts?.length && <em>{health.alerts.length}</em>}
          </button>
          {showHealth && (
            <aside className="health-popover">
              <header><div><strong>System health</strong><small>{health.status === 'healthy' ? 'Everything looks good' : `${health.alerts.length} item${health.alerts.length === 1 ? '' : 's'} need attention`}</small></div><button onClick={() => setShowHealth(false)} aria-label="Close system health">×</button></header>
              <div className="health-metrics"><span><small>Hub uptime</small><strong>{formatUptime(health.uptime_seconds)}</strong></span><span><small>Stuck jobs</small><strong>{health.stuck_jobs?.length || 0}</strong></span></div>
              <div className="health-alerts">
                {health.alerts?.length ? health.alerts.map((alert) => <div className={`health-alert ${alert.level}`} key={alert.id}><span>!</span><p><strong>{alert.title}</strong><small>{alert.detail.replaceAll('_', ' ')}</small></p></div>) : <p className="health-clear">✓ No failures or stuck jobs</p>}
              </div>
              <button className={`desktop-alert-button ${desktopAlerts ? 'on' : ''}`} onClick={toggleDesktopAlerts}>◉ Desktop alerts {desktopAlerts ? 'On' : 'Off'}</button>
              <button className="restart-button" onClick={restartHub} disabled={restarting}>{restarting ? 'Restarting…' : '↻ Restart hub'}</button>
            </aside>
          )}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar" aria-label="Workspace status">
          <div className="topbar-right">
            <div className="live-pill">
              <span className={connected ? 'connection-dot online' : 'connection-dot'} />
              {connected ? `Hub connected · ${activeCount} active` : 'Reconnecting'}
            </div>
            <div className="clock-block">
              <span>Updated</span>
              <strong>{lastUpdate ? lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</strong>
            </div>
          </div>
        </header>

        <section className="stats-strip" aria-label="Office overview">
          <button className="stat-card" onClick={() => openAgentView('working')} aria-label={`View ${activeCount} working agents`}><span className="stat-icon green">●</span><p><strong>{activeCount}</strong><small>Agents working</small></p><em>View →</em></button>
          <button className="stat-card" onClick={() => openAgentView('all')} aria-label={`View all ${agents.length} agents`}><span className="stat-icon violet">◆</span><p><strong>{agents.length}</strong><small>Agents visible</small></p><em>View →</em></button>
          <button className="stat-card" onClick={() => setView('tasks')} aria-label={`View ${taskCount} open tasks`}><span className="stat-icon blue">■</span><p><strong>{taskCount}</strong><small>Open tasks</small></p><em>Board →</em></button>
          <button className="stat-card" onClick={() => openAgentView('attention')} aria-label={`View ${attentionCount} agents needing attention`}><span className="stat-icon amber">◷</span><p><strong>{attentionCount}</strong><small>Need attention</small></p><em>Review →</em></button>
        </section>

        {view === 'office' && (
          <div className="office-page">
            <OfficeFloor agents={agents} onSelectAgent={setSelectedAgent} selectedAgent={selectedAgent} timeline={timeline} projectRooms={projectRooms} onSelectProject={setSelectedProject} />
          </div>
        )}

        {view === 'agents' && (
          <Panel title={agentFilter === 'all' ? 'Agent roster' : agentFilter === 'working' ? 'Agents working' : agentFilter === 'queued' ? 'Queued agents' : agentFilter === 'attention' ? 'Need attention' : agentFilter === 'error' ? 'Agent errors' : agentFilter === 'waiting' ? 'Waiting agents' : 'Agents on break'} subtitle={`${filteredAgents.length} of ${agents.length} team members shown`}>
            <div className="roster-filters" aria-label="Filter agent roster">
              {['all', 'working', 'queued', 'waiting', 'error', 'idle'].map((filter) => <button key={filter} className={agentFilter === filter ? 'active' : ''} onClick={() => setAgentFilter(filter)}>{filter === 'idle' ? 'On break' : filter.charAt(0).toUpperCase() + filter.slice(1)}</button>)}
            </div>
            <div className="roster-grid">
              {filteredAgents.length ? filteredAgents.map((agent, index) => (
                <button className="roster-card" key={agent.id} onClick={() => setSelectedAgent(agent)}>
                  <span className={`mini-avatar tone-${index % 5}`}>{agent.name.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{agent.name}</strong><small>{agent.current_task || 'Available for work'}</small><TaskProgress item={agent} compact /></span>
                  <em className={`status-text ${agent.status}`}>{agent.status}</em>
                </button>
              )) : <EmptyState message={agentFilter === 'attention' ? 'Nobody needs attention.' : agentFilter === 'working' ? 'Nobody is working right now.' : 'No agents in this view.'} />}
            </div>
          </Panel>
        )}

        {view === 'projects' && <Panel title="Project rooms" subtitle={`${projectRooms.length} projects grouped from real Hermes tasks and sessions`}><ProjectRooms rooms={projectRooms} selectedId={selectedProject?.id} onSelect={setSelectedProject} /></Panel>}

        {view === 'timeline' && <Panel title="Live task timeline" subtitle="Verified task events from assignment through completion"><TaskTimeline events={timeline} /></Panel>}

        {view === 'tasks' && <Panel title="Task board" subtitle={`${allTaskCount} task records across the live workflow and archive`}><KanbanBoard board={kanban} /></Panel>}
        {view === 'schedule' && <Panel title="Scheduled work" subtitle="Cron jobs managed by Hermes"><CronJobs jobs={cron} /></Panel>}
      </main>

      {selectedAgent && (
        <button className="agent-drawer-backdrop" aria-label="Close agent details" onClick={() => setSelectedAgent(null)}>
          <aside className="agent-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setSelectedAgent(null)}>×</button>
            <span className="drawer-avatar">{selectedAgent.name.slice(0, 2).toUpperCase()}</span>
            <p className="eyebrow">AGENT PROFILE</p>
            <h2>{selectedAgent.name}</h2>
            {selectedAgent.role && <p className="drawer-role">{selectedAgent.role} · {selectedAgent.specialty}</p>}
            <span className={`drawer-status ${selectedAgent.status}`}>{selectedAgent.status}</span>
            <div className="drawer-detail"><small>Live state</small><strong>{statusReason(selectedAgent.status_reason)}</strong></div>
            <div className="drawer-detail"><small>Current assignment</small><strong>{selectedAgent.current_task || 'Waiting for an assignment'}</strong></div>
            {selectedAgent.progress_label && <div className="drawer-detail"><small>Task progress</small><TaskProgress item={selectedAgent} /></div>}
            <div className="drawer-detail"><small>Started</small><strong>{formatTimestamp(selectedAgent.started_at)}</strong></div>
            <div className="drawer-detail"><small>Last activity</small><strong>{formatTimestamp(selectedAgent.last_activity_at)}</strong></div>
            <div className="agent-conversation"><header><small>Recent conversation</small><span>{conversations[selectedAgent.name.toLowerCase()]?.length || 0} messages</span></header>{conversations[selectedAgent.name.toLowerCase()]?.length ? conversations[selectedAgent.name.toLowerCase()].slice(-8).map((message) => <article key={message.id} className={`message-${message.role}`}><strong>{message.role === 'assistant' ? message.speaker || selectedAgent.name : message.role === 'user' ? 'You' : message.tool_name || message.role}</strong><p>{message.content || (message.tool_name ? `Used ${message.tool_name}` : 'No text content')}</p><time>{formatTimestamp(message.timestamp)}</time></article>) : <p className="conversation-empty">No linked conversation history yet.</p>}</div>
          </aside>
        </button>
      )}
      <ProjectRoomDrawer room={selectedProject} onClose={() => setSelectedProject(null)} />
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} agents={agents} rooms={projectRooms} tasks={allTasks} onCommand={runCommand} />
      {toast && <button className="failure-toast" onClick={() => { setToast(null); setShowHealth(true); }}><span>!</span><p><strong>{toast.title}</strong><small>{toast.detail}</small></p></button>}
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return <section className="content-panel"><div className="section-heading"><div><h2>{title}</h2><p className="panel-subtitle">{subtitle}</p></div></div>{children}</section>;
}

function EmptyState({ message }) {
  return <div className="empty-state"><span>◇</span><p>{message}</p><small>The office will update automatically.</small></div>;
}

function TaskProgress({ item, compact = false }) {
  if (!item?.progress_label) return null;
  const indeterminate = item.progress_value == null;
  return (
    <span className={`task-progress ${compact ? 'compact' : ''} ${item.progress_mode || ''}`}>
      <span className="task-progress-meta"><b>{item.progress_label}</b>{!compact && !indeterminate && <em>{item.progress_value}% workflow</em>}</span>
      <span className="task-progress-track" role="progressbar" aria-label={`${item.progress_label} workflow stage`} aria-valuemin="0" aria-valuemax="100" {...(!indeterminate ? { 'aria-valuenow': item.progress_value } : {})}>
        <i style={!indeterminate ? { width: `${item.progress_value}%` } : undefined} />
      </span>
    </span>
  );
}

function statusReason(reason) {
  return {
    active_run: 'Running task',
    assigned: 'Queued for work',
    blocked: 'Blocked and waiting',
    stale_heartbeat: 'Heartbeat lost',
    heartbeat_missing: 'Waiting for first heartbeat',
    worker_missing: 'Worker has not started',
    worker_stopped: 'Worker process stopped',
    run_failed: 'Latest run failed',
    session_active: 'Friday session active',
    gateway_offline: 'Hermes gateway unavailable',
    available: 'Available',
  }[reason] || 'Status unavailable';
}

function formatTimestamp(value) {
  if (!value) return 'Not active';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

export default App;

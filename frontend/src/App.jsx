import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import KanbanBoard from './components/KanbanBoard';
import CronJobs from './components/CronJobs';
import OfficeFloor from './components/OfficeFloor';
import ProjectRooms, { ProjectRoomDrawer } from './components/ProjectRooms';
import TaskTimeline from './components/TaskTimeline';
import CommandPalette from './components/CommandPalette';
import SettingsPage from './components/SettingsPage';
import { agentArtFor } from './agentArt';
import './App.css';

const PixelOffice = lazy(() => import('./components/PixelOffice'));

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

const navItems = [
  ['office', 'Office', '⌂'],
  ['agents', 'Agents', '◉'],
  ['projects', 'Projects', '◆'],
  ['timeline', 'Timeline', 'ϟ'],
  ['tasks', 'Task board', '▦'],
  ['schedule', 'Schedules', '◷'],
  ['settings', 'Settings', '⚙'],
];

const SOURCE_LABELS = { claude: 'Claude Code', codex: 'Codex', openclaw: 'OpenClaw' };
const viewIds = new Set(navItems.map(([id]) => id));

function viewFromLocation() {
  const requested = new URLSearchParams(window.location.search).get('view');
  return viewIds.has(requested) ? requested : 'office';
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows, columns) {
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = columns.map(([, label]) => escape(label)).join(',');
  const lines = rows.map((row) => columns.map(([key]) => escape(row[key])).join(','));
  return [header, ...lines].join('\n');
}

function formatUptime(seconds = 0) {
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatTokens(count = 0) {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}k`;
  return String(count);
}

function formatCost(value) {
  return value == null ? '' : ` · ~$${value.toFixed(2)}`;
}

// XP comes from completed task history; levels use widening thresholds so
// early levels feel quick and later ones take real work.
const LEVEL_THRESHOLDS = [0, 3, 8, 15, 25, 40];

function levelFor(xp) {
  let level = 1;
  LEVEL_THRESHOLDS.forEach((minimum, index) => {
    if (xp >= minimum) level = index + 1;
  });
  return level;
}

function App() {
  const [agents, setAgents] = useState([]);
  const [kanban, setKanban] = useState({});
  const [cron, setCron] = useState([]);
  const [projectRooms, setProjectRooms] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [conversations, setConversations] = useState({});
  const [view, setView] = useState(viewFromLocation);
  const [officeStyle, setOfficeStyle] = useState(() => {
    const saved = window.localStorage.getItem('hermes.officeStyle');
    return saved === 'pixel' ? 'pixel' : 'photo';
  });
  useEffect(() => {
    window.localStorage.setItem('hermes.officeStyle', officeStyle);
  }, [officeStyle]);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  // While an element is fullscreen the browser paints only that element's
  // subtree, so app-level overlays must be portalled into it to stay visible.
  const [fullscreenHost, setFullscreenHost] = useState(null);
  const [agentFilter, setAgentFilter] = useState('all');
  const [health, setHealth] = useState({ uptime_seconds: 0, alerts: [], stuck_jobs: [] });
  const [usage, setUsage] = useState(null);
  const [showHealth, setShowHealth] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [toast, setToast] = useState(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsData, setSettingsData] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [desktopAlerts, setDesktopAlerts] = useState(() => window.localStorage.getItem('hermes-desktop-alerts') === 'on');
  const [uiTheme, setUiTheme] = useState(() => window.localStorage.getItem('hermes-ui-theme') === 'light' ? 'light' : 'dark');
  useEffect(() => {
    const syncFullscreenHost = () => setFullscreenHost(
      document.fullscreenElement || document.webkitFullscreenElement || null,
    );
    syncFullscreenHost();
    document.addEventListener('fullscreenchange', syncFullscreenHost);
    document.addEventListener('webkitfullscreenchange', syncFullscreenHost);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenHost);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenHost);
    };
  }, []);

  const knownAlerts = useRef(new Set());
  const agentsRef = useRef([]);
  const alertsReady = useRef(false);
  const knownTimeline = useRef(new Set());
  const timelineReady = useRef(false);
  const wasConnected = useRef(false);
  const connectionReady = useRef(false);

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
        if (!mounted) return;
        setConnected(false);
        fetchData();
      }, 5000);
    };

    const fetchData = async () => {
      try {
        const responses = await Promise.all([
          fetch(`${API}/api/agents`),
          fetch(`${API}/api/kanban`),
          fetch(`${API}/api/cron`),
          fetch(`${API}/api/health`),
          fetch(`${API}/api/project-rooms`),
          fetch(`${API}/api/timeline`),
          fetch(`${API}/api/conversations`),
          fetch(`${API}/api/usage`),
        ]);
        if (!responses[0].ok) throw new Error('Core API unavailable');
        const [nextAgents, nextKanban, nextCron, nextHealth, nextRooms, nextTimeline, nextConversations, nextUsage] = await Promise.all(
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
        if (nextUsage) setUsage(nextUsage);
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
    }, 5000);
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
    fetch(`${API}/api/settings`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setSettingsData(data); })
      .catch(() => {});
  }, []);

  const saveSettings = async (patch) => {
    setSavingSettings(true);
    try {
      const response = await fetch(`${API}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error('save failed');
      setSettingsData(await response.json());
      setToast({ title: 'Settings saved', detail: 'Agent sources update on the next refresh.' });
    } catch {
      setToast({ title: 'Save failed', detail: 'The hub could not save the settings file.' });
    } finally {
      setSavingSettings(false);
      window.setTimeout(() => setToast(null), 4000);
    }
  };

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
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') !== view) {
      params.set('view', view);
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    }
  }, [view]);

  useEffect(() => {
    const handlePopState = () => setView(viewFromLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', uiTheme);
    window.localStorage.setItem('hermes-ui-theme', uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    if (connectionReady.current && !wasConnected.current && connected) {
      setToast({ title: 'Reconnected', detail: 'Live updates from the hub have resumed.' });
      window.setTimeout(() => setToast(null), 4000);
    }
    wasConnected.current = connected;
    connectionReady.current = true;
  }, [connected]);

  useEffect(() => {
    const nextIds = new Set((health.alerts || []).map((alert) => alert.id));
    const newAlert = (health.alerts || []).find((alert) => !knownAlerts.current.has(alert.id));
    if (alertsReady.current && newAlert) {
      setToast(newAlert);
      window.setTimeout(() => setToast(null), 6000);
      if (desktopAlerts && window.Notification?.permission === 'granted') {
        const notification = new window.Notification(newAlert.title, { body: newAlert.detail, tag: `hermes-${newAlert.id}` });
        notification.onclick = () => {
          window.focus();
          setShowHealth(true);
        };
      }
    }
    knownAlerts.current = nextIds;
    alertsReady.current = true;
  }, [health.alerts, desktopAlerts]);

  useEffect(() => {
    const nextIds = new Set(timeline.map((event) => event.id));
    const important = timeline.find((event) => !knownTimeline.current.has(event.id) && ['completed', 'blocked', 'failed', 'crashed', 'timed_out', 'review'].includes(event.kind));
    if (timelineReady.current && important) {
      const title = important.kind === 'completed' ? 'Task completed' : 'Hermes task needs attention';
      if (desktopAlerts && window.Notification?.permission === 'granted') {
        const notification = new window.Notification(title, { body: `${important.agent}: ${important.task_title}`, tag: `hermes-${important.id}` });
        notification.onclick = () => {
          window.focus();
          const match = agentsRef.current.find((agent) => agent.name.toLowerCase() === String(important.agent || '').toLowerCase());
          if (match) setSelectedAgent(match);
          else setView('timeline');
        };
      }
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

  // Decorate every agent with XP and level derived from finished task history.
  // External agents match by name prefix ("Claude Code · repo" → "Claude Code").
  const roster = useMemo(() => {
    const completedByAssignee = {};
    ['completed', 'archive'].forEach((column) => {
      (kanban[column] || []).forEach((task) => {
        const key = String(task.assignee || '').toLowerCase();
        if (key) completedByAssignee[key] = (completedByAssignee[key] || 0) + 1;
      });
    });
    return agents.map((agent) => {
      const name = agent.name.toLowerCase();
      const prefix = name.split(' · ')[0];
      const xp = completedByAssignee[name] ?? completedByAssignee[prefix] ?? 0;
      return { ...agent, xp, level: levelFor(xp) };
    });
  }, [agents, kanban]);

  // Notification click handlers look agents up outside React's render cycle,
  // so they need the decorated roster, not the raw fetch payload.
  useEffect(() => {
    agentsRef.current = roster;
  }, [roster]);

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
  const workload = useMemo(() => {
    const byAgent = {};
    const bump = (name, key) => {
      if (!name) return;
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      byAgent[label] = byAgent[label] || { name: label, completed: 0, active: 0 };
      byAgent[label][key] += 1;
    };
    (kanban.completed || []).forEach((task) => bump(task.assignee, 'completed'));
    (kanban.in_progress || []).forEach((task) => bump(task.assignee, 'active'));
    return Object.values(byAgent).sort((a, b) => (b.completed + b.active) - (a.completed + a.active));
  }, [kanban]);
  const filteredAgents = roster.filter((agent) => (
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

  const exportTasks = (format) => {
    if (format === 'json') { downloadFile('hermes-tasks.json', JSON.stringify(allTasks, null, 2), 'application/json'); return; }
    downloadFile('hermes-tasks.csv', toCsv(allTasks, [
      ['id', 'ID'], ['title', 'Title'], ['assignee', 'Assignee'], ['status', 'Status'], ['priority', 'Priority'],
      ['project', 'Project'], ['created_at', 'Created'], ['finished_at', 'Finished'],
    ]), 'text/csv');
  };

  const exportTimeline = (format) => {
    if (format === 'json') { downloadFile('hermes-timeline.json', JSON.stringify(timeline, null, 2), 'application/json'); return; }
    downloadFile('hermes-timeline.csv', toCsv(timeline, [
      ['timestamp', 'Timestamp'], ['agent', 'Agent'], ['kind', 'Kind'], ['task_title', 'Task'], ['detail', 'Detail'],
    ]), 'text/csv');
  };

  // Overlays render in place normally, but must be portalled into the
  // fullscreen element while one is open or the browser will not paint them.
  const inFullscreenHost = (node) => (fullscreenHost ? createPortal(node, fullscreenHost) : node);

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
        <button className="theme-trigger" onClick={() => setUiTheme((value) => value === 'dark' ? 'light' : 'dark')} aria-label={uiTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={uiTheme === 'dark' ? 'Light theme' : 'Dark theme'}>{uiTheme === 'dark' ? '☀' : '☾'}</button>
        <div className="sidebar-footer-wrap">
          <button className="sidebar-footer" onClick={() => setShowHealth((value) => !value)} aria-expanded={showHealth}>
            <span className={connected ? 'connection-dot online' : 'connection-dot'} />
            <small>{connected ? `Online · ${formatUptime(health.uptime_seconds)}` : restarting ? 'Restarting…' : 'Hub offline'}</small>
            {!!health.alerts?.length && <em>{health.alerts.length}</em>}
          </button>
          {showHealth && createPortal(
            <aside className="health-popover">
              <header><div><strong>System health</strong><small>{health.status === 'healthy' ? 'Everything looks good' : `${health.alerts.length} item${health.alerts.length === 1 ? '' : 's'} need attention`}</small></div><button onClick={() => setShowHealth(false)} aria-label="Close system health">×</button></header>
              <div className="health-metrics"><span><small>Hub uptime</small><strong>{formatUptime(health.uptime_seconds)}</strong></span><span><small>Stuck jobs</small><strong>{health.stuck_jobs?.length || 0}</strong></span></div>
              {!!usage?.totals?.sessions && (
                <div className="health-usage">
                  <header><small>Tokens · last {usage.window_hours}h of external sessions</small><strong>{formatTokens(usage.totals.total_tokens)}{formatCost(usage.totals.est_cost)}</strong></header>
                  {usage.sources.map((row) => (
                    <span key={row.source}><small>{row.label} · {row.sessions} session{row.sessions === 1 ? '' : 's'}</small><em>{formatTokens(row.total_tokens)}{formatCost(row.est_cost)}</em></span>
                  ))}
                </div>
              )}
              <div className="health-alerts">
                {health.alerts?.length ? health.alerts.map((alert) => <div className={`health-alert ${alert.level}`} key={alert.id}><span>!</span><p><strong>{alert.title}</strong><small>{alert.detail.replaceAll('_', ' ')}</small></p></div>) : <p className="health-clear">✓ No failures or stuck jobs</p>}
              </div>
              <button className={`desktop-alert-button ${desktopAlerts ? 'on' : ''}`} onClick={toggleDesktopAlerts}>◉ Desktop alerts {desktopAlerts ? 'On' : 'Off'}</button>
              <button className="restart-button" onClick={restartHub} disabled={restarting}>{restarting ? 'Restarting…' : '↻ Restart hub'}</button>
            </aside>,
            document.body
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
            <div className="office-style-switch" role="group" aria-label="Office view style">
              <button type="button" className={officeStyle === 'photo' ? 'active' : ''} aria-pressed={officeStyle === 'photo'} onClick={() => setOfficeStyle('photo')}>Photo</button>
              <button type="button" className={officeStyle === 'pixel' ? 'active' : ''} aria-pressed={officeStyle === 'pixel'} onClick={() => setOfficeStyle('pixel')}>Pixel</button>
            </div>
            {officeStyle === 'photo' ? (
              <OfficeFloor agents={roster} onSelectAgent={setSelectedAgent} selectedAgent={selectedAgent} timeline={timeline} projectRooms={projectRooms} onSelectProject={setSelectedProject} kanban={kanban} />
            ) : (
              <Suspense fallback={<div className="pixel-office-loading" role="status">Loading pixel office…</div>}>
                <PixelOffice agents={roster} selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent} />
              </Suspense>
            )}
          </div>
        )}

        {view === 'agents' && (
          <Panel title={agentFilter === 'all' ? 'Agent roster' : agentFilter === 'working' ? 'Agents working' : agentFilter === 'queued' ? 'Queued agents' : agentFilter === 'attention' ? 'Need attention' : agentFilter === 'error' ? 'Agent errors' : agentFilter === 'waiting' ? 'Waiting agents' : 'Agents on break'} subtitle={`${filteredAgents.length} of ${agents.length} team members shown`}>
            {!!workload.length && <AgentWorkload workload={workload} />}
            <div className="roster-filters" aria-label="Filter agent roster">
              {['all', 'working', 'queued', 'waiting', 'error', 'idle'].map((filter) => <button key={filter} className={agentFilter === filter ? 'active' : ''} onClick={() => setAgentFilter(filter)}>{filter === 'idle' ? 'On break' : filter.charAt(0).toUpperCase() + filter.slice(1)}</button>)}
            </div>
            <div className="roster-grid">
              {filteredAgents.length ? filteredAgents.map((agent) => (
                <button className="roster-card" key={agent.id} onClick={() => setSelectedAgent(agent)}>
                  <AgentAvatar agent={agent} className="mini-avatar" />
                  <span><strong>{agent.name}{SOURCE_LABELS[agent.source] && <i className="source-badge">{SOURCE_LABELS[agent.source]}</i>}</strong><small>{agent.current_task || 'Available for work'}</small><TaskProgress item={agent} compact /></span>
                  <em className={`status-text ${agent.status}`}>{agent.status}</em>
                </button>
              )) : <EmptyState message={agentFilter === 'attention' ? 'Nobody needs attention.' : agentFilter === 'working' ? 'Nobody is working right now.' : 'No agents in this view.'} />}
            </div>
          </Panel>
        )}

        {view === 'projects' && <Panel title="Project rooms" subtitle={`${projectRooms.length} projects grouped from real Hermes tasks and sessions`}><ProjectRooms rooms={projectRooms} selectedId={selectedProject?.id} onSelect={setSelectedProject} /></Panel>}

        {view === 'timeline' && <Panel title="Live task timeline" subtitle="Verified task events from assignment through completion" actions={<ExportButtons onExport={exportTimeline} disabled={!timeline.length} />}><TaskTimeline events={timeline} /></Panel>}

        {view === 'tasks' && <Panel title="Task board" subtitle={`${allTaskCount} task records across the live workflow and archive`} actions={<ExportButtons onExport={exportTasks} disabled={!allTasks.length} />}><KanbanBoard board={kanban} /></Panel>}
        {view === 'schedule' && <Panel title="Scheduled work" subtitle="Cron jobs managed by Hermes"><CronJobs jobs={cron} /></Panel>}
        {view === 'settings' && <Panel title="Settings" subtitle="Configure which local coding agents join the office"><SettingsPage data={settingsData} onSave={saveSettings} saving={savingSettings} /></Panel>}
      </main>

      {selectedAgent && inFullscreenHost(
        <button className="agent-drawer-backdrop" aria-label="Close agent details" onClick={() => setSelectedAgent(null)}>
          <aside className="agent-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setSelectedAgent(null)}>×</button>
            <AgentAvatar agent={selectedAgent} className="drawer-avatar" />
            <p className="eyebrow">AGENT PROFILE</p>
            <h2>{selectedAgent.name}</h2>
            {selectedAgent.role && <p className="drawer-role">{selectedAgent.role} · {selectedAgent.specialty}</p>}
            {SOURCE_LABELS[selectedAgent.source] && <p className="drawer-role">Discovered from {SOURCE_LABELS[selectedAgent.source]} session files on this machine</p>}
            <span className={`drawer-status ${selectedAgent.status}`}>{selectedAgent.status}</span>
            <div className="drawer-detail"><small>Live state</small><strong>{statusReason(selectedAgent.status_reason)}</strong></div>
            <div className="drawer-detail"><small>Current assignment</small><strong>{selectedAgent.current_task || 'Waiting for an assignment'}</strong></div>
            {selectedAgent.progress_label && <div className="drawer-detail"><small>Task progress</small><TaskProgress item={selectedAgent} /></div>}
            <div className="drawer-detail"><small>Started</small><strong>{formatTimestamp(selectedAgent.started_at)}</strong></div>
            <div className="drawer-detail"><small>Last activity</small><strong>{formatTimestamp(selectedAgent.last_activity_at)}</strong></div>
            {selectedAgent.level != null && <div className="drawer-detail"><small>Experience</small><strong>Level {selectedAgent.level} · {selectedAgent.xp} task{selectedAgent.xp === 1 ? '' : 's'} completed</strong></div>}
            {!!selectedAgent.usage?.total_tokens && <div className="drawer-detail"><small>Session tokens</small><strong>{formatTokens(selectedAgent.usage.total_tokens)}{formatCost(selectedAgent.usage.est_cost)}{selectedAgent.usage.model ? ` · ${selectedAgent.usage.model}` : ''}</strong></div>}
            {selectedAgent.resume_command && (
              <div className="drawer-detail resume-detail">
                <small>Resume in terminal</small>
                <code className="resume-command">{selectedAgent.resume_command}</code>
                <button
                  className="resume-copy"
                  onClick={() => {
                    navigator.clipboard?.writeText(selectedAgent.resume_command)
                      .then(() => { setToast({ title: 'Command copied', detail: 'Paste it in a terminal to pick the session back up.' }); window.setTimeout(() => setToast(null), 3000); })
                      .catch(() => { setToast({ title: 'Copy failed', detail: 'Select the command text and copy it manually.' }); window.setTimeout(() => setToast(null), 4000); });
                  }}
                >⧉ Copy command</button>
              </div>
            )}
            <div className="agent-conversation"><header><small>Recent conversation</small><span>{conversations[selectedAgent.name.toLowerCase()]?.length || 0} messages</span></header>{conversations[selectedAgent.name.toLowerCase()]?.length ? conversations[selectedAgent.name.toLowerCase()].slice(-8).map((message) => <article key={message.id} className={`message-${message.role}`}><strong>{message.role === 'assistant' ? message.speaker || selectedAgent.name : message.role === 'user' ? 'You' : message.tool_name || message.role}</strong><p>{message.content || (message.tool_name ? `Used ${message.tool_name}` : 'No text content')}</p><time>{formatTimestamp(message.timestamp)}</time></article>) : <p className="conversation-empty">No linked conversation history yet.</p>}</div>
          </aside>
        </button>
      )}
      {inFullscreenHost(<ProjectRoomDrawer room={selectedProject} onClose={() => setSelectedProject(null)} />)}
      {inFullscreenHost(<CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} agents={roster} rooms={projectRooms} tasks={allTasks} onCommand={runCommand} />)}
      {toast && <button className="failure-toast" onClick={() => { setToast(null); setShowHealth(true); }}><span>!</span><p><strong>{toast.title}</strong><small>{toast.detail}</small></p></button>}
    </div>
  );
}

function Panel({ title, subtitle, actions, children }) {
  return <section className="content-panel"><div className="section-heading"><div><h2>{title}</h2><p className="panel-subtitle">{subtitle}</p></div>{actions}</div>{children}</section>;
}

function AgentAvatar({ agent, className }) {
  const art = agentArtFor(agent);
  return <span className={`${className} agent-avatar-art`} style={{ '--agent-art-accent': art.accent }}><img src={art.src} alt="" draggable="false" /></span>;
}

function ExportButtons({ onExport, disabled = false }) {
  return (
    <div className="export-buttons">
      <button disabled={disabled} onClick={() => onExport('csv')}>⇩ CSV</button>
      <button disabled={disabled} onClick={() => onExport('json')}>⇩ JSON</button>
    </div>
  );
}

function AgentWorkload({ workload }) {
  const max = Math.max(1, ...workload.map((entry) => entry.completed + entry.active));
  return (
    <div className="agent-workload">
      <header><strong>Workload</strong><small>Completed and active tasks per agent</small></header>
      <div className="workload-rows">
        {workload.map((entry) => (
          <div className="workload-row" key={entry.name}>
            <span>{entry.name}</span>
            <i>
              {!!entry.completed && <b className="done" style={{ width: `${(entry.completed / max) * 100}%` }} />}
              {!!entry.active && <b className="active" style={{ width: `${(entry.active / max) * 100}%` }} />}
            </i>
            <em>{entry.completed} done{entry.active ? ` · ${entry.active} active` : ''}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ message }) {
  return <div className="empty-state"><span>◇</span><p>{message}</p><small>The office will update automatically.</small></div>;
}

function TaskProgress({ item, compact = false }) {
  if (!item?.progress_label) return null;
  const mode = String(item.progress_mode || '');
  // Running work shows a live advancing bar with a sheen; the bouncing
  // activity bar remains only when no live value is available.
  const active = mode === 'active' || mode === 'activity';
  const indeterminate = item.progress_value == null;
  return (
    <span className={`task-progress ${compact ? 'compact' : ''} ${active ? (indeterminate ? 'activity' : 'active') : mode}`}>
      <span className="task-progress-meta"><b>{item.progress_label}</b>{!compact && !indeterminate && <em>{active ? `~${item.progress_value}% est.` : `${item.progress_value}% workflow`}</em>}</span>
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

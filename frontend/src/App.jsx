import { useEffect, useMemo, useState } from 'react';
import ActivityFeed from './components/ActivityFeed';
import KanbanBoard from './components/KanbanBoard';
import CronJobs from './components/CronJobs';
import OfficeFloor from './components/OfficeFloor';
import './App.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

const navItems = [
  ['office', 'Office', '⌂'],
  ['agents', 'Agents', '◉'],
  ['tasks', 'Task board', '▦'],
  ['activity', 'Activity', 'ϟ'],
  ['schedule', 'Schedules', '◷'],
];

function App() {
  const [agents, setAgents] = useState([]);
  const [activity, setActivity] = useState([]);
  const [kanban, setKanban] = useState({});
  const [cron, setCron] = useState([]);
  const [view, setView] = useState('office');
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentFilter, setAgentFilter] = useState('all');

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      try {
        const responses = await Promise.all([
          fetch(`${API}/api/agents`),
          fetch(`${API}/api/activity`),
          fetch(`${API}/api/kanban`),
          fetch(`${API}/api/cron`),
        ]);
        if (!responses.every((response) => response.ok)) throw new Error('API unavailable');
        const [nextAgents, nextActivity, nextKanban, nextCron] = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (!mounted) return;
        setAgents(nextAgents || []);
        setActivity(nextActivity || []);
        setKanban(nextKanban || {});
        setCron(nextCron || []);
        setConnected(true);
        setLastUpdate(new Date());
      } catch {
        if (mounted) setConnected(false);
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
    eventSource.onopen = () => mounted && setConnected(true);
    eventSource.onerror = () => mounted && setConnected(false);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!mounted || data.type !== 'heartbeat') return;
      if (Array.isArray(data.agents)) setAgents(data.agents);
      setConnected(true);
      setLastUpdate(new Date(data.timestamp || Date.now()));
    };

    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      eventSource.close();
    };
  }, []);

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
  const filteredAgents = agents.filter((agent) => (
    agentFilter === 'all'
    || (agentFilter === 'attention' && ['waiting', 'error'].includes(agent.status))
    || agent.status === agentFilter
  ));

  const openAgentView = (filter) => {
    setAgentFilter(filter);
    setView('agents');
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
        <div className="sidebar-footer">
          <span className={connected ? 'connection-dot online' : 'connection-dot'} />
          <small>{connected ? `Hub connected · ${activeCount} active` : 'Hub offline'}</small>
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
            <OfficeFloor agents={agents} onSelectAgent={setSelectedAgent} selectedAgent={selectedAgent} />
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
                  <span><strong>{agent.name}</strong><small>{agent.current_task || 'Available for work'}</small></span>
                  <em className={`status-text ${agent.status}`}>{agent.status}</em>
                </button>
              )) : <EmptyState message={agentFilter === 'attention' ? 'Nobody needs attention.' : agentFilter === 'working' ? 'Nobody is working right now.' : 'No agents in this view.'} />}
            </div>
          </Panel>
        )}

        {view === 'tasks' && <Panel title="Task board" subtitle={`${allTaskCount} task records across the live workflow and archive`}><KanbanBoard board={kanban} /></Panel>}
        {view === 'activity' && <Panel title="Live activity" subtitle="Recent Hermes sessions and events"><ActivityFeed activity={activity} /></Panel>}
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
            <div className="drawer-detail"><small>Started</small><strong>{formatTimestamp(selectedAgent.started_at)}</strong></div>
            <div className="drawer-detail"><small>Last activity</small><strong>{formatTimestamp(selectedAgent.last_activity_at)}</strong></div>
          </aside>
        </button>
      )}
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return <section className="content-panel"><div className="section-heading"><div><h2>{title}</h2><p className="panel-subtitle">{subtitle}</p></div></div>{children}</section>;
}

function EmptyState({ message }) {
  return <div className="empty-state"><span>◇</span><p>{message}</p><small>The office will update automatically.</small></div>;
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

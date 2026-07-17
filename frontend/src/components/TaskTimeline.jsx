import { useMemo, useState } from 'react';
import './TaskTimeline.css';

const importantKinds = new Set(['created', 'claimed', 'started', 'completed', 'blocked', 'failed', 'crashed', 'timed_out', 'review']);

function TaskTimeline({ events = [] }) {
  const [filter, setFilter] = useState('important');
  const [agentFilter, setAgentFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const agents = useMemo(() => [...new Set(events.map((event) => event.agent).filter(Boolean))].sort(), [events]);
  const kinds = useMemo(() => [...new Set(events.map((event) => event.kind).filter(Boolean))].sort(), [events]);
  const visible = useMemo(() => events.filter((event) => (
    (filter === 'all' || importantKinds.has(event.kind))
    && (agentFilter === 'all' || event.agent === agentFilter)
    && (kindFilter === 'all' || event.kind === kindFilter)
  )), [events, filter, agentFilter, kindFilter]);

  return (
    <div className="task-timeline-wrap">
      <div className="timeline-controls"><button className={filter === 'important' ? 'active' : ''} onClick={() => setFilter('important')}>Key events</button><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All events</button><span>Live · newest first</span></div>
      {(!!agents.length || !!kinds.length) && (
        <div className="timeline-chip-rows">
          {!!agents.length && <div className="timeline-chips"><button className={agentFilter === 'all' ? 'active' : ''} onClick={() => setAgentFilter('all')}>All agents</button>{agents.map((agent) => <button key={agent} className={agentFilter === agent ? 'active' : ''} onClick={() => setAgentFilter(agent)}>{agent}</button>)}</div>}
          {!!kinds.length && <div className="timeline-chips"><button className={kindFilter === 'all' ? 'active' : ''} onClick={() => setKindFilter('all')}>All kinds</button>{kinds.map((kind) => <button key={kind} className={kindFilter === kind ? 'active' : ''} onClick={() => setKindFilter(kind)}>{titleCase(kind)}</button>)}</div>}
        </div>
      )}
      <div className="task-timeline">
        {visible.map((event) => (
          <article key={event.id} className={`timeline-event kind-${event.kind}`}>
            <time>{formatTime(event.timestamp)}</time>
            <span className="timeline-marker">{eventIcon(event.kind)}</span>
            <div><header><strong>{event.task_title}</strong><em>{titleCase(event.kind)}</em></header><p>{event.detail}</p><footer>{event.agent}{event.run_id ? ` · Run ${event.run_id}` : ''}</footer></div>
          </article>
        ))}
        {!visible.length && <div className="timeline-empty">Task events will appear here when Hermes starts work.</div>}
      </div>
    </div>
  );
}

function eventIcon(kind) {
  if (kind === 'completed') return '✓';
  if (['failed', 'crashed', 'timed_out', 'blocked'].includes(kind)) return '!';
  if (kind === 'claimed' || kind === 'started') return '▶';
  return '◆';
}

function formatTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  return date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function titleCase(value) {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default TaskTimeline;

import { useMemo, useState } from 'react';
import './CommandPalette.css';

function CommandPalette({ open, onClose, agents = [], rooms = [], tasks = [], onCommand }) {
  const [query, setQuery] = useState('');
  const commands = useMemo(() => [
    ...[['office', 'Open office', '⌂'], ['projects', 'Open project rooms', '◆'], ['timeline', 'Open task timeline', '◷'], ['tasks', 'Open task board', '▦'], ['schedule', 'Open schedules', '◴']].map(([id, label, icon]) => ({ id: `view-${id}`, label, icon, type: 'view', value: id })),
    ...agents.map((agent) => ({ id: agent.id, label: agent.name, detail: agent.current_task, icon: '◉', type: 'agent', value: agent })),
    ...rooms.map((room) => ({ id: room.id, label: room.name, detail: `${room.progress}% complete`, icon: '◆', type: 'project', value: room })),
    ...tasks.slice(0, 60).map((task) => ({ id: `task-${task.id}`, label: task.title, detail: task.assignee, icon: '□', type: 'task', value: task })),
  ], [agents, rooms, tasks]);
  const results = commands.filter((command) => `${command.label} ${command.detail || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 14);
  if (!open) return null;

  const choose = (command) => { onCommand?.(command); setQuery(''); onClose?.(); };
  return (
    <button className="command-backdrop" onClick={onClose} aria-label="Close command palette">
      <section className="command-palette" onClick={(event) => event.stopPropagation()}>
        <header><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find agents, projects, tasks or views…" /><kbd>ESC</kbd></header>
        <div className="command-results">{results.map((command) => <button key={command.id} onClick={() => choose(command)}><span>{command.icon}</span><p><strong>{command.label}</strong>{command.detail && <small>{command.detail}</small>}</p><em>{command.type}</em></button>)}{!results.length && <p className="command-empty">No matches</p>}</div>
        <footer><span>⌘K to open</span><span>Click a result to jump there</span></footer>
      </section>
    </button>
  );
}

export default CommandPalette;

import { useState } from 'react';
import './ProjectRooms.css';

const FILTER_STORAGE_KEY = 'hermes-project-rooms-filter';
const FILTERS = ['all', 'active', 'attention', 'completed', 'archived'];

function ProjectRooms({ rooms = [], selectedId, onSelect }) {
  const [filter, setFilter] = useState(() => {
    const saved = window.localStorage.getItem(FILTER_STORAGE_KEY);
    return FILTERS.includes(saved) ? saved : 'all';
  });
  const pickFilter = (status) => {
    setFilter(status);
    window.localStorage.setItem(FILTER_STORAGE_KEY, status);
  };
  const visible = rooms.filter((room) => filter === 'all' || room.status === filter);

  return (
    <div className="project-rooms-view">
      <div className="project-room-filters">
        {FILTERS.map((status) => (
          <button key={status} className={filter === status ? 'active' : ''} onClick={() => pickFilter(status)}>{titleCase(status)}</button>
        ))}
      </div>
      <div className="project-room-grid">
        {visible.map((room) => (
          <button key={room.id} className={`project-room-card ${room.status} ${selectedId === room.id ? 'selected' : ''}`} onClick={() => onSelect?.(room)}>
            <header><span>{room.status === 'attention' ? '!' : room.status === 'active' ? '◐' : '◆'}</span><em>{titleCase(room.status)}</em></header>
            <h3>{room.name}</h3>
            <p>{room.tasks.length} task{room.tasks.length === 1 ? '' : 's'} · {room.agents.length ? room.agents.join(', ') : 'Unassigned'}</p>
            <div className="project-progress"><i style={{ width: `${room.progress}%` }} /></div>
            <footer><span>{room.progress}% complete</span><span>{formatDate(room.updated_at)}</span></footer>
          </button>
        ))}
        {!visible.length && <div className="project-room-empty">No projects in this view.</div>}
      </div>
    </div>
  );
}

export function ProjectRoomDrawer({ room, onClose }) {
  if (!room) return null;
  return (
    <button className="project-drawer-backdrop" onClick={onClose} aria-label="Close project room">
      <aside className="project-drawer" onClick={(event) => event.stopPropagation()}>
        <button className="project-drawer-close" onClick={onClose}>×</button>
        <span className={`project-room-state ${room.status}`}>{titleCase(room.status)}</span>
        <h2>{room.name}</h2>
        <p>{room.agents.length ? room.agents.join(' · ') : 'No assigned agents'}</p>
        <div className="project-drawer-progress"><i style={{ width: `${room.progress}%` }} /></div>
        <strong className="project-progress-label">{room.progress}% complete</strong>
        <div className="project-task-list">
          {room.tasks.map((task) => <article key={task.id}><span className={`task-dot ${task.status}`} /><div><strong>{task.title}</strong><small>{titleCase(task.assignee || 'Unassigned')} · {titleCase(task.status)}</small>{task.result && <p>{task.result}</p>}{task.failure && <p className="task-failed">{task.failure}</p>}</div></article>)}
        </div>
      </aside>
    </button>
  );
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short' }) : 'No date';
}

function titleCase(value) {
  return String(value).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default ProjectRooms;

import { useEffect, useMemo, useState } from 'react';
import './KanbanBoard.css';

const COLLAPSED_STORAGE_KEY = 'hermes-kanban-collapsed-columns';
const DUE_DATES_STORAGE_KEY = 'hermes-kanban-due-dates';

const columns = [
  ['backlog', 'Backlog', '○'],
  ['in_progress', 'In progress', '◐'],
  ['review', 'Review', '◇'],
  ['completed', 'Completed', '✓'],
  ['archive', 'Archive', '□'],
];

function readDueDates() {
  try {
    return JSON.parse(window.localStorage.getItem(DUE_DATES_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function KanbanBoard({ board = {} }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COLLAPSED_STORAGE_KEY));
      return { completed: Boolean(saved?.completed), archive: Boolean(saved?.archive) };
    } catch {
      return { completed: false, archive: false };
    }
  });
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [dueDates, setDueDates] = useState(readDueDates);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  const setDueDate = (taskId, value) => {
    setDueDates((current) => {
      const next = { ...current };
      if (value) next[taskId] = value;
      else delete next[taskId];
      window.localStorage.setItem(DUE_DATES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const assignees = useMemo(() => {
    const names = new Set();
    Object.values(board).flat().forEach((task) => { if (task.assignee) names.add(task.assignee); });
    return [...names].sort();
  }, [board]);

  const toggleColumn = (column) => setCollapsed((current) => ({ ...current, [column]: !current[column] }));
  const columnLayout = columns.map(([column]) => collapsed[column] ? '58px' : 'minmax(210px, 1fr)').join(' ');

  return (
    <div className="work-history">
      {!!assignees.length && (
        <div className="kanban-filters" aria-label="Filter by assignee">
          <button className={assigneeFilter === 'all' ? 'active' : ''} onClick={() => setAssigneeFilter('all')}>All assignees</button>
          {assignees.map((name) => <button key={name} className={assigneeFilter === name ? 'active' : ''} onClick={() => setAssigneeFilter(name)}>{titleCase(name)}</button>)}
        </div>
      )}
      <section className="workflow-section">
        <div className="kanban-board" style={{ gridTemplateColumns: columnLayout }}>
          {columns.map(([column, label, icon]) => {
            const tasks = (board[column] || [])
              .filter((task) => assigneeFilter === 'all' || task.assignee === assigneeFilter)
              .slice()
              .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
            const canCollapse = column === 'completed' || column === 'archive';
            const isCollapsed = Boolean(collapsed[column]);
            return (
              <div key={column} className={`kanban-column column-${column} ${isCollapsed ? 'collapsed' : ''}`}>
                <div className="kanban-column-head">
                  <span>{icon}</span><h4>{label}</h4><em>{tasks.length}</em>
                  {canCollapse && <button className="column-collapse" onClick={() => toggleColumn(column)} aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Minimize'} ${label} column`} title={`${isCollapsed ? 'Expand' : 'Minimize'} ${label}`}>{isCollapsed ? '›' : '‹'}</button>}
                </div>
                <div className="kanban-tasks">
                  {tasks.map((task) => <TaskCard key={task.id} task={task} column={column} dueDate={dueDates[task.id] || ''} onDueDateChange={(value) => setDueDate(task.id, value)} />)}
                  {!tasks.length && <div className="board-empty">{emptyMessage(column)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TaskCard({ task, column, dueDate, onDueDateChange }) {
  const priority = Number(task.priority || 0);
  return (
    <details className="kanban-task">
      <summary>
        <span className={`task-state state-${column}`} />
        <strong>{task.title}</strong>
        <small>{task.assignee ? titleCase(task.assignee) : 'Unassigned'} · {formatDate(task.finished_at || task.created_at)}</small>
        {!!priority && <span className="priority-badge" title="Hermes task priority">P{priority}</span>}
        {dueDate && <span className="due-badge" title={`Local reminder: ${dueDate}`}>◷ {formatDate(dueDate)}</span>}
        {['in_progress', 'review'].includes(column) && <TaskStage task={task} />}
      </summary>
      <div className="task-detail">
        {task.detail && <p>{task.detail}</p>}
        {task.result && <div className="task-result"><b>Result</b><p>{task.result}</p></div>}
        {task.failure && <div className="task-failure"><b>Why it was archived</b><p>{task.failure}</p></div>}
        <dl>
          <div><dt>Status</dt><dd>{titleCase(task.status)}</dd></div>
          {task.project && <div><dt>Project</dt><dd>{task.project}</dd></div>}
          {!!priority && <div><dt>Priority</dt><dd>{priority}</dd></div>}
          <div><dt>Created</dt><dd>{formatDate(task.created_at)}</dd></div>
          {task.finished_at && <div><dt>{column === 'completed' ? 'Completed' : 'Archived'}</dt><dd>{formatDate(task.finished_at)}</dd></div>}
        </dl>
        <label className="due-date-field" onClick={(event) => event.stopPropagation()}>
          <span>Local reminder <em>(saved in this browser only, not part of Hermes)</em></span>
          <input type="date" className="due-date-input" value={dueDate} onChange={(event) => onDueDateChange(event.target.value)} onClick={(event) => event.stopPropagation()} />
        </label>
      </div>
    </details>
  );
}

function TaskStage({ task }) {
  if (!task.progress_label) return null;
  const mode = String(task.progress_mode || '');
  // Running work advances live; the bouncing bar is only the no-data fallback.
  const active = mode === 'active' || mode === 'activity';
  const indeterminate = task.progress_value == null;
  return <span className={`kanban-progress ${active ? (indeterminate ? 'activity' : 'active') : mode}`}>
    <span><b>{task.progress_label}</b>{!indeterminate && <em>{task.progress_value}% workflow</em>}</span>
    <i><i style={!indeterminate ? { width: `${task.progress_value}%` } : undefined} /></i>
  </span>;
}

function emptyMessage(column) {
  return {
    backlog: 'Nothing waiting.',
    in_progress: 'No active tasks.',
    review: 'Nothing in review.',
    completed: 'Completed work will appear here.',
    archive: 'Archive is empty.',
  }[column];
}

function formatDate(value) {
  if (!value) return 'No date';
  return new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function titleCase(value) {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default KanbanBoard;

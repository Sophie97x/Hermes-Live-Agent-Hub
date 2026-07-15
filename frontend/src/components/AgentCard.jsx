import React from 'react';
import './AgentCard.css';

function AgentCard({ agent }) {
  const statusClass = `agent-status-${agent.status.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="agent-card">
      <h3>{agent.name}</h3>
      <p className={statusClass}>Status: {agent.status}</p>
      {agent.current_task && <p>Task: {agent.current_task}</p>}
      <p>Started: {new Date(agent.started_at).toLocaleString()}</p>
    </div>
  );
}

export default AgentCard;

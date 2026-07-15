import React from 'react';
import './ActivityFeed.css';

function ActivityFeed({ activity }) {
  return (
    <div className="activity-feed">
      {activity.map(item => (
        <div key={item.id} className="activity-item">
          <span className="activity-timestamp">{new Date(item.timestamp).toLocaleTimeString()}</span>
          <span className={`activity-type activity-type-${item.type}`}>{item.type}:</span>
          <span className="activity-detail">{item.detail} (Agent: {item.agent})</span>
        </div>
      ))}
    </div>
  );
}

export default ActivityFeed;

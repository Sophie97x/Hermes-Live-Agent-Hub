import React from 'react';
import './CronJobs.css';

function CronJobs({ jobs }) {
  return (
    <div className="cron-jobs">
      {jobs.map(job => (
        <div key={job.id} className="cron-job-item">
          <strong>{job.name}</strong>
          <p>Schedule: {job.schedule}</p>
          <p className={`cron-status-${job.status}`}>{job.status}</p>
          {job.last_run && <p>Last Run: {new Date(job.last_run).toLocaleString()}</p>}
          {job.next_run && <p>Next Run: {new Date(job.next_run).toLocaleString()}</p>}
        </div>
      ))}
    </div>
  );
}

export default CronJobs;

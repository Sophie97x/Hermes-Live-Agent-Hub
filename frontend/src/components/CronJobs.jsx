import React from 'react';
import './CronJobs.css';

function formatDate(value) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function CronJobs({ jobs = [] }) {
  if (!jobs.length) {
    return <div className="cron-empty"><span>◷</span><strong>No schedules found</strong><p>New Hermes schedules will appear here automatically.</p></div>;
  }

  return (
    <div className="cron-jobs">
      {jobs.map(job => (
        <article key={job.id} className="cron-job-item">
          <header><strong>{job.name}</strong><span className={`cron-status cron-status-${job.status}`}>{job.status}</span></header>
          <p className="cron-schedule">{job.schedule || 'Not scheduled'}</p>
          <dl>
            <div><dt>Next run</dt><dd>{formatDate(job.next_run)}</dd></div>
            <div><dt>Last run</dt><dd>{formatDate(job.last_run)}</dd></div>
            <div><dt>Completed</dt><dd>{job.runs_completed || 0} runs</dd></div>
          </dl>
          {job.last_error && <p className="cron-error">{job.last_error}</p>}
        </article>
      ))}
    </div>
  );
}

export default CronJobs;

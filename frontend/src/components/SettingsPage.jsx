import { useEffect, useState } from 'react';
import './SettingsPage.css';

const SOURCE_HELP = {
  claude: ['✱', 'Claude Code sessions from ~/.claude/projects'],
  codex: ['⌬', 'Codex CLI and desktop rollouts from ~/.codex/sessions'],
  openclaw: ['☍', 'OpenClaw agent transcripts from ~/.openclaw'],
};

function SettingsPage({ data, onSave, saving = false }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (data?.settings) setForm(JSON.parse(JSON.stringify(data.settings)));
  }, [data]);

  if (!form) return <div className="settings-loading">Loading settings…</div>;

  const setSource = (name, patch) => setForm((current) => ({
    ...current,
    sources: { ...current.sources, [name]: { ...current.sources[name], ...patch } },
  }));
  const setNumber = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    onSave?.({
      external_activity_seconds: Number(form.external_activity_seconds) || undefined,
      external_idle_hours: Number(form.external_idle_hours) || undefined,
      external_max_per_source: Number(form.external_max_per_source) || undefined,
      sources: form.sources,
    });
  };

  return (
    <form className="settings-page" onSubmit={submit}>
      <section className="settings-group">
        <header>
          <h3>Agent sources</h3>
          <p>The hub always shows the Hermes team. Other local coding agents can join the office when their session files show activity — everything is read directly from disk and nothing leaves this machine.</p>
        </header>
        {Object.entries(form.sources).map(([name, source]) => {
          const [icon, help] = SOURCE_HELP[name] || ['•', ''];
          const detected = data?.detected?.[name] ?? 0;
          return (
            <article key={name} className={`settings-source ${source.enabled ? 'enabled' : ''}`}>
              <div className="settings-source-head">
                <span className="settings-source-icon">{icon}</span>
                <div>
                  <strong>{source.label || name}</strong>
                  <small>{help}</small>
                </div>
                <em className={detected ? 'found' : ''}>{detected ? `${detected} session${detected === 1 ? '' : 's'} found` : 'Nothing found'}</em>
                <button
                  type="button"
                  className={source.enabled ? 'toggle on' : 'toggle'}
                  onClick={() => setSource(name, { enabled: !source.enabled })}
                  aria-pressed={source.enabled}
                  aria-label={`${source.enabled ? 'Disable' : 'Enable'} ${source.label || name}`}
                ><i /></button>
              </div>
              <label>
                <span>State directory</span>
                <input
                  type="text"
                  value={source.home}
                  onChange={(event) => setSource(name, { home: event.target.value })}
                  spellCheck="false"
                  aria-label={`${source.label || name} state directory`}
                />
              </label>
            </article>
          );
        })}
      </section>

      <section className="settings-group">
        <header>
          <h3>Activity rules</h3>
          <p>How recently a session file must change before its agent is shown working, how long it stays visible on break, and how many agents each tool can add to the office.</p>
        </header>
        <div className="settings-numbers">
          <label>
            <span>Working window <em>seconds</em></span>
            <input type="number" min="10" max="3600" value={form.external_activity_seconds} onChange={(event) => setNumber('external_activity_seconds', event.target.value)} />
          </label>
          <label>
            <span>Visible while idle <em>hours</em></span>
            <input type="number" min="1" max="168" value={form.external_idle_hours} onChange={(event) => setNumber('external_idle_hours', event.target.value)} />
          </label>
          <label>
            <span>Max agents per tool</span>
            <input type="number" min="1" max="10" value={form.external_max_per_source} onChange={(event) => setNumber('external_max_per_source', event.target.value)} />
          </label>
        </div>
      </section>

      <footer className="settings-footer">
        <small>Saved to ~/.config/hermes-agent-hub/settings.json — Hermes state stays read-only.</small>
        <button type="submit" className="settings-save" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      </footer>
    </form>
  );
}

export default SettingsPage;

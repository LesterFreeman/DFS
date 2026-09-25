import { useState } from 'react';
import { dispatchWorkflow, workflowUrl } from '../lib/refresh';
import { readStored, writeStored } from '../lib/storage';

export function RefreshButton() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(() => readStored('dfs.gh', { token: '' }).token);
  const [msg, setMsg] = useState<string | null>(null);
  const url = workflowUrl();

  const trigger = async () => {
    setMsg('Triggering…');
    try {
      await dispatchWorkflow(token);
      setMsg('Pipeline started. New data is usually live in 3–6 minutes; reload then.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="refresh">
      <button onClick={() => setOpen(!open)}>Refresh data</button>
      {open && (
        <div className="popover">
          {token ? (
            <button className="primary" onClick={trigger}>
              Run pipeline now
            </button>
          ) : url ? (
            <a className="button primary" href={url} target="_blank" rel="noreferrer">
              Open workflow → “Run workflow”
            </a>
          ) : (
            <p className="small">Run the “pipeline” workflow from your repo’s Actions tab.</p>
          )}
          <details>
            <summary className="small">One-click refresh with a token</summary>
            <p className="small muted">
              Fine-grained token with <b>Actions: Read and write</b> on this repo only. Stored in this browser only.
            </p>
            <input
              type="password"
              placeholder="github_pat_…"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                writeStored('dfs.gh', { token: e.target.value });
              }}
            />
          </details>
          {msg && <p className="small">{msg}</p>}
        </div>
      )}
    </div>
  );
}

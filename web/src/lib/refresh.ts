/**
 * Manual refresh. A static site can't hold a secret, so by default "Refresh" opens the
 * workflow page where you click "Run workflow". If you paste a fine-grained GitHub token
 * (Actions: read & write on this one repo), it's kept only in this browser's localStorage
 * and used to trigger the workflow directly.
 */
const WORKFLOW = 'pipeline.yml';

export function repoSlug(): string | null {
  if (import.meta.env.VITE_REPO) return import.meta.env.VITE_REPO;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? `${m[1]}/${repo}` : null;
}

export function workflowUrl(): string | null {
  const slug = repoSlug();
  return slug ? `https://github.com/${slug}/actions/workflows/${WORKFLOW}` : null;
}

export async function dispatchWorkflow(token: string): Promise<void> {
  const slug = repoSlug();
  if (!slug) throw new Error('Repository unknown (set VITE_REPO at build time)');
  const res = await fetch(`https://api.github.com/repos/${slug}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: import.meta.env.VITE_REF || 'main' }),
  });
  if (res.status !== 204) throw new Error(`GitHub returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

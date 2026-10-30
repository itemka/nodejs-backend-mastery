import { fileURLToPath } from 'node:url';

const PROJECT_NAMES = new Set(['notion-backup-automation', 'telegram-webhook-hub']);
const KEEP_COUNT = 10;
const TERMINAL_STATES = new Set(['READY', 'ERROR', 'CANCELED']);
const isDeploymentId = (value) => typeof value === 'string' && /^dpl_[a-z\d]+$/i.test(value);

function validateConfig({ projectName, projectId, teamId }) {
  if (
    !PROJECT_NAMES.has(projectName) ||
    !/^prj_[a-z\d]+$/i.test(projectId ?? '') ||
    !/^team_[a-z\d]+$/i.test(teamId ?? '')
  ) {
    throw new Error('Set VERCEL_PROJECT_NAME, VERCEL_PROJECT_ID, and VERCEL_TEAM_ID correctly.');
  }
}

/** Only talks to Vercel; never follows a redirect carrying the bearer token. */
export function createVercelRequest({ token, teamId, fetchImpl = fetch }) {
  if (!token) throw new Error('Set the VERCEL_CLEANUP_TOKEN GitHub Actions secret.');

  return async (path, { method = 'GET', query = {} } = {}) => {
    const url = new URL(path, 'https://api.vercel.com');
    if (url.origin !== 'https://api.vercel.com') throw new Error('Invalid Vercel API origin.');
    url.search = new URLSearchParams({ ...query, teamId }).toString();
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // Do not print response bodies, which can contain deployment configuration or secrets.
      throw new Error(`Vercel ${method} ${url.pathname} failed (HTTP ${response.status}).`);
    }
    if (method !== 'DELETE') return response.json();
  };
}

async function protectedDeployments(request, { projectName, projectId, teamId }) {
  const project = await request(`/v9/projects/${projectId}`);
  if (
    project.id !== projectId ||
    project.name !== projectName ||
    project.accountId !== teamId ||
    project.link?.productionBranch !== 'main'
  ) {
    throw new Error('Project, owner, or production branch mismatch; refusing cleanup.');
  }
  const productionId = project.targets?.production?.id;
  if (!isDeploymentId(productionId)) {
    throw new Error('Cannot identify the production deployment; refusing cleanup.');
  }
  const alias = await request(`/v4/aliases/${projectName}.vercel.app`);
  if (alias.projectId !== projectId || !isDeploymentId(alias.deploymentId)) {
    throw new Error('Cannot identify the production domain target; refusing cleanup.');
  }
  const ids = new Set([productionId, alias.deploymentId]);
  for (const target of Object.values(project.targets)) {
    if (!isDeploymentId(target.id)) throw new Error('Invalid project target; refusing cleanup.');
    ids.add(target.id);
  }

  return ids;
}

async function listDeployments(request, { projectName, projectId }) {
  const deployments = new Map();
  let until;
  for (let page = 0; page < 100; page++) {
    const query = { projectId, limit: '100' };
    if (until !== undefined) query.until = String(until);
    const response = await request('/v6/deployments', { query });
    if (
      !Array.isArray(response.deployments) ||
      !response.pagination ||
      !Object.hasOwn(response.pagination, 'next')
    ) {
      throw new Error('Incomplete deployment listing; refusing cleanup.');
    }
    for (const deployment of response.deployments) {
      if (
        !isDeploymentId(deployment.uid) ||
        deployment.projectId !== projectId ||
        deployment.name !== projectName ||
        !Number.isSafeInteger(deployment.created) ||
        deployment.created <= 0 ||
        typeof deployment.state !== 'string'
      ) {
        throw new Error('Invalid deployment or project mismatch; refusing cleanup.');
      }
      deployments.set(deployment.uid, deployment);
    }
    const next = response.pagination.next;
    if (next === null) return [...deployments.values()];
    if (!Number.isSafeInteger(next) || next <= 0 || (until !== undefined && next >= until)) {
      throw new Error('Invalid deployment pagination; refusing cleanup.');
    }
    until = next;
  }
  throw new Error('Deployment listing exceeded 100 pages; refusing cleanup.');
}

export async function cleanupDeployments({
  request,
  projectName,
  projectId,
  teamId,
  dryRun = true,
  log = console.log,
}) {
  const scope = { projectName, projectId, teamId };
  validateConfig(scope);
  const protectedIds = await protectedDeployments(request, scope);
  // Finish pagination and validate every record before planning any deletion.
  const deployments = await listDeployments(request, scope);
  // A build still in progress takes a slot, so the deploy that triggered this run stays within it.
  const newestMain = deployments
    .filter(
      (deployment) =>
        (deployment.state === 'READY' || !TERMINAL_STATES.has(deployment.state)) &&
        deployment.meta?.githubCommitRef === 'main',
    )
    .toSorted((left, right) => right.created - left.created || left.uid.localeCompare(right.uid))
    .slice(0, KEEP_COUNT);
  const retained = new Set([...protectedIds, ...newestMain.map((deployment) => deployment.uid)]);
  const candidates = deployments.filter(
    (deployment) =>
      !retained.has(deployment.uid) &&
      TERMINAL_STATES.has(deployment.state) &&
      // Unknown provenance stays intact rather than treating missing Git metadata as a preview.
      typeof deployment.meta?.githubCommitRef === 'string' &&
      deployment.meta.githubCommitRef.length > 0,
  );
  log(
    JSON.stringify({ dryRun, retained: [...retained], candidates: candidates.map((d) => d.uid) }),
  );
  const deleted = [];
  if (!dryRun) {
    for (const candidate of candidates) {
      const current = await request(`/v13/deployments/${candidate.uid}`);
      if (current.id !== candidate.uid || current.projectId !== projectId) {
        throw new Error('Deployment identity changed; refusing cleanup.');
      }
      if (!TERMINAL_STATES.has(current.readyState)) continue;
      // A rollback or promotion can move production after the plan was made.
      const liveIds = await protectedDeployments(request, scope);
      if (liveIds.has(candidate.uid)) {
        log(`Preserving newly active deployment ${candidate.uid}.`);
        continue;
      }
      await request(`/v13/deployments/${candidate.uid}`, { method: 'DELETE' });
      deleted.push(candidate.uid);
      log(`Deleted ${candidate.uid}.`);
    }
  }

  return { retained: [...retained], deleted, candidates: candidates.map((d) => d.uid) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
      throw new Error('Usage: node scripts/cleanup-vercel-deployments.mjs [--apply]');
    }
    const scope = {
      projectName: process.env.VERCEL_PROJECT_NAME,
      projectId: process.env.VERCEL_PROJECT_ID,
      teamId: process.env.VERCEL_TEAM_ID,
    };
    validateConfig(scope);
    const request = createVercelRequest({ token: process.env.VERCEL_TOKEN, teamId: scope.teamId });
    await cleanupDeployments({ request, ...scope, dryRun: !args.includes('--apply') });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

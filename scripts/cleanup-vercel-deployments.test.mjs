import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanupDeployments, createVercelRequest } from './cleanup-vercel-deployments.mjs';

const projectId = 'prj_backup';
const teamId = 'team_owner';
const deployment = (index, overrides = {}) => ({
  uid: `dpl_build${index}`,
  name: 'notion-backup-automation',
  projectId,
  created: index + 1,
  state: 'READY',
  meta: { githubCommitRef: 'main' },
  ...overrides,
});
const mainBuilds = Array.from({ length: 12 }, (_, index) => deployment(index));

function fixture({
  deployments = mainBuilds,
  pages,
  production = 'dpl_build11',
  projectName = 'notion-backup-automation',
  override,
} = {}) {
  const calls = [];
  let projectReads = 0;
  const request = async (path, options = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ path, method, query: options.query });
    const custom = override?.({ path, method, projectReads });
    if (custom !== undefined) return custom;
    if (path === `/v9/projects/${projectId}`) {
      projectReads++;

      return {
        id: projectId,
        name: projectName,
        accountId: teamId,
        link: { productionBranch: 'main' },
        targets: { production: { id: production } },
      };
    }
    if (path.startsWith('/v4/aliases/')) return { projectId, deploymentId: production };
    if (path === '/v6/deployments') {
      return pages
        ? pages[options.query.until ?? 'first']
        : { deployments, pagination: { next: null } };
    }
    if (method === 'DELETE') return {};
    const current = deployments.find((item) => path === `/v13/deployments/${item.uid}`);
    if (current) return { id: current.uid, projectId, readyState: current.state };
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  const run = (options = {}) =>
    cleanupDeployments({ request, projectName, projectId, teamId, log() {}, ...options });
  const deletions = () => calls.filter((call) => call.method === 'DELETE').map((call) => call.path);

  return { run, calls, deletions };
}

describe('Vercel deployment retention', () => {
  it('defaults to dry-run and keeps the ten newest successful main builds, sorted by age', async () => {
    const test = fixture({ deployments: mainBuilds.toReversed() });
    const result = await test.run();
    assert.deepEqual(
      new Set(result.retained),
      new Set(mainBuilds.slice(2).map((item) => item.uid)),
    );
    assert.deepEqual(new Set(result.candidates), new Set(['dpl_build0', 'dpl_build1']));
    assert.deepEqual(test.deletions(), []);
  });

  it('applies the same rule to the Telegram hub using its own name and production domain', async () => {
    const projectName = 'telegram-webhook-hub';
    const test = fixture({
      projectName,
      deployments: mainBuilds.map((item) => ({ ...item, name: projectName })),
    });
    const result = await test.run({ dryRun: false });
    assert.deepEqual(new Set(result.deleted), new Set(['dpl_build0', 'dpl_build1']));
    assert.ok(test.calls.some((call) => call.path === `/v4/aliases/${projectName}.vercel.app`));
  });

  it('refuses a project outside the supported list before calling Vercel', async () => {
    const test = fixture({ projectName: 'another-project' });
    await assert.rejects(test.run({ dryRun: false }), /VERCEL_PROJECT_NAME/);
    assert.deepEqual(test.calls, []);
  });

  it('counts an in-progress main build toward the ten retained builds', async () => {
    const building = deployment(120, { state: 'BUILDING' });
    const test = fixture({ deployments: [...mainBuilds, building] });
    const result = await test.run({ dryRun: false });
    assert.deepEqual(
      new Set(result.retained),
      new Set([building.uid, ...mainBuilds.slice(3).map((item) => item.uid)]),
    );
    assert.deepEqual(
      new Set(result.deleted),
      new Set(mainBuilds.slice(0, 3).map((item) => item.uid)),
    );
  });

  it('protects production even when in-progress main builds fill every slot', async () => {
    const building = Array.from({ length: 10 }, (_, index) =>
      deployment(index + 120, { state: 'QUEUED' }),
    );
    const test = fixture({ deployments: [...mainBuilds, ...building] });
    const result = await test.run({ dryRun: false });
    assert.ok(result.retained.includes('dpl_build11'));
    assert.deepEqual(
      new Set(result.deleted),
      new Set(mainBuilds.slice(0, 11).map((item) => item.uid)),
    );
  });

  it('keeps an older live production build and all project targets outside the newest ten', async () => {
    const test = fixture({
      production: 'dpl_build0',
      override: ({ path }) => {
        if (path === `/v9/projects/${projectId}`) {
          return {
            id: projectId,
            name: 'notion-backup-automation',
            accountId: teamId,
            link: { productionBranch: 'main' },
            targets: { production: { id: 'dpl_build0' }, staging: { id: 'dpl_build1' } },
          };
        }
      },
    });
    const result = await test.run({ dryRun: false });
    assert.equal(result.retained.length, 12);
    assert.deepEqual(test.deletions(), []);
  });

  it('also protects a production domain whose target differs during a promotion', async () => {
    const test = fixture({
      override: ({ path }) => {
        if (path.startsWith('/v4/aliases/')) return { projectId, deploymentId: 'dpl_build0' };
      },
    });
    const result = await test.run({ dryRun: false });
    assert.ok(result.retained.includes('dpl_build0'));
    assert.deepEqual(result.deleted, ['dpl_build1']);
  });

  it('keeps every available successful main build when fewer than ten exist', async () => {
    const test = fixture({
      deployments: [
        ...mainBuilds.slice(5),
        deployment(100, { state: 'ERROR' }),
        deployment(101, { meta: { githubCommitRef: 'feature' } }),
      ],
    });
    const result = await test.run({ dryRun: false });
    for (const build of mainBuilds.slice(5)) assert.ok(result.retained.includes(build.uid));
    assert.deepEqual(result.deleted, ['dpl_build100', 'dpl_build101']);
  });

  it('deletes old main, completed preview, failed, and canceled builds but preserves pending/unknown builds', async () => {
    const disposable = [
      deployment(100, { meta: { githubCommitRef: 'feature' } }),
      deployment(101, { state: 'ERROR' }),
      deployment(102, { state: 'CANCELED' }),
    ];
    const pending = ['BUILDING', 'QUEUED', 'INITIALIZING', 'BLOCKED', 'FUTURE_STATE'].map(
      (state, index) => deployment(index + 120, { state, meta: { githubCommitRef: 'feature' } }),
    );
    const test = fixture({
      deployments: [
        ...mainBuilds,
        ...disposable,
        ...pending,
        deployment(130, { meta: {} }),
        deployment(131, { meta: { githubCommitRef: '' } }),
      ],
    });
    const result = await test.run({ dryRun: false });
    assert.deepEqual(
      new Set(result.deleted),
      new Set(['dpl_build0', 'dpl_build1', ...disposable.map((item) => item.uid)]),
    );
  });

  it('finishes all pages before choosing the retained builds or deleting anything', async () => {
    const test = fixture({
      pages: {
        first: { deployments: mainBuilds.slice(4), pagination: { next: 5 } },
        5: { deployments: mainBuilds.slice(0, 4), pagination: { next: null } },
      },
    });
    const result = await test.run({ dryRun: false });
    assert.deepEqual(result.deleted, ['dpl_build0', 'dpl_build1']);
    const pageCalls = test.calls.filter((call) => call.path === '/v6/deployments');
    assert.deepEqual(
      pageCalls.map((call) => call.query),
      [
        { projectId, limit: '100' },
        { projectId, limit: '100', until: '5' },
      ],
    );
    assert.ok(
      test.calls.indexOf(pageCalls[1]) < test.calls.findIndex((c) => c.method === 'DELETE'),
    );
  });

  for (const pages of [
    { first: { deployments: mainBuilds } },
    { first: { deployments: mainBuilds, pagination: { next: 'bad-cursor' } } },
    {
      first: { deployments: mainBuilds, pagination: { next: 5 } },
      5: { deployments: [], pagination: { next: 5 } },
    },
  ]) {
    it('refuses incomplete or non-progressing pagination without deleting anything', async () => {
      const test = fixture({ pages });
      await assert.rejects(test.run({ dryRun: false }), /listing|pagination/);
      assert.deepEqual(test.deletions(), []);
    });
  }

  for (const invalid of [
    { projectId: 'prj_other' },
    { name: 'telegram-webhook-hub' },
    { uid: '../not-a-deployment' },
    { created: undefined },
  ]) {
    it('rejects unsafe listing records before any deletions', async () => {
      const test = fixture({ deployments: [...mainBuilds, deployment(120, invalid)] });
      await assert.rejects(test.run({ dryRun: false }), /Invalid deployment|mismatch/);
      assert.deepEqual(test.deletions(), []);
    });
  }

  for (const invalidProject of [
    { id: 'prj_other' },
    { name: 'telegram-webhook-hub' },
    { accountId: 'team_other' },
    { link: { productionBranch: 'develop' } },
    { targets: {} },
  ]) {
    it('refuses an unverifiable project or production target', async () => {
      const test = fixture({
        override: ({ path }) => {
          if (path === `/v9/projects/${projectId}`) {
            return {
              id: projectId,
              name: 'notion-backup-automation',
              accountId: teamId,
              link: { productionBranch: 'main' },
              targets: { production: { id: 'dpl_build11' } },
              ...invalidProject,
            };
          }
        },
      });
      await assert.rejects(test.run({ dryRun: false }), /mismatch|Cannot identify/);
      assert.deepEqual(test.deletions(), []);
    });
  }

  it('refreshes live targets before every deletion and preserves a concurrent rollback', async () => {
    const test = fixture({
      override: ({ path, projectReads }) => {
        if (path.startsWith('/v4/aliases/') && projectReads > 1) {
          return { projectId, deploymentId: 'dpl_build0' };
        }
      },
    });
    const result = await test.run({ dryRun: false });
    assert.deepEqual(result.deleted, ['dpl_build1']);
    assert.equal(test.calls.filter((call) => call.path === `/v9/projects/${projectId}`).length, 3);
  });

  it('revalidates deployment ownership before deleting it', async () => {
    const test = fixture({
      override: ({ path }) => {
        if (path === '/v13/deployments/dpl_build0') {
          return { id: 'dpl_build0', projectId: 'prj_other', readyState: 'READY' };
        }
      },
    });
    await assert.rejects(test.run({ dryRun: false }), /identity changed/);
    assert.deepEqual(test.deletions(), []);
  });

  it('stops on an API failure instead of continuing destructive work', async () => {
    const test = fixture({
      override: ({ method }) => {
        if (method === 'DELETE') throw new Error('Vercel is unavailable');
      },
    });
    await assert.rejects(test.run({ dryRun: false }), /unavailable/);
    assert.equal(test.deletions().length, 1);
  });
});

describe('Vercel API boundary', () => {
  it('scopes calls to the team, times out, and refuses credential-bearing redirects', async () => {
    const request = createVercelRequest({
      token: 'fixture-token',
      teamId,
      fetchImpl: async (url, options) => {
        assert.equal(url.origin, 'https://api.vercel.com');
        assert.equal(url.searchParams.get('teamId'), teamId);
        assert.equal(url.searchParams.get('projectId'), projectId);
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.headers.Authorization, 'Bearer fixture-token');

        return new Response('{"deployments":[]}');
      },
    });
    assert.deepEqual(await request('/v6/deployments', { query: { projectId } }), {
      deployments: [],
    });
    await assert.rejects(request('https://example.com'), /Invalid Vercel API origin/);
  });

  it('does not expose API error response bodies', async () => {
    const request = createVercelRequest({
      token: 'fixture-token',
      teamId,
      fetchImpl: async () => new Response('private response body', { status: 403 }),
    });
    await assert.rejects(request('/v6/deployments'), (error) => {
      assert.match(error.message, /HTTP 403/);
      assert.doesNotMatch(error.message, /private response body|fixture-token/);

      return true;
    });
  });

  it('requires credentials and valid project/team IDs', async () => {
    assert.throws(() => createVercelRequest({ teamId }), /VERCEL_CLEANUP_TOKEN/);
    await assert.rejects(
      cleanupDeployments({
        projectName: 'telegram-webhook-hub',
        projectId: 'not-a-project',
        teamId,
        request() {},
      }),
      /VERCEL_PROJECT_ID/,
    );
  });
});

import { describe, expect, it } from 'vitest';

import { buildAgentContext } from '../../src/agent/context-builder.js';
import { errorCatalog } from '../../src/domain/error-catalog.js';
import type { AgentFixture } from '../support/agent-fixtures.js';
import { fixtureMiss, loadAgentFixtures } from '../support/agent-fixtures.js';
import { agentScenarios } from '../support/agent-scenarios.js';

const fixtures = loadAgentFixtures();

function fixture(prefix: string): AgentFixture {
  return fixtures.find(({ name }) => name.startsWith(prefix))!;
}

describe('the S5 fixtures (tests/fixtures/agent)', () => {
  it('holds the 7 incidents test:agent-live scores', () => {
    expect(fixtures).toHaveLength(7);
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s is a valid, supervised context whose acceptable actions are allowed',
    (_name, { acceptable, context }) => {
      expect(errorCatalog[context.incident.code].supervised).toBe(true);
      expect(context.incident.description).toBe(errorCatalog[context.incident.code].description);
      expect(context.allowedActions).toContain('notify_user');
      expect(context.allowedActions).toEqual(expect.arrayContaining(acceptable));
      expect(context.incident.decisionsRemaining).toBe(
        context.limits.maxDecisionsPerIncident - context.incident.decisions.length,
      );
    },
  );

  // A hand-written context can show a state the lifecycle never reaches (the exhausted Gmail
  // incident once allowed retry_stage with 0 retries). Each one is what production builds.
  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s is the context production builds for its incident, reached through the lifecycle',
    (name, { context }) => {
      const scenario = agentScenarios[name];

      expect(scenario, `no lifecycle scenario for ${name}`).toBeDefined();
      expect(buildAgentContext(scenario!())).toEqual(context);
    },
  );
});

describe('fixtureMiss (how test:agent-live scores a valid answer)', () => {
  it('accepts an acceptable, allowed action with parameters production takes', () => {
    expect(
      fixtureMiss(fixture('07'), { action: 'retry_stage', stage: 'TRANSFER' }),
    ).toBeUndefined();
    expect(fixtureMiss(fixture('02'), { action: 'wait', minutes: 240 })).toBeUndefined();
  });

  it('refuses retry_stage on another stage, as the policy does', () => {
    expect(fixtureMiss(fixture('07'), { action: 'retry_stage', stage: 'EMAIL_WAIT' })).toBe(
      'stage_mismatch',
    );
  });

  it('refuses a wait that ends after the job’s lifetime', () => {
    const late = fixture('02');
    const nearTheEnd = {
      ...late,
      context: { ...late.context, job: { ...late.context.job, ageHours: 166 } },
    };

    expect(fixtureMiss(nearTheEnd, { action: 'wait', minutes: 240 })).toBe('past_lifetime');
    expect(fixtureMiss(nearTheEnd, { action: 'wait', minutes: 60 })).toBeUndefined();
  });

  it('refuses an action that is not allowed, or allowed but not acceptable', () => {
    expect(fixtureMiss(fixture('08'), { action: 'inspect_status' })).toBe('not_allowed');
    expect(fixtureMiss(fixture('05'), { action: 'wait', minutes: 15 })).toBe('not_acceptable');
  });
});

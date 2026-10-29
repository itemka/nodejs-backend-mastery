import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { AgentAction } from '../../src/agent/agent-model.js';
import { agentContextSchema } from '../../src/agent/context-builder.js';
import { agentActionNames } from '../../src/domain/job.js';

const fixtureDirectory = path.resolve(import.meta.dirname, '../fixtures/agent');

/**
 * One S5 incident (`tests/fixtures/agent/*.json`): the context the model gets, the actions a
 * careful operator would accept, and why.
 */
export const agentFixtureSchema = z.strictObject({
  acceptable: z.array(z.enum(agentActionNames)).min(1),
  context: agentContextSchema,
  why: z.string().min(1),
});

export type AgentFixture = z.infer<typeof agentFixtureSchema> & { readonly name: string };

export function loadAgentFixtures(): AgentFixture[] {
  return readdirSync(fixtureDirectory)
    .filter((file) => file.endsWith('.json'))
    .toSorted()
    .map((file) => ({
      ...agentFixtureSchema.parse(
        JSON.parse(readFileSync(path.join(fixtureDirectory, file), 'utf8')),
      ),
      name: file.replace(/\.json$/, ''),
    }));
}

/** Why a valid answer does not count as acceptable for its fixture. */
export type FixtureMiss = 'not_acceptable' | 'not_allowed' | 'past_lifetime' | 'stage_mismatch';

/**
 * How `test:agent-live` scores one valid answer: an acceptable action, among the allowed ones,
 * with parameters production would take too. Two preconditions depend on the parameters, and
 * the context has what they need: `retry_stage` names the incident's stage, and a `wait` ends
 * within the job's lifetime.
 */
export function fixtureMiss(fixture: AgentFixture, action: AgentAction): FixtureMiss | undefined {
  const { allowedActions, job } = fixture.context;

  if (!allowedActions.includes(action.action)) {
    return 'not_allowed';
  }

  if (!fixture.acceptable.includes(action.action)) {
    return 'not_acceptable';
  }

  if (action.action === 'retry_stage' && action.stage !== job.stage) {
    return 'stage_mismatch';
  }

  if (action.action === 'wait' && job.ageHours + action.minutes / 60 >= job.maxLifetimeHours) {
    return 'past_lifetime';
  }

  return undefined;
}

/** The action with its parameter, as the live run prints it. */
export function describeAction(action: AgentAction): string {
  switch (action.action) {
    case 'retry_stage': {
      return `retry_stage ${action.stage}`;
    }

    case 'search_email_again': {
      return `search_email_again ${action.widenMinutes} min`;
    }

    case 'wait': {
      return `wait ${action.minutes} min`;
    }

    default: {
      return action.action;
    }
  }
}

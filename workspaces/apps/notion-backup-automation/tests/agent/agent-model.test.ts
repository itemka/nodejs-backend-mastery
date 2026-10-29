import { describe, expect, it } from 'vitest';

import { agentDecisionJsonSchema, parseAgentDecision } from '../../src/agent/agent-model.js';
import { decision } from '../support/agent.js';

describe('parseAgentDecision', () => {
  it.each([
    [decision('inspect_status'), { action: 'inspect_status' }],
    [decision('wait', { minutes: 60, stage: 'EMAIL_WAIT' }), { action: 'wait', minutes: 60 }],
    [decision('retry_stage', { stage: 'TRANSFER' }), { action: 'retry_stage', stage: 'TRANSFER' }],
    [
      decision('search_email_again', { widenMinutes: 180 }),
      { action: 'search_email_again', widenMinutes: 180 },
    ],
    [
      decision('notify_user', { summary: 'Check the Settings page.' }),
      { action: 'notify_user', summary: 'Check the Settings page.' },
    ],
  ])('accepts %j with only the parameters the action needs', (raw, action) => {
    expect(parseAgentDecision(raw)).toEqual({
      action,
      confidence: 'high',
      rationale: expect.any(String) as unknown,
    });
  });

  it.each([
    ['an unknown action', { ...decision('wait', { minutes: 15 }), action: 'delete_backup' }],
    ['a wait of another length', decision('wait', { minutes: 30 })],
    ['a retry_stage without a stage', decision('retry_stage')],
    ['a widen of another length', decision('search_email_again', { widenMinutes: 90 })],
    ['notify_user without a summary', decision('notify_user', { summary: '  ' })],
    ['no confidence', { action: 'retry', params: {}, rationale: 'x' }],
    ['a string', 'notify_user'],
    ['null', null],
  ])('rejects %s', (_name, raw) => {
    expect(parseAgentDecision(raw)).toBeUndefined();
  });
});

describe('agentDecisionJsonSchema', () => {
  it('describes the decision without the keys some structured outputs reject', () => {
    const schema = agentDecisionJsonSchema();
    const text = JSON.stringify(schema);

    expect(schema).toMatchObject({
      properties: {
        action: {
          enum: [
            'inspect_status',
            'check_notion_session',
            'search_email_again',
            'wait',
            'retry_stage',
            'retry',
            'notify_user',
          ],
        },
        confidence: { enum: ['low', 'medium', 'high'] },
      },
      required: ['action', 'confidence', 'params', 'rationale'],
      type: 'object',
    });
    expect(text).not.toContain('$schema');
    expect(text).not.toContain('additionalProperties');
  });
});

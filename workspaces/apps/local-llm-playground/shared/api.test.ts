import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { chatRequestSchema, compareRequestSchema, recommendationCategorySchema } from './api.js';

describe('shared/api validation', () => {
  it('allows model to be omitted while still applying chat defaults', () => {
    const parsed = chatRequestSchema.parse({
      stream: false,
      userPrompt: 'hello there',
    });

    expect(parsed.model).toBeUndefined();
    expect(parsed.temperature).toBe(0.7);
  });

  it('rejects an empty user prompt', () => {
    expect(() =>
      chatRequestSchema.parse({
        userPrompt: '',
      }),
    ).toThrow(ZodError);
  });

  it('rejects an invalid model id', () => {
    expect(() =>
      chatRequestSchema.parse({
        model: 'nonexistent-model:9b',
        userPrompt: 'test',
      }),
    ).toThrow(ZodError);
  });

  it('coerces temperature within bounds', () => {
    const parsed = chatRequestSchema.parse({
      temperature: 1.5,
      userPrompt: 'test',
    });

    expect(parsed.temperature).toBe(1.5);
  });

  it('rejects temperature outside bounds', () => {
    expect(() =>
      chatRequestSchema.parse({
        temperature: 3,
        userPrompt: 'test',
      }),
    ).toThrow(ZodError);
  });

  it('rejects maxTokens outside bounds', () => {
    expect(() =>
      chatRequestSchema.parse({
        maxTokens: 0,
        userPrompt: 'test',
      }),
    ).toThrow(ZodError);

    expect(() =>
      chatRequestSchema.parse({
        maxTokens: 99_999,
        userPrompt: 'test',
      }),
    ).toThrow(ZodError);
  });

  it('rejects duplicate models in compare requests', () => {
    expect(() =>
      compareRequestSchema.parse({
        modelIds: ['qwen2.5:7b', 'qwen2.5:7b'],
        userPrompt: 'compare these',
      }),
    ).toThrow(ZodError);
  });

  it('rejects more than four compared models', () => {
    expect(() =>
      compareRequestSchema.parse({
        modelIds: ['qwen2.5:7b', 'yi:6b', 'llama3.1:8b', 'deepseek-coder-v2:16b', 'yi:6b'],
        userPrompt: 'compare too many',
      }),
    ).toThrow(ZodError);
  });

  it('rejects fewer than two compared models', () => {
    expect(() =>
      compareRequestSchema.parse({
        modelIds: ['qwen2.5:7b'],
        userPrompt: 'compare solo',
      }),
    ).toThrow(ZodError);
  });

  it('accepts valid recommendation categories', () => {
    expect(recommendationCategorySchema.parse('reasoning')).toBe('reasoning');
    expect(recommendationCategorySchema.parse('coding')).toBe('coding');
    expect(recommendationCategorySchema.parse('general')).toBe('general');
  });

  it('rejects invalid recommendation categories', () => {
    expect(() => recommendationCategorySchema.parse('invalid')).toThrow(ZodError);
  });

  it('accepts maxTokens at the boundaries (1 and 8192)', () => {
    expect(chatRequestSchema.parse({ maxTokens: 1, userPrompt: 'test' }).maxTokens).toBe(1);
    expect(chatRequestSchema.parse({ maxTokens: 8192, userPrompt: 'test' }).maxTokens).toBe(8192);
  });

  it('accepts temperature at the boundaries (0 and 2)', () => {
    expect(chatRequestSchema.parse({ temperature: 0, userPrompt: 'test' }).temperature).toBe(0);
    expect(chatRequestSchema.parse({ temperature: 2, userPrompt: 'test' }).temperature).toBe(2);
  });

  it('accepts exactly four compared models', () => {
    const result = compareRequestSchema.parse({
      modelIds: ['qwen2.5:7b', 'yi:6b', 'llama3.1:8b', 'deepseek-coder-v2:16b'],
      userPrompt: 'compare four',
    });

    expect(result.modelIds).toHaveLength(4);
  });
});

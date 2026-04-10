import { z } from 'zod';

import type { SupportedModelId } from './models.js';
import { isSupportedModelId, supportedModels } from './models.js';

const boundedModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => isSupportedModelId(value), {
    message: `Model must be one of: ${supportedModels.map((model) => model.id).join(', ')}`,
  });

const promptSchema = z.string().trim().min(1).max(20_000);

const systemPromptSchema = z.string().trim().max(4000).optional();

const maxTokensSchema = z.coerce.number().int().min(1).max(8192).optional();

const temperatureSchema = z.coerce.number().min(0).max(2).default(0.7);

export const chatRequestSchema = z.object({
  maxTokens: maxTokensSchema,
  model: boundedModelIdSchema.optional(),
  stream: z.boolean().default(true),
  systemPrompt: systemPromptSchema,
  temperature: temperatureSchema,
  userPrompt: promptSchema,
});

export const compareRequestSchema = z.object({
  maxTokens: maxTokensSchema,
  modelIds: z
    .array(boundedModelIdSchema)
    .min(2, 'Choose at least two models to compare.')
    .max(4, 'You can compare at most four models at once.')
    .refine((value) => new Set(value).size === value.length, {
      message: 'Each compared model must be unique.',
    }),
  systemPrompt: systemPromptSchema,
  temperature: temperatureSchema,
  userPrompt: promptSchema,
});

export const recommendationCategorySchema = z.enum(['reasoning', 'coding', 'general']);

export type ChatRequest = z.input<typeof chatRequestSchema>;
export type CompareRequest = z.input<typeof compareRequestSchema>;
export type RecommendationCategory = z.infer<typeof recommendationCategorySchema>;

export interface ApiErrorPayload {
  error: {
    code: string;
    details?: unknown;
    message: string;
    requestId?: string | undefined;
    statusCode: number;
  };
}

export interface ConfiguredModelView {
  family: string;
  id: SupportedModelId;
  installed: boolean;
  label: string;
  presetTags: string[];
  summary: string;
}

export interface HealthResponse {
  defaultModel: SupportedModelId;
  installedModelCount: number;
  ollamaAvailable: boolean;
  ollamaVersion?: string | undefined;
  requestId: string;
  status: 'degraded' | 'ok';
}

export interface ModelsResponse {
  defaultModel: SupportedModelId;
  installedModelIds: SupportedModelId[];
  models: ConfiguredModelView[];
  requestId: string;
}

export interface ChatResponse {
  latencyMs: number;
  model: string;
  requestId: string;
  responseText: string;
  usage?:
    | {
        completionTokens?: number | undefined;
        promptTokens?: number | undefined;
        totalTokens?: number | undefined;
      }
    | undefined;
}

export type ChatStreamEvent =
  | {
      requestId: string;
      type: 'start';
    }
  | {
      chunk: string;
      type: 'delta';
    }
  | {
      latencyMs: number;
      model: string;
      requestId: string;
      responseText: string;
      type: 'done';
    }
  | {
      error: ApiErrorPayload['error'];
      type: 'error';
    };

export type CompareResult =
  | {
      latencyMs: number;
      modelId: string;
      responseText: string;
      status: 'success';
    }
  | {
      error: ApiErrorPayload['error'];
      latencyMs: number;
      modelId: string;
      status: 'error';
    };

export interface CompareResponse {
  hadErrors: boolean;
  requestId: string;
  results: CompareResult[];
}

export interface LlmCheckerCommandResponse {
  cached: boolean;
  command: string[];
  durationMs: number;
  requestId: string;
  stderr: string;
  stdout: string;
}

import { z } from 'zod';

export const tokenSchema = z.string().min(32).max(256);
export const httpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);

  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === '';
}, 'An HTTPS URL without credentials or fragment is required');

const integrationSchema = z.strictObject({
  commands: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)).max(100),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  token: tokenSchema,
  url: httpsUrlSchema,
});

const registrySchema = z
  .array(integrationSchema)
  .min(1)
  .max(32)
  .superRefine((routes, ctx) => {
    const ids = new Set<string>();
    const tokens = new Set<string>();
    const commands = new Set<string>();

    for (const route of routes) {
      if (
        ids.has(route.id) ||
        tokens.has(route.token) ||
        route.commands.some((item) => commands.has(item))
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'Integration IDs, tokens and commands must be unique',
        });
      }

      if (route.commands.some((item) => ['start', 'help'].includes(item))) {
        ctx.addIssue({ code: 'custom', message: 'start and help are reserved hub commands' });
      }

      ids.add(route.id);
      tokens.add(route.token);
      for (const command of route.commands) commands.add(command);
    }
  });

export type Integration = z.infer<typeof integrationSchema>;

export class ConfigError extends Error {
  constructor() {
    super('Hub configuration is incomplete or invalid');
    this.name = 'ConfigError';
  }
}

export function parseConfig<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new ConfigError();
  }

  return result.data;
}

export function readIntegrations(source: NodeJS.ProcessEnv): Integration[] {
  let raw: unknown;

  try {
    raw = JSON.parse(source.HUB_INTEGRATIONS ?? '');
  } catch {
    throw new ConfigError();
  }

  const integrations = parseConfig(registrySchema, raw);

  if (
    source.HUB_LEGACY_INTEGRATION_ID !== undefined &&
    !integrations.some((route) => route.id === source.HUB_LEGACY_INTEGRATION_ID)
  ) {
    throw new ConfigError();
  }

  return integrations;
}

export const botEnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d{5,20}:[\w-]{30,64}$/),
});
export const chatEnvSchema = botEnvSchema.extend({
  TELEGRAM_CHAT_ID: z.string().regex(/^\d{1,20}$/),
});
export const webhookAuthSchema = z.object({
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[\w-]{32,256}$/),
});
export const runtimeEnvSchema = chatEnvSchema.extend({
  HUB_KEY_PREFIX: z
    .string()
    .regex(/^[\w:-]{1,100}$/)
    .default('telegram-hub:prod'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  UPSTASH_REDIS_REST_URL: httpsUrlSchema,
});
export const setupEnvSchema = chatEnvSchema.extend({
  APP_BASE_URL: httpsUrlSchema,
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[\w-]{32,256}$/),
});

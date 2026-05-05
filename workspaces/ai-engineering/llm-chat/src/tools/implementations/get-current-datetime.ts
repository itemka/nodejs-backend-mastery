import type { AppTool } from '../types.js';

interface GetCurrentDatetimeInput {
  readonly format?: 'human' | 'iso';
  readonly locale?: string;
  readonly timeZone?: string;
}

function parseInput(input: unknown): GetCurrentDatetimeInput {
  if (input === null || typeof input !== 'object') {
    return {};
  }

  const value = input as Record<string, unknown>;
  const format = value.format;
  const locale = value.locale;
  const timeZone = value.timeZone;

  if (format !== undefined && format !== 'iso' && format !== 'human') {
    throw new Error('format must be "iso" or "human".');
  }

  if (locale !== undefined && typeof locale !== 'string') {
    throw new Error('locale must be a string.');
  }

  if (timeZone !== undefined && typeof timeZone !== 'string') {
    throw new Error('timeZone must be a string.');
  }

  return {
    ...(format === undefined ? {} : { format }),
    ...(locale === undefined ? {} : { locale }),
    ...(timeZone === undefined ? {} : { timeZone }),
  };
}

export const getCurrentDatetimeTool: AppTool = {
  definition: {
    description:
      'Get the current date and time from the application clock. Use this when the user asks about the current time or date.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        format: {
          description:
            'Use "iso" for an ISO 8601 timestamp or "human" for a localized readable value.',
          enum: ['iso', 'human'],
          type: 'string',
        },
        locale: {
          description: 'Optional BCP 47 locale for human-readable output, for example "en-US".',
          type: 'string',
        },
        timeZone: {
          description:
            'Optional IANA time zone for human-readable output, for example "Europe/Warsaw".',
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'get_current_datetime',
  },
  execute(input, context) {
    const parsed = parseInput(input);
    const now = context.now();
    const iso = now.toISOString();

    if (parsed.format !== 'human') {
      return { iso_datetime: iso };
    }

    const formatter = new Intl.DateTimeFormat(parsed.locale ?? 'en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
      ...(parsed.timeZone === undefined ? {} : { timeZone: parsed.timeZone }),
    });

    return {
      human_datetime: formatter.format(now),
      iso_datetime: iso,
    };
  },
};

export interface SseMessage {
  data: string;
  event: string;
}

export async function readSseStream(
  response: Response,
  onMessage: (message: SseMessage) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error('The server did not return a readable stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });

      const extracted = extractMessages(buffer);
      buffer = extracted.remainder;

      for (const message of extracted.messages) {
        onMessage(message);
      }
    }

    if (buffer.trim()) {
      const extracted = extractMessages(`${buffer}\n\n`);

      for (const message of extracted.messages) {
        onMessage(message);
      }
    }
  } catch (error) {
    reader.cancel().catch(() => {
      // Intentionally ignoring cancel errors on a failed stream.
    });
    throw error;
  }
}

function extractMessages(buffer: string): {
  messages: SseMessage[];
  remainder: string;
} {
  const normalized = buffer.replaceAll('\r\n', '\n');
  const chunks = normalized.split('\n\n');

  if (chunks.length === 1) {
    return {
      messages: [],
      remainder: normalized,
    };
  }

  const remainder = chunks.pop() ?? '';
  const messages = chunks.flatMap((chunk) => {
    const event = chunk
      .split('\n')
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');

    return event && data
      ? [
          {
            data,
            event,
          },
        ]
      : [];
  });

  return {
    messages,
    remainder,
  };
}

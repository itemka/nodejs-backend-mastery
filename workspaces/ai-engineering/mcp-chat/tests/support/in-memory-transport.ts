import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client';

interface PairedTransport extends Transport {
  pair(other: InMemoryTransport): void;
}

class InMemoryTransport implements PairedTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private closed = false;
  private peer?: InMemoryTransport;

  pair(other: InMemoryTransport): void {
    this.peer = other;
  }

  start(): Promise<void> {
    return Promise.resolve();
  }

  send(message: JSONRPCMessage): Promise<void> {
    if (this.peer === undefined) {
      return Promise.reject(new Error('InMemoryTransport not paired'));
    }

    queueMicrotask(() => {
      this.peer?.onmessage?.(message);
    });

    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }

    this.closed = true;
    this.onclose?.();

    return Promise.resolve();
  }
}

export function createPairedTransports(): {
  clientTransport: Transport;
  serverTransport: Transport;
} {
  const server = new InMemoryTransport();
  const client = new InMemoryTransport();
  server.pair(client);
  client.pair(server);

  return { clientTransport: client, serverTransport: server };
}

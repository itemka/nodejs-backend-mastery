import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { onTestFinished } from 'vitest';

const WORKSPACE_HTML = readFileSync(
  path.resolve(import.meta.dirname, '../fixtures/notion/workspace.html'),
  'utf8',
);

/** What the fixture's final Export posts: the five dialog values. */
export interface ExportRecord {
  readonly content: string;
  readonly folders: boolean;
  readonly format: string;
  readonly privatePages: boolean;
  readonly views: string;
}

/**
 * How the fixture behaves (`tests/fixtures/notion/workspace.html`):
 * - `name`: the workspace switcher's text;
 * - `format`, `views`, `content`, `folders`, `privatePages`: the dialog's values when it opens;
 * - `broken`: parts left out, so a step finds nothing: `general` (the Settings tab),
 *   `settings-menu` (the menu item; the shortcut still works), `settings` (Settings never
 *   opens), `format` (Markdown & CSV), `private-pages` (the private pages toggle);
 * - `brokenOnFirstLoad`: `broken` applies to the first page load only;
 * - `state: 'exporting'`: the row's Export shows an export already running;
 * - `confirm: 'none'`: the final Export shows no confirmation.
 */
export interface WorkspaceOptions {
  broken?: readonly ('format' | 'general' | 'private-pages' | 'settings' | 'settings-menu')[];
  brokenOnFirstLoad?: boolean;
  confirm?: 'none' | 'shown';
  content?: string;
  folders?: boolean;
  format?: string;
  name?: string;
  privatePages?: boolean;
  state?: 'exporting' | 'idle';
  views?: string;
}

/** The workspace name the fixture shows by default, with Notion's typographic apostrophe. */
export const FIXTURE_WORKSPACE = 'Test User’s Notion';

const page = (title: string, body = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

/**
 * A local HTTP server for the browser tests, standing in for Notion's app:
 * - `/p/workspace`: the fixture, configured by `workspaceUrl(options)`;
 * - `/p/signed-out`: answers 200 like Notion, then the page itself goes to `/login`;
 * - `/p/challenge`: Cloudflare's interstitial title;
 * - `/p/loading`: never renders the app;
 * - `/p/down`: 503.
 * The final Export's POST lands in `exports`, and `events` records it in order with the test's own.
 */
export class NotionUi {
  readonly events: string[] = [];
  readonly exports: ExportRecord[] = [];
  /** How often `/p/workspace` was loaded. */
  workspaceLoads = 0;
  private readonly options = new Map<string, WorkspaceOptions>();
  private port = 0;
  private readonly server: Server;

  private constructor() {
    this.server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://local');

      if (request.method === 'POST' && url.pathname === '/export') {
        let body = '';

        request.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        request.on('end', () => {
          this.exports.push(JSON.parse(body) as ExportRecord);
          this.events.push('export');
          response.writeHead(204).end();
        });

        return;
      }

      const html = this.render(url);

      if (html === undefined) {
        response.writeHead(url.pathname === '/p/down' ? 503 : 404).end();

        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    });
  }

  static async start(): Promise<NotionUi> {
    const ui = new NotionUi();

    await new Promise<void>((resolve) => {
      ui.server.listen(0, '127.0.0.1', resolve);
    });
    ui.port = (ui.server.address() as AddressInfo).port;
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          ui.server.closeAllConnections();
          ui.server.close(() => {
            resolve();
          });
        }),
    );

    return ui;
  }

  url(pathname: string): string {
    return `http://127.0.0.1:${this.port}${pathname}`;
  }

  /** The fixture's URL; the options are kept server-side under an ID in the query. */
  workspaceUrl(options: WorkspaceOptions = {}): string {
    const id = String(this.options.size);

    this.options.set(id, options);

    return this.url(`/p/workspace?case=${id}`);
  }

  private render(url: URL): string | undefined {
    switch (url.pathname) {
      case '/login': {
        return page('Log in | Notion', '<div>Log in</div>');
      }

      case '/p/challenge': {
        return page('Just a moment...', '<div>Checking your browser</div>');
      }

      case '/p/loading': {
        return page('Notion', '<div>Loading</div>');
      }

      case '/p/signed-out': {
        return page('Notion', "<script>setTimeout(() => location.replace('/login'), 200)</script>");
      }

      case '/p/workspace': {
        this.workspaceLoads += 1;

        return this.workspace(this.options.get(url.searchParams.get('case') ?? '') ?? {});
      }

      default: {
        return undefined;
      }
    }
  }

  private workspace(options: WorkspaceOptions): string {
    const broken =
      options.brokenOnFirstLoad === true && this.workspaceLoads > 1 ? [] : (options.broken ?? []);
    const config = {
      broken,
      confirm: options.confirm ?? 'shown',
      content: options.content ?? 'Everything',
      folders: options.folders ?? true,
      format: options.format ?? 'Markdown & CSV',
      name: options.name ?? FIXTURE_WORKSPACE,
      privatePages: options.privatePages ?? true,
      state: options.state ?? 'idle',
      views: options.views ?? 'Current view',
    };

    return WORKSPACE_HTML.replace('/*CONFIG*/', `window.NBA_FIXTURE = ${JSON.stringify(config)};`);
  }
}

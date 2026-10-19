import { createHash } from 'node:crypto';

import type { RecordedRequest } from './fake-google.js';
import { FakeGoogle, googleError } from './fake-google.js';

const FILES = 'www.googleapis.com/drive/v3/files';
const UPLOADS = 'www.googleapis.com/upload/drive/v3/files';
const CHUNK_UNIT = 256 * 1024;

export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
export const ROOT_ID = 'root-folder-id';

export interface FakeFile {
  appProperties: Record<string, string>;
  /** Undefined for folders. */
  content: Uint8Array | undefined;
  createdTime: string;
  id: string;
  mimeType: string;
  name: string;
  parents: string[];
  trashed: boolean;
}

export interface ChunkCall {
  /** 1-based, counted across every session. */
  readonly index: number;
  readonly length: number;
  readonly sessionId: string;
  readonly start: number;
  /** Undefined for `/*`. */
  readonly total: number | undefined;
}

/** How the fake deviates from accepting one chunk whole. */
export interface ChunkFault {
  /** The session expires: this and every later request to it get 404. */
  expire?: boolean;
  /** The connection drops after Drive kept `persist` bytes; the client sees a network error. */
  networkError?: boolean;
  /** Bytes of the chunk Drive keeps: all when no fault is returned, else 0 unless set. */
  persist?: number;
  /** The reply, instead of the normal one. */
  response?: () => Response;
}

interface UploadSession {
  readonly declaredSize: number | undefined;
  expired: boolean;
  fileId: string | undefined;
  readonly id: string;
  readonly metadata: UploadMetadata;
  readonly pieces: Uint8Array[];
  received: number;
}

interface UploadMetadata {
  appProperties?: Record<string, string>;
  mimeType?: string;
  name?: string;
  parents?: string[];
}

interface Checksums {
  sha256Checksum?: string;
}

/**
 * A stateful stand-in for Drive v3 on top of `FakeGoogle`: folders and files, the `q` clauses
 * the app sends, `fields` selection, and the resumable upload protocol. It is strict where Drive
 * is (chunk sizes, the committed offset), so a protocol slip fails the test with a 400.
 */
export class FakeDrive {
  /**
   * Drive's reported checksum; `read` counts the reads of that file. Tests override it, and a
   * throwing override drops the connection.
   */
  checksums: (file: FakeFile, read: number) => Checksums = (file) => digests(file.content);
  readonly files = new Map<string, FakeFile>();
  readonly google = new FakeGoogle();
  /** Files and folders the app cannot see: GET 404, hidden from lists, refuse children. */
  readonly invisible = new Set<string>();
  /** The session URL the initiation returns. */
  locationFor: (sessionId: string) => string = (sessionId) =>
    `https://${UPLOADS}?uploadType=resumable&upload_id=${sessionId}`;
  onChunk?: (call: ChunkCall) => ChunkFault | undefined;
  /** Replaces the reply to the n-th session start (1-based), such as with a 503. */
  onStart?: (attempt: number) => Response | undefined;
  private startAttempts = 0;
  private chunkCount = 0;
  private readonly checksumReads = new Map<string, number>();
  private fileCount = 0;
  private readonly sessions = new Map<string, UploadSession>();

  constructor() {
    this.files.set(ROOT_ID, {
      appProperties: {},
      content: undefined,
      createdTime: '2026-01-01T00:00:00.000Z',
      id: ROOT_ID,
      mimeType: FOLDER_MIME_TYPE,
      name: 'Full Workspace',
      parents: ['my-drive'],
      trashed: false,
    });

    this.google
      .onRefresh()
      .on('GET', `${FILES}/*`, (request) => this.getFile(request))
      .on('GET', FILES, (request) => this.listFiles(request))
      .on('POST', FILES, (request) => this.createFile(request))
      .on('PATCH', `${FILES}/*`, (request) => this.updateFile(request))
      .on('DELETE', `${FILES}/*`, (request) => this.deleteFile(request))
      .on('POST', UPLOADS, (request) => this.startUpload(request))
      .on('PUT', UPLOADS, (request) => this.putChunk(request));
  }

  get fetch(): typeof fetch {
    return this.google.fetch;
  }

  /** Chunk PUTs and status queries, in order, as their `Content-Range` headers. */
  get contentRanges(): string[] {
    return this.google
      .requestsTo(UPLOADS)
      .filter((request) => request.method === 'PUT')
      .map((request) => request.headers.get('content-range') ?? '');
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  add(file: Partial<FakeFile> & { name: string }, parentId: string = ROOT_ID): FakeFile {
    const created: FakeFile = {
      appProperties: {},
      content: undefined,
      createdTime: this.nextCreatedTime(),
      id: `file-${(this.fileCount += 1)}`,
      mimeType: FOLDER_MIME_TYPE,
      parents: [parentId],
      trashed: false,
      ...file,
    };

    this.files.set(created.id, created);

    return created;
  }

  childrenOf(parentId: string): FakeFile[] {
    return [...this.files.values()].filter(
      (file) => file.parents.includes(parentId) && !file.trashed,
    );
  }

  named(name: string): FakeFile[] {
    return [...this.files.values()].filter((file) => file.name === name);
  }

  private createFile({ body, url }: RecordedRequest): Response {
    const metadata = JSON.parse(body) as UploadMetadata;
    const refusal = this.refuseParents(metadata.parents);

    if (refusal !== undefined) {
      return refusal;
    }

    const file = this.store(
      metadata,
      metadata.mimeType === FOLDER_MIME_TYPE ? undefined : new Uint8Array(),
    );

    return Response.json(this.view(file, url.searchParams.get('fields')));
  }

  private deleteFile({ url }: RecordedRequest): Response {
    const id = lastSegment(url);

    if (!this.files.has(id) || this.invisible.has(id)) {
      return googleError(404, 'notFound');
    }

    this.files.delete(id);

    return new Response(undefined, { status: 204 });
  }

  private finish(session: UploadSession): string {
    const file = this.store(session.metadata, concat(session.pieces));

    session.fileId = file.id;

    return file.id;
  }

  private getFile({ url }: RecordedRequest): Response {
    const file = this.files.get(lastSegment(url));

    if (file === undefined || this.invisible.has(file.id)) {
      return googleError(404, 'notFound');
    }

    return Response.json(this.view(file, url.searchParams.get('fields')));
  }

  private incomplete(session: UploadSession): Response {
    return new Response(undefined, {
      headers: session.received > 0 ? { Range: `bytes=0-${session.received - 1}` } : {},
      status: 308,
    });
  }

  private listFiles({ url }: RecordedRequest): Response {
    let matches: (file: FakeFile) => boolean;

    try {
      matches = compileQuery(url.searchParams.get('q') ?? '');
    } catch {
      return googleError(400, 'invalidQuery');
    }

    const found = [...this.files.values()].filter(
      (file) => !this.invisible.has(file.id) && matches(file),
    );
    const pageSize = Number(url.searchParams.get('pageSize') ?? 100);
    const offset = Number(url.searchParams.get('pageToken') ?? 0);
    const page = found.slice(offset, offset + pageSize);
    const next = offset + pageSize < found.length ? String(offset + pageSize) : undefined;
    const fields = url.searchParams.get('fields') ?? 'files(id,name,mimeType)';

    return Response.json(
      select({ files: page.map((file) => this.resource(file)), nextPageToken: next }, fields),
    );
  }

  private nextCreatedTime(): string {
    return new Date(Date.UTC(2026, 9, 19, 10, 0, this.fileCount)).toISOString();
  }

  private putChunk({ bytes, headers, url }: RecordedRequest): Response {
    const session = this.sessions.get(url.searchParams.get('upload_id') ?? '');

    if (session === undefined || session.expired) {
      return googleError(404, 'notFound');
    }

    if (session.fileId !== undefined) {
      return Response.json(this.uploadedView(session.fileId));
    }

    const range = parseContentRange(headers.get('content-range'));

    if (range === undefined) {
      return googleError(400, 'badContentRange');
    }

    if (range.start === undefined) {
      // A status query, or an empty last chunk that names the total.
      if (bytes.length > 0) {
        return googleError(400, 'badContentRange');
      }

      if (range.total !== undefined && range.total === session.received) {
        return Response.json(this.uploadedView(this.finish(session)));
      }

      return this.incomplete(session);
    }

    const length = range.end - range.start + 1;
    const last = range.total !== undefined && range.end + 1 === range.total;

    if (
      bytes.length !== length ||
      range.start !== session.received ||
      (range.total !== undefined && range.end + 1 > range.total) ||
      (session.declaredSize !== undefined &&
        range.total !== undefined &&
        range.total !== session.declaredSize) ||
      (!last && length % CHUNK_UNIT !== 0)
    ) {
      return googleError(400, 'badContentRange');
    }

    this.chunkCount += 1;

    const fault = this.onChunk?.({
      index: this.chunkCount,
      length,
      sessionId: session.id,
      start: range.start,
      total: range.total,
    });
    const persist = Math.min(length, fault === undefined ? length : (fault.persist ?? 0));

    session.pieces.push(bytes.slice(0, persist));
    session.received += persist;

    if (last && session.received === range.total) {
      this.finish(session);
    }

    if (fault?.expire === true) {
      session.expired = true;

      return googleError(404, 'notFound');
    }

    if (fault?.networkError === true) {
      throw new TypeError('fetch failed');
    }

    if (fault?.response !== undefined) {
      return fault.response();
    }

    return session.fileId === undefined
      ? this.incomplete(session)
      : Response.json(this.uploadedView(session.fileId));
  }

  private refuseParents(parents: string[] | undefined): Response | undefined {
    const usable = (parents ?? []).every((id) => {
      const parent = this.files.get(id);

      return parent?.mimeType === FOLDER_MIME_TYPE && !this.invisible.has(id);
    });

    return usable && parents?.length === 1 ? undefined : googleError(404, 'notFound');
  }

  /** The full v3 resource; `view` and `select` cut it down to the requested fields. */
  private resource(file: FakeFile): Record<string, unknown> {
    let checksums: Checksums = {};

    if (file.content !== undefined) {
      const read = (this.checksumReads.get(file.id) ?? 0) + 1;

      this.checksumReads.set(file.id, read);
      checksums = this.checksums(file, read);
    }

    return {
      ...(Object.keys(file.appProperties).length > 0 ? { appProperties: file.appProperties } : {}),
      capabilities: { canAddChildren: file.mimeType === FOLDER_MIME_TYPE },
      createdTime: file.createdTime,
      id: file.id,
      kind: 'drive#file',
      mimeType: file.mimeType,
      name: file.name,
      parents: file.parents,
      trashed: file.trashed,
      ...(file.content === undefined ? {} : { size: String(file.content.length), ...checksums }),
    };
  }

  private startUpload({ body, headers, url }: RecordedRequest): Response {
    this.startAttempts += 1;

    const replaced = this.onStart?.(this.startAttempts);

    if (replaced !== undefined) {
      return replaced;
    }

    if (url.searchParams.get('uploadType') !== 'resumable') {
      return googleError(400, 'badRequest');
    }

    const metadata = JSON.parse(body) as UploadMetadata;
    const refusal = this.refuseParents(metadata.parents);

    if (refusal !== undefined) {
      return refusal;
    }

    const declared = headers.get('x-upload-content-length');
    const id = `session-${this.sessions.size + 1}`;

    this.sessions.set(id, {
      declaredSize: declared === null ? undefined : Number(declared),
      expired: false,
      fileId: undefined,
      id,
      metadata,
      pieces: [],
      received: 0,
    });

    return new Response(undefined, { headers: { Location: this.locationFor(id) }, status: 200 });
  }

  private store(metadata: UploadMetadata, content: Uint8Array | undefined): FakeFile {
    return this.add(
      {
        appProperties: { ...metadata.appProperties },
        content,
        mimeType: metadata.mimeType ?? 'application/octet-stream',
        name: metadata.name ?? 'Untitled',
      },
      metadata.parents?.[0],
    );
  }

  private updateFile({ body, url }: RecordedRequest): Response {
    const file = this.files.get(lastSegment(url));

    if (file === undefined || this.invisible.has(file.id)) {
      return googleError(404, 'notFound');
    }

    const { appProperties = {} } = JSON.parse(body) as UploadMetadata;

    file.appProperties = { ...file.appProperties, ...appProperties };

    return Response.json(this.view(file, url.searchParams.get('fields')));
  }

  /** What the last chunk returns: the default v3 fields. */
  private uploadedView(fileId: string): Record<string, unknown> {
    const file = this.files.get(fileId);

    return { id: fileId, kind: 'drive#file', mimeType: file?.mimeType, name: file?.name };
  }

  private view(file: FakeFile, fields: null | string): Record<string, unknown> {
    return select(this.resource(file), fields ?? 'kind,id,name,mimeType');
  }
}

function digests(content: Uint8Array | undefined): Checksums {
  return content === undefined
    ? {}
    : { sha256Checksum: createHash('sha256').update(content).digest('hex') };
}

function concat(pieces: readonly Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(pieces));
}

function lastSegment(url: URL): string {
  return url.pathname.split('/').at(-1) ?? '';
}

/** `bytes 0-9/100`, `bytes 0-9/*`, `bytes *\/100` or `bytes *\/*`. */
function parseContentRange(
  value: null | string,
):
  | { end: number; start: number; total: number | undefined }
  | { end?: undefined; start: undefined; total: number | undefined }
  | undefined {
  const match = /^bytes (?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(value ?? '');

  if (match === null) {
    return undefined;
  }

  const total = match[3] === '*' ? undefined : Number(match[3]);

  return match[1] === undefined || match[2] === undefined
    ? { start: undefined, total }
    : { end: Number(match[2]), start: Number(match[1]), total };
}

const literal = String.raw`'((?:[^'\\]|\\.)*)'`;
const unquote = (value: string | undefined) => (value ?? '').replaceAll(/\\(.)/g, '$1');

type Clause = [RegExp, (match: RegExpExecArray, file: FakeFile) => boolean];

/** The `q` clauses the app sends, joined by `and`. Anything else is a 400. */
const clauses: Clause[] = [
  [new RegExp(`^${literal} in parents`), (match, file) => file.parents.includes(unquote(match[1]))],
  [/^trashed = (true|false)/, (match, file) => file.trashed === (match[1] === 'true')],
  [
    new RegExp(`^mimeType (!?=) ${literal}`),
    (match, file) => (file.mimeType === unquote(match[2])) === (match[1] === '='),
  ],
  [new RegExp(`^name = ${literal}`), (match, file) => file.name === unquote(match[1])],
  [
    new RegExp(String.raw`^appProperties has \{ key=${literal} and value=${literal} \}`),
    (match, file) => file.appProperties[unquote(match[1])] === unquote(match[2]),
  ],
];

function compileQuery(q: string): (file: FakeFile) => boolean {
  const predicates: ((file: FakeFile) => boolean)[] = [];
  let rest = q;

  for (;;) {
    let matched: RegExpExecArray | undefined;

    for (const [pattern, test] of clauses) {
      const match = pattern.exec(rest);

      if (match !== null) {
        matched = match;
        predicates.push((file) => test(match, file));
        break;
      }
    }

    if (matched === undefined) {
      throw new Error(`Unsupported query: ${q}`);
    }

    rest = rest.slice(matched[0].length);

    if (rest === '') {
      return (file) => predicates.every((predicate) => predicate(file));
    }

    if (!rest.startsWith(' and ')) {
      throw new Error(`Unsupported query: ${q}`);
    }

    rest = rest.slice(' and '.length);
  }
}

/** `id,name,files(id,name),capabilities(canAddChildren)` → the top-level names and their sub-specs. */
function parseFields(spec: string): Map<string, string | undefined> {
  const fields = new Map<string, string | undefined>();
  let depth = 0;
  let start = 0;

  for (let index = 0; index <= spec.length; index += 1) {
    const character = spec[index];

    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    } else if ((character === ',' && depth === 0) || index === spec.length) {
      const match = /^(\w+)(?:\((.*)\))?$/.exec(spec.slice(start, index).trim());

      if (match?.[1] !== undefined) {
        fields.set(match[1], match[2]);
      }

      start = index + 1;
    }
  }

  return fields;
}

function select(value: Record<string, unknown>, spec: string): Record<string, unknown> {
  const selected: Record<string, unknown> = {};

  for (const [name, sub] of parseFields(spec)) {
    const field = value[name];

    if (field === undefined) {
      continue;
    }

    if (sub === undefined) {
      selected[name] = field;
    } else if (Array.isArray(field)) {
      selected[name] = field.map((item) => select(item as Record<string, unknown>, sub));
    } else {
      selected[name] = select(field as Record<string, unknown>, sub);
    }
  }

  return selected;
}

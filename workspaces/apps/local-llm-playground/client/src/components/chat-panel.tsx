import type { ConfiguredModelView } from '../../../shared/api.js';
import type { SupportedModelId } from '../../../shared/models.js';
import type { ChatUiState, PlaygroundSettings } from '../types.js';

interface ChatPanelProps {
  chatState: ChatUiState;
  models: ConfiguredModelView[];
  onAbort: () => void;
  onCopy: () => void;
  onSend: () => void;
  onSettingsChange: (patch: Partial<PlaygroundSettings>) => void;
  selectedModelId: ConfiguredModelView['id'];
  settings: PlaygroundSettings;
}

export function ChatPanel({
  chatState,
  models,
  onAbort,
  onCopy,
  onSend,
  onSettingsChange,
  selectedModelId,
  settings,
}: Readonly<ChatPanelProps>) {
  const isBusy = chatState.status === 'loading' || chatState.status === 'streaming';
  const modelCountLabel = models.length === 1 ? '1 model' : `${models.length} models`;
  let statusLabel = 'Ready';

  switch (chatState.status) {
    case 'error': {
      statusLabel = chatState.error ?? 'Request failed';

      break;
    }

    case 'success': {
      statusLabel = `Completed in ${chatState.latencyMs ?? 0} ms`;

      break;
    }

    case 'loading': {
      statusLabel = 'Waiting for Ollama';

      break;
    }

    case 'streaming': {
      statusLabel = 'Streaming';

      break;
    }
    // No default
  }

  const assistantText =
    chatState.responseText || 'Responses from Ollama will appear here after you send a prompt.';
  const requestIdNode = chatState.requestId ? (
    <span className="truncate text-xs text-slate-400">{chatState.requestId}</span>
  ) : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-sm text-slate-500" htmlFor="chat-model-select">
            Model
          </label>
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            id="chat-model-select"
            onChange={(event) => {
              onSettingsChange({
                model: event.currentTarget.value as SupportedModelId,
              });
            }}
            value={selectedModelId}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <span className="text-sm text-slate-500">{modelCountLabel}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span>{statusLabel}</span>
          {requestIdNode}
        </div>
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700">
          System prompt
        </summary>
        <div className="border-t border-slate-100 px-4 py-4">
          <textarea
            aria-label="System prompt"
            className="min-h-28 w-full rounded-2xl border border-slate-200 bg-[#f7f7f8] px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
            onChange={(event) => {
              onSettingsChange({
                systemPrompt: event.currentTarget.value,
              });
            }}
            value={settings.systemPrompt}
          />
        </div>
      </details>

      <div className="rounded-[28px] border border-slate-200 bg-white p-3">
        <textarea
          aria-label="User prompt"
          className="min-h-36 w-full rounded-[22px] border border-transparent bg-transparent px-3 py-3 text-sm leading-7 text-slate-900 outline-none placeholder:text-slate-400"
          onChange={(event) => {
            onSettingsChange({
              userPrompt: event.currentTarget.value,
            });
          }}
          placeholder="Message your local model..."
          value={settings.userPrompt}
        />

        <div className="mt-3 flex flex-col gap-3 border-t border-slate-100 px-2 pt-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <label className="flex items-center gap-2">
              <input
                checked={settings.stream}
                className="h-4 w-4 accent-slate-900"
                onChange={(event) => {
                  onSettingsChange({
                    stream: event.currentTarget.checked,
                  });
                }}
                type="checkbox"
              />
              <span>Stream</span>
            </label>
            <label className="flex items-center gap-2">
              <span>Temp</span>
              <input
                className="w-18 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                max={2}
                min={0}
                onChange={(event) => {
                  onSettingsChange({
                    temperature: Number(event.currentTarget.value),
                  });
                }}
                step={0.1}
                type="number"
                value={settings.temperature}
              />
            </label>
            <label className="flex items-center gap-2">
              <span>Max</span>
              <input
                className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                max={8192}
                min={1}
                onChange={(event) => {
                  onSettingsChange({
                    maxTokens: Number(event.currentTarget.value),
                  });
                }}
                step={1}
                type="number"
                value={settings.maxTokens}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!chatState.responseText}
              onClick={onCopy}
              type="button"
            >
              Copy
            </button>
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!isBusy}
              onClick={onAbort}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isBusy || !settings.userPrompt.trim()}
              onClick={onSend}
              type="button"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      <MessageBlock align="left" body={assistantText} label="Assistant" />
    </div>
  );
}

interface MessageBlockProps {
  align: 'left' | 'right';
  body: string;
  label: string;
  meta?: string;
}

function MessageBlock({ align, body, label, meta }: Readonly<MessageBlockProps>) {
  const isRightAligned = align === 'right';
  const wrapperClassName = isRightAligned ? 'flex justify-end' : 'flex justify-start';
  const blockClassName = isRightAligned
    ? 'max-w-[78%] rounded-[24px] bg-slate-900 px-5 py-4 text-white'
    : 'w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4';
  const metaClassName = isRightAligned ? 'text-white/70' : 'text-slate-500';
  const textClassName = isRightAligned ? 'text-white' : 'text-slate-700';

  return (
    <div className={wrapperClassName}>
      <article className={blockClassName}>
        <div className={`mb-2 text-xs font-medium ${metaClassName}`}>
          {label}
          {meta ? ` • ${meta}` : ''}
        </div>
        <pre className={`whitespace-pre-wrap wrap-break-word text-sm leading-7 ${textClassName}`}>
          {body}
        </pre>
      </article>
    </div>
  );
}

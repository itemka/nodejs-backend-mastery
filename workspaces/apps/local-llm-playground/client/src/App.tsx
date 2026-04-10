import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  HealthResponse,
  LlmCheckerCommandResponse,
  ModelsResponse,
} from '../../shared/api.js';
import { isSupportedModelId, supportedModels } from '../../shared/models.js';
import { ChatPanel } from './components/chat-panel.js';
import { ComparePanel } from './components/compare-panel.js';
import { LlmCheckerPanel } from './components/llm-checker-panel.js';
import { SidebarNav } from './components/sidebar-nav.js';
import { StatusPill } from './components/status-pill.js';
import { usePersistentState } from './hooks/use-persistent-state.js';
import { ApiClientError, api } from './lib/api.js';
import type {
  ChatUiState,
  CheckerSectionKey,
  CheckerSectionState,
  CompareUiState,
  PlaygroundSettings,
  WorkspaceView,
} from './types.js';

interface LoadState<T> {
  data?: T;
  error?: string;
  status: 'error' | 'idle' | 'loading' | 'success';
}

const settingsStorageKey = 'local-llm-playground/settings';
const viewStorageKey = 'local-llm-playground/active-view';

const initialSettings: PlaygroundSettings = {
  compareModelIds: ['qwen2.5:7b', 'llama3.1:8b'],
  maxTokens: 1024,
  stream: false,
  systemPrompt: 'You are a helpful local-only assistant. Be concise, accurate, and practical.',
  temperature: 0.7,
  userPrompt: 'Explain how the Node.js event loop schedules timers, I/O callbacks, and microtasks.',
};

const initialChatState: ChatUiState = {
  responseText: '',
  status: 'idle',
};

const initialCompareState: CompareUiState = {
  results: [],
  status: 'idle',
};

function createInitialCheckerSections(): Record<CheckerSectionKey, CheckerSectionState> {
  return {
    check: { status: 'idle' },
    codingRecommendation: { status: 'idle' },
    installed: { status: 'idle' },
    ollamaPlan: { status: 'idle' },
    reasoningRecommendation: { status: 'idle' },
  };
}

export default function App() {
  const [settings, setSettings] = usePersistentState(settingsStorageKey, initialSettings);
  const [activeView, setActiveView] = usePersistentState<WorkspaceView>(viewStorageKey, 'chat');
  const [healthState, setHealthState] = useState<LoadState<HealthResponse>>({
    status: 'idle',
  });
  const [modelsState, setModelsState] = useState<LoadState<ModelsResponse>>({
    status: 'idle',
  });
  const [chatState, setChatState] = useState<ChatUiState>(initialChatState);
  const [compareState, setCompareState] = useState<CompareUiState>(initialCompareState);
  const [checkerSections, setCheckerSections] = useState<
    Record<CheckerSectionKey, CheckerSectionState>
  >(createInitialCheckerSections());
  const chatAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const compareAbortControllerRef = useRef<AbortController | undefined>(undefined);

  const refreshMetadata = useCallback(async (): Promise<void> => {
    setHealthState({ status: 'loading' });
    setModelsState({ status: 'loading' });

    const [healthResult, modelsResult] = await Promise.allSettled([
      api.getHealth(),
      api.getModels(),
    ]);

    if (healthResult.status === 'fulfilled') {
      setHealthState({ data: healthResult.value, status: 'success' });
    } else {
      setHealthState({ error: toErrorMessage(healthResult.reason), status: 'error' });
    }

    if (modelsResult.status === 'fulfilled') {
      setModelsState({ data: modelsResult.value, status: 'success' });
    } else {
      setModelsState({ error: toErrorMessage(modelsResult.reason), status: 'error' });
    }
  }, []);

  useEffect(() => {
    refreshMetadata().catch(() => {
      // refreshMetadata maps fetch failures into component state via Promise.allSettled.
    });
  }, [refreshMetadata]);

  const models = useMemo(
    () =>
      modelsState.data?.models ??
      supportedModels.map((model) => ({
        family: model.family,
        id: model.id,
        installed: false,
        label: model.label,
        presetTags: [...model.presetTags],
        summary: model.summary,
      })),
    [modelsState.data?.models],
  );

  const selectedModelId =
    settings.model && isSupportedModelId(settings.model)
      ? settings.model
      : (modelsState.data?.defaultModel ?? supportedModels[0].id);

  function updateSettings(patch: Partial<PlaygroundSettings>): void {
    setSettings((current) => ({
      ...current,
      ...patch,
    }));
  }

  async function handleSend(): Promise<void> {
    chatAbortControllerRef.current?.abort();

    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;

    const payload = {
      maxTokens: settings.maxTokens,
      stream: settings.stream,
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      userPrompt: settings.userPrompt,
      ...(settings.model && isSupportedModelId(settings.model) ? { model: settings.model } : {}),
    };

    setChatState({
      responseText: '',
      status: settings.stream ? 'streaming' : 'loading',
    });

    try {
      if (settings.stream) {
        await api.streamChat(
          payload,
          (event) => {
            if (event.type === 'start') {
              setChatState((current) => ({
                ...current,
                requestId: event.requestId,
                status: 'streaming',
              }));

              return;
            }

            if (event.type === 'delta') {
              setChatState((current) => ({
                ...current,
                responseText: `${current.responseText}${event.chunk}`,
                status: 'streaming',
              }));

              return;
            }

            if (event.type === 'done') {
              setChatState({
                latencyMs: event.latencyMs,
                requestId: event.requestId,
                responseText: event.responseText,
                status: 'success',
              });

              return;
            }

            setChatState((current) => ({
              ...current,
              error: event.error.message,
              status: 'error',
            }));
          },
          abortController.signal,
        );
      } else {
        const result = await api.chat(payload, abortController.signal);

        setChatState({
          latencyMs: result.latencyMs,
          requestId: result.requestId,
          responseText: result.responseText,
          status: 'success',
        });
      }

      await refreshMetadata();
    } catch (error) {
      if (abortController.signal.aborted) {
        setChatState((current) => ({
          ...current,
          error: 'Request cancelled.',
          status: 'error',
        }));
      } else {
        setChatState((current) => ({
          ...current,
          error: toErrorMessage(error),
          status: 'error',
        }));
      }
    } finally {
      if (chatAbortControllerRef.current === abortController) {
        chatAbortControllerRef.current = undefined;
      }
    }
  }

  async function handleCompare(): Promise<void> {
    compareAbortControllerRef.current?.abort();

    const abortController = new AbortController();
    compareAbortControllerRef.current = abortController;

    setCompareState({
      results: [],
      status: 'loading',
    });

    try {
      const result = await api.compare(
        {
          maxTokens: settings.maxTokens,
          modelIds: settings.compareModelIds,
          systemPrompt: settings.systemPrompt,
          temperature: settings.temperature,
          userPrompt: settings.userPrompt,
        },
        abortController.signal,
      );

      setCompareState({
        results: result.results,
        status: 'success',
      });
      await refreshMetadata();
    } catch (error) {
      setCompareState({
        error: abortController.signal.aborted ? 'Comparison cancelled.' : toErrorMessage(error),
        results: [],
        status: 'error',
      });
    } finally {
      if (compareAbortControllerRef.current === abortController) {
        compareAbortControllerRef.current = undefined;
      }
    }
  }

  async function handleLoadCheckerSection(section: CheckerSectionKey): Promise<void> {
    setCheckerSections((current) => ({
      ...current,
      [section]: {
        ...current[section],
        error: undefined,
        status: 'loading',
      },
    }));

    try {
      const data = await loadCheckerSection(section);

      setCheckerSections((current) => ({
        ...current,
        [section]: {
          data,
          status: 'success',
        },
      }));
    } catch (error) {
      setCheckerSections((current) => ({
        ...current,
        [section]: {
          error: toErrorMessage(error),
          status: 'error',
        },
      }));
    }
  }

  async function handleLoadAllChecker(): Promise<void> {
    for (const section of [
      'check',
      'installed',
      'reasoningRecommendation',
      'codingRecommendation',
      'ollamaPlan',
    ] as const) {
      await handleLoadCheckerSection(section);
    }
  }

  async function handleCopyResponse(): Promise<void> {
    if (!chatState.responseText) {
      return;
    }

    const clipboard = globalThis.navigator?.clipboard;

    if (!clipboard) {
      return;
    }

    try {
      await clipboard.writeText(chatState.responseText);
    } catch {
      // Clipboard access may be blocked in insecure contexts or by permission policies.
    }
  }

  function handleRefreshRequest(): void {
    refreshMetadata().catch(() => {
      // refreshMetadata maps fetch failures into component state via Promise.allSettled.
    });
  }

  function handleCopyRequest(): void {
    handleCopyResponse().catch(() => {
      // handleCopyResponse handles clipboard failures internally.
    });
  }

  function handleSendRequest(): void {
    handleSend().catch(() => {
      // handleSend maps request failures into chat state.
    });
  }

  function handleCompareRequest(): void {
    handleCompare().catch(() => {
      // handleCompare maps request failures into compare state.
    });
  }

  function handleLoadAllCheckerRequest(): void {
    handleLoadAllChecker().catch(() => {
      // handleLoadAllChecker delegates failures to the section-level handlers.
    });
  }

  function handleLoadCheckerSectionRequest(section: CheckerSectionKey): void {
    handleLoadCheckerSection(section).catch(() => {
      // handleLoadCheckerSection maps failures into checker section state.
    });
  }

  const healthTone = getHealthTone(healthState);
  const healthLabel = getHealthLabel(healthState);
  const pageTitle = getViewTitle(activeView);

  return (
    <main className="min-h-screen bg-[#f7f7f8] text-slate-900">
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        <SidebarNav
          activeView={activeView}
          healthLabel={healthLabel}
          healthTone={healthTone}
          installedCount={models.filter((model) => model.installed).length}
          onRefresh={handleRefreshRequest}
          onViewChange={setActiveView}
        />

        <section className="min-w-0">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-[#f7f7f8]/95 backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-4 sm:px-6 lg:px-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-semibold text-slate-900">{pageTitle}</h2>

                <div className="flex flex-wrap items-center gap-2 lg:hidden">
                  <StatusPill tone={healthTone}>{healthLabel}</StatusPill>
                  <button
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    onClick={handleRefreshRequest}
                    type="button"
                  >
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-5xl px-5 py-6 sm:px-6 lg:px-8">
            {activeView === 'chat' ? (
              <ChatPanel
                chatState={chatState}
                models={models}
                onAbort={() => {
                  chatAbortControllerRef.current?.abort();
                }}
                onCopy={handleCopyRequest}
                onSend={handleSendRequest}
                onSettingsChange={updateSettings}
                selectedModelId={selectedModelId}
                settings={settings}
              />
            ) : undefined}

            {activeView === 'compare' ? (
              <ComparePanel
                compareState={compareState}
                models={models}
                onAbort={() => {
                  compareAbortControllerRef.current?.abort();
                }}
                onRun={handleCompareRequest}
                onSettingsChange={updateSettings}
                settings={settings}
              />
            ) : undefined}

            {activeView === 'checker' ? (
              <LlmCheckerPanel
                onLoadAll={handleLoadAllCheckerRequest}
                onLoadSection={handleLoadCheckerSectionRequest}
                sections={checkerSections}
              />
            ) : undefined}
          </div>
        </section>
      </div>
    </main>
  );
}

async function loadCheckerSection(section: CheckerSectionKey): Promise<LlmCheckerCommandResponse> {
  if (section === 'check') {
    return await api.llmChecker.check();
  }

  if (section === 'installed') {
    return await api.llmChecker.installed();
  }

  if (section === 'reasoningRecommendation') {
    return await api.llmChecker.recommend('reasoning');
  }

  if (section === 'codingRecommendation') {
    return await api.llmChecker.recommend('coding');
  }

  return await api.llmChecker.ollamaPlan();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected client error.';
}

function getHealthLabel(healthState: LoadState<HealthResponse>): string {
  if (healthState.status === 'success') {
    return healthState.data?.ollamaAvailable
      ? 'API + Ollama ready'
      : 'API ready, Ollama unavailable';
  }

  if (healthState.status === 'loading') {
    return 'Checking status';
  }

  return healthState.error ?? 'Status unavailable';
}

function getHealthTone(
  healthState: LoadState<HealthResponse>,
): 'error' | 'neutral' | 'success' | 'warning' {
  if (healthState.status === 'success' && healthState.data?.ollamaAvailable) {
    return 'success';
  }

  if (healthState.status === 'error') {
    return 'error';
  }

  return 'warning';
}

function getViewTitle(view: WorkspaceView): string {
  if (view === 'chat') {
    return 'Chat';
  }

  if (view === 'compare') {
    return 'Compare Models';
  }

  return 'LLM Checker';
}

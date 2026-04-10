import type { ConfiguredModelView } from '../../../shared/api.js';
import type { CompareUiState, PlaygroundSettings } from '../types.js';
import { SectionCard } from './section-card.js';
import { StatusPill } from './status-pill.js';

interface ComparePanelProps {
  compareState: CompareUiState;
  models: ConfiguredModelView[];
  onAbort: () => void;
  onRun: () => void;
  onSettingsChange: (patch: Partial<PlaygroundSettings>) => void;
  settings: PlaygroundSettings;
}

export function ComparePanel({
  compareState,
  models,
  onAbort,
  onRun,
  onSettingsChange,
  settings,
}: Readonly<ComparePanelProps>) {
  const isBusy = compareState.status === 'loading';
  const selectedModels = new Set(settings.compareModelIds);
  let statusTone: 'error' | 'neutral' | 'success' | 'warning' = 'neutral';
  let statusLabel = 'Pick 2-4 models';

  switch (compareState.status) {
    case 'error': {
      statusTone = 'error';
      statusLabel = compareState.error ?? 'Compare failed';

      break;
    }

    case 'success': {
      statusTone = 'success';
      statusLabel = `${compareState.results.length} results`;

      break;
    }

    case 'loading': {
      statusTone = 'warning';
      statusLabel = 'Comparing models';

      break;
    }
    // No default
  }

  return (
    <div className="space-y-6">
      <SectionCard
        actions={<StatusPill tone={statusTone}>{statusLabel}</StatusPill>}
        description="Run the current prompt against a small set of local models and compare the outputs."
        title="Selection"
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Prompt preview
            </div>
            <p className="mt-3 whitespace-pre-wrap wrap-break-word text-sm leading-7 text-slate-700">
              {settings.userPrompt ||
                'Write a prompt in the chat workspace first, then compare models here.'}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {models.map((model) => {
              const checked = selectedModels.has(model.id);
              const modelOptionLabel = `${model.label}. ${model.installed ? 'Installed locally' : 'Not installed locally'}.`;

              return (
                <label
                  aria-label={modelOptionLabel}
                  className={`flex items-start gap-3 rounded-2xl border px-4 py-4 text-sm transition ${
                    checked
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                  key={model.id}
                >
                  <input
                    checked={checked}
                    className="mt-1 h-4 w-4 accent-slate-900"
                    onChange={(event) => {
                      const nextIds = event.currentTarget.checked
                        ? [...settings.compareModelIds, model.id]
                        : settings.compareModelIds.filter((value) => value !== model.id);

                      if (nextIds.length > 4) {
                        return;
                      }

                      onSettingsChange({
                        compareModelIds: nextIds,
                      });
                    }}
                    type="checkbox"
                  />
                  <span className="space-y-1">
                    <span
                      className={`block font-medium ${checked ? 'text-white' : 'text-slate-900'}`}
                    >
                      {model.label}
                    </span>
                    <span
                      className={`block text-xs leading-5 ${checked ? 'text-white/70' : 'text-slate-500'}`}
                    >
                      {model.summary}
                    </span>
                    <span
                      className={`block text-xs leading-5 ${checked ? 'text-white/70' : 'text-slate-500'}`}
                    >
                      {model.installed ? 'Installed locally' : 'Not installed locally'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                isBusy || settings.compareModelIds.length < 2 || !settings.userPrompt.trim()
              }
              onClick={onRun}
              type="button"
            >
              Run comparison
            </button>
            <button
              className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!isBusy}
              onClick={onAbort}
              type="button"
            >
              Cancel compare
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        description="Read the output from each selected model side by side."
        title="Outputs"
      >
        <div className="space-y-4">
          {compareState.results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-[#f8fafc] px-5 py-8 text-sm leading-6 text-slate-500">
              Comparison results will appear here once you run at least two models with the same
              prompt.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {compareState.results.map((result) => (
                <article
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                  key={result.modelId}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{result.modelId}</h3>
                    <StatusPill tone={result.status === 'success' ? 'success' : 'error'}>
                      {result.status === 'success' ? `${result.latencyMs} ms` : 'Error'}
                    </StatusPill>
                  </div>
                  <pre className="whitespace-pre-wrap wrap-break-word text-sm leading-7 text-slate-700">
                    {result.status === 'success' ? result.responseText : result.error.message}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

import type { CheckerSectionKey, CheckerSectionState } from '../types.js';
import { SectionCard } from './section-card.js';
import { StatusPill } from './status-pill.js';

interface LlmCheckerPanelProps {
  onLoadAll: () => void;
  onLoadSection: (section: CheckerSectionKey) => void;
  sections: Record<CheckerSectionKey, CheckerSectionState>;
}

const sectionLabels: Record<CheckerSectionKey, string> = {
  check: 'System Check',
  codingRecommendation: 'Coding Recommendation',
  installed: 'Installed Models Ranking',
  ollamaPlan: 'Ollama Plan',
  reasoningRecommendation: 'Reasoning Recommendation',
};

export function LlmCheckerPanel({ onLoadAll, onLoadSection, sections }: LlmCheckerPanelProps) {
  return (
    <SectionCard
      actions={
        <button
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          onClick={onLoadAll}
          type="button"
        >
          Load all
        </button>
      }
      description="Run the allowlisted llm-checker commands and inspect the raw local output."
      title="Commands"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {(Object.entries(sectionLabels) as [CheckerSectionKey, string][]).map(
          ([sectionKey, sectionLabel]) => {
            const section = sections[sectionKey];
            const tone = getSectionTone(section);
            const label = getSectionLabel(section);
            const durationNode = section.data ? (
              <StatusPill>{`${section.data.durationMs} ms`}</StatusPill>
            ) : undefined;
            const output = getSectionOutput(section);

            return (
              <article
                className="rounded-2xl border border-slate-200 bg-white p-5"
                key={sectionKey}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900">{sectionLabel}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={tone}>{label}</StatusPill>
                      {durationNode}
                    </div>
                  </div>
                  <button
                    aria-label={`Refresh ${sectionLabel}`}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    onClick={() => {
                      onLoadSection(sectionKey);
                    }}
                    type="button"
                  >
                    Refresh
                  </button>
                </div>

                <pre className="max-h-96 overflow-auto whitespace-pre-wrap wrap-break-word rounded-[20px] border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-700">
                  {output}
                </pre>
              </article>
            );
          },
        )}
      </div>
    </SectionCard>
  );
}

function getSectionLabel(section: CheckerSectionState): string {
  if (section.status === 'idle') {
    return 'Not loaded';
  }

  if (section.status === 'loading') {
    return 'Loading';
  }

  if (section.status === 'success') {
    return section.data?.cached ? 'Cached' : 'Fresh';
  }

  return section.error ?? 'Failed';
}

function getSectionTone(section: CheckerSectionState): 'error' | 'neutral' | 'success' | 'warning' {
  if (section.status === 'error') {
    return 'error';
  }

  if (section.status === 'success') {
    return 'success';
  }

  if (section.status === 'loading') {
    return 'warning';
  }

  return 'neutral';
}

function getSectionOutput(section: CheckerSectionState): string {
  if (section.status === 'success') {
    return section.data?.stdout ?? 'No output returned.';
  }

  if (section.status === 'error') {
    return section.error ?? 'Failed';
  }

  return 'Run this command to view output.';
}

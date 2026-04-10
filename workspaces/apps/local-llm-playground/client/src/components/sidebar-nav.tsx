import type { WorkspaceView } from '../types.js';

interface SidebarNavProps {
  activeView: WorkspaceView;
  healthLabel: string;
  healthTone: 'error' | 'neutral' | 'success' | 'warning';
  installedCount: number;
  onRefresh: () => void;
  onViewChange: (view: WorkspaceView) => void;
}

const workspaceItems: {
  description: string;
  id: WorkspaceView;
  label: string;
}[] = [
  {
    description: 'Single model chat',
    id: 'chat',
    label: 'Chat',
  },
  {
    description: 'Multi-model compare',
    id: 'compare',
    label: 'Compare Models',
  },
  {
    description: 'Checker output',
    id: 'checker',
    label: 'LLM Checker',
  },
];

function getHealthDotColor(tone: SidebarNavProps['healthTone']): string {
  if (tone === 'success') {
    return 'bg-emerald-500';
  }

  if (tone === 'error') {
    return 'bg-rose-500';
  }

  return 'bg-amber-400';
}

export function SidebarNav({
  activeView,
  healthLabel,
  healthTone,
  installedCount,
  onRefresh,
  onViewChange,
}: Readonly<SidebarNavProps>) {
  return (
    <aside className="border-b border-slate-200 bg-[#f8f8f8] lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col gap-5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
            L
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-900">Local LLM Playground</h1>
            <p className="text-xs text-slate-500">Local-only Ollama lab</p>
          </div>
        </div>

        <section className="hidden border-y border-slate-200 py-4 lg:block">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <span className={`h-2 w-2 rounded-full ${getHealthDotColor(healthTone)}`} />
              <span>{healthLabel}</span>
            </div>
            <p className="text-sm text-slate-500">{`${installedCount} installed`}</p>
            <button
              className="text-sm font-medium text-slate-700 transition hover:text-slate-900"
              onClick={onRefresh}
              type="button"
            >
              Refresh
            </button>
          </div>
        </section>

        <nav className="flex flex-col gap-1.5">
          {workspaceItems.map((item) => {
            const isActive = item.id === activeView;

            return (
              <button
                aria-current={isActive ? 'page' : undefined}
                className={`flex w-full flex-col items-start rounded-xl border px-3 py-3 text-left transition ${
                  isActive
                    ? 'border-slate-200 bg-white text-slate-900'
                    : 'border-transparent bg-transparent text-slate-600 hover:bg-white'
                }`}
                key={item.id}
                onClick={() => {
                  onViewChange(item.id);
                }}
                type="button"
              >
                <span className="text-sm font-semibold text-slate-900">{item.label}</span>
                <span className="mt-1 text-xs leading-5 text-slate-500">{item.description}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

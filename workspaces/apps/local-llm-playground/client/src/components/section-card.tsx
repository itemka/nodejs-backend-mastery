import type { PropsWithChildren, ReactNode } from 'react';

interface SectionCardProps extends PropsWithChildren {
  actions?: ReactNode;
  description?: string;
  title: string;
}

export function SectionCard({ actions, children, description, title }: SectionCardProps) {
  const descriptionNode = description ? (
    <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
  ) : undefined;
  const actionsNode = actions ? (
    <div className="flex items-center gap-2">{actions}</div>
  ) : undefined;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {descriptionNode}
        </div>
        {actionsNode}
      </div>
      {children}
    </section>
  );
}

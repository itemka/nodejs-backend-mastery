interface StatusPillProps {
  children: string;
  tone?: 'error' | 'neutral' | 'success' | 'warning';
}

const toneClassNames: Record<NonNullable<StatusPillProps['tone']>, string> = {
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  neutral: 'border-slate-200 bg-slate-100 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
};

export function StatusPill({ children, tone = 'neutral' }: Readonly<StatusPillProps>) {
  return (
    <span
      className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium ${toneClassNames[tone]}`}
    >
      {children}
    </span>
  );
}

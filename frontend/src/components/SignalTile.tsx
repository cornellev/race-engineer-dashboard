import type { ReactNode } from "react";

export default function SignalTile({
  label,
  value,
  children,
  testId,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  /** data-testid for Playwright: on the value. */
  testId?: string;
}) {
  return (
    <div className="flex min-h-0 flex-col justify-between rounded-[0.95rem] border border-white/8 bg-white/4 px-3 py-2.5 text-left gap-1">
      <div className="text-[11px] uppercase tracking-[0.18em] text-white/42">
        {label}
      </div>
      {children}
      {value ? (
        <div
          className="mt-2 text-lg font-semibold leading-tight text-white xl:text-xl tabular-nums"
          data-testid={testId}
        >
          {value}
        </div>
      ) : null}
    </div>
  );
}

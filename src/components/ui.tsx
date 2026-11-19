// Small styled primitives shared across panels. Utility classes for one-off layout live inline
// in each component; anything repeated is defined once here.
import type { ComponentProps, ReactNode } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
export const note = 'text-xs text-muted';
export const label = 'text-xs font-semibold text-ink-2';
export const mono = 'font-mono tabular-nums';

const control = cx('w-full min-w-0 rounded-md border border-line bg-surface-2 px-2 pt-[7px] pb-[5px] text-sm text-ink', focusRing);

export function Select({ className, ...p }: ComponentProps<'select'>) {
  return <select {...p} className={cx(control, className)} />;
}

export function Input({ className, ...p }: ComponentProps<'input'>) {
  return <input {...p} className={cx(control, className)} />;
}

const buttonVariants = {
  primary: 'rounded-[7px] border border-accent bg-accent px-3.5 pt-[9px] pb-[7px] text-sm font-bold text-accent-ink',
  ghost: 'rounded-[7px] border border-line bg-transparent px-2.5 pt-1.5 pb-1 text-[13px] font-semibold text-ink',
};

export function Button({ variant = 'primary', className, ...p }: ComponentProps<'button'> & { variant?: keyof typeof buttonVariants }) {
  return <button type="button" {...p} className={cx(buttonVariants[variant], 'disabled:opacity-55', focusRing, className)} />;
}

/** Label above a control. */
export function Field({ label: text, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-[5px]">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={label}>
          {text}
        </label>
      ) : (
        <span className={label}>{text}</span>
      )}
      {children}
    </div>
  );
}

/** Segmented control: a row of mutually exclusive buttons. */
export function Seg({ label: aria, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={aria} className="flex overflow-hidden rounded-[7px] border border-line bg-surface-2">
      {children}
    </div>
  );
}

export function SegButton({ pressed, className, ...p }: ComponentProps<'button'> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...p}
      className={cx(
        'flex-1 border-line px-1 pt-[7px] pb-[5px] text-[13px] font-semibold text-ink-2 not-first:border-l aria-pressed:bg-ink aria-pressed:text-surface',
        focusRing,
        className,
      )}
    />
  );
}

export const checkRow = 'flex cursor-pointer items-start gap-[9px] text-[13px] text-ink';
export const checkbox = 'mt-0.5 accent-accent';

/** Checkbox with a label and optional hint line. */
export function Check({ hint, children, className, ...p }: Omit<ComponentProps<'input'>, 'type'> & { hint?: ReactNode }) {
  return (
    <label className={cx(checkRow, className)}>
      <input type="checkbox" {...p} className={checkbox} />
      <span>
        {children}
        {hint && <small className="block text-xs text-muted">{hint}</small>}
      </span>
    </label>
  );
}

const pillTones = { ok: 'text-good', warn: 'text-warn', bad: 'text-bad', mut: 'text-muted' };

export function Pill({ tone, children }: { tone: keyof typeof pillTones; children: ReactNode }) {
  return <span className={cx('rounded-full border border-current px-[7px] pt-0.5 text-[11px] font-bold tracking-[.02em]', pillTones[tone])}>{children}</span>;
}

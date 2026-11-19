import { useId, type ReactNode } from 'react';
import { cx } from './ui.tsx';

interface PanelProps {
  title: string;
  /** Right side of the header: a note or buttons. */
  aside?: ReactNode;
  /** Wrap children in the padded body. Set false for edge-to-edge content. */
  padded?: boolean;
  bodyClassName?: string;
  children: ReactNode;
}

export function Panel({ title, aside, padded = true, bodyClassName, children }: PanelProps) {
  const id = useId();
  return (
    <section className="rounded-[10px] border border-line bg-surface" aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line px-3.5 pt-3 pb-2.5">
        <h2 id={id} className="text-xs font-bold tracking-[.09em] text-ink-2 uppercase">
          {title}
        </h2>
        {aside}
      </div>
      {padded ? <div className={cx('p-3.5', bodyClassName)}>{children}</div> : children}
    </section>
  );
}

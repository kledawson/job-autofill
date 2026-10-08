import {
  cloneElement,
  type ComponentProps,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50',
  };
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

const control =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, props.className)} />;
}

/** Text box with a fixed symbol (like "$") inside its left edge. The symbol is not part of the value. */
export function PrefixInput({ prefix, ...props }: ComponentProps<'input'> & { prefix: string }) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">
        {prefix}
      </span>
      <input {...props} className={cx(control, 'pl-7', props.className)} />
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(control, 'min-h-24', props.className)} />;
}

export const SELECT_ARROW =
  `appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2020%2020'%20fill='none'%20stroke='%23475569'%20stroke-width='2'%3E%3Cpath%20d='m5%208%205%205%205-5'/%3E%3C/svg%3E")] bg-[length:1.25rem] bg-[position:right_0.75rem_center] bg-no-repeat`;

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: (string | [string, string])[] }) {
  return (
    <select {...props} className={cx(control, 'pr-10', SELECT_ARROW, props.className)}>
      {options.map((o) => {
        const [value, label] = Array.isArray(o) ? o : [o, o];
        return (
          <option key={value} value={value}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; required?: boolean }>;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cx('block', className)}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden>
            *
          </span>
        )}
      </label>
      {cloneElement(children, { id, 'aria-describedby': hint ? hintId : undefined })}
      {hint && (
        <span id={hintId} className="mt-1 block text-xs text-slate-500">
          {hint}
        </span>
      )}
    </div>
  );
}

export function Card({ title, description, children, actions }: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  const c = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[cols];
  return <div className={cx('grid grid-cols-1 gap-4', c)}>{children}</div>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const styles = {
    info: 'border-indigo-200 bg-indigo-50 text-indigo-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-green-200 bg-green-50 text-green-800',
  }[tone];
  return <div className={cx('rounded-lg border px-3 py-2 text-sm', styles)}>{children}</div>;
}

export { cx };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number | string) => String(n).padStart(2, '0');

interface DatePartsProps {
  id?: string;
  'aria-describedby'?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Years offered, counted from this year (past, then future). */
  yearsBack?: number;
  yearsAhead?: number;
}

/** Splits "YYYY-MM[-DD]" into dropdown parts; anything else is empty. */
function splitDate(value: string) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  return { y: m?.[1] ?? '', m: m ? String(Number(m[2])) : '', d: m?.[3] ? String(Number(m[3])) : '' };
}

function useDateParts(value: string, withDay: boolean, onChange: (v: string) => void) {
  const [parts, setParts] = useState(() => splitDate(value));
  const compose = (p: { y: string; m: string; d: string }) =>
    p.y && p.m && (!withDay || p.d) ? `${p.y}-${pad(p.m)}${withDay ? `-${pad(p.d)}` : ''}` : '';
  // Pick up changes that did not come from these dropdowns (resume import, reload).
  useEffect(() => {
    setParts((p) => (compose(p) === value ? p : splitDate(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const set = (patch: Partial<typeof parts>) => {
    const next = { ...parts, ...patch };
    // Keep the day valid when the month or year changes (e.g. Jan 31 -> Feb).
    if (withDay && next.d && next.y && next.m) {
      next.d = String(Math.min(Number(next.d), new Date(Number(next.y), Number(next.m), 0).getDate()));
    }
    setParts(next);
    onChange(compose(next));
  };
  return [parts, set] as const;
}

function yearOptions(current: string, back: number, ahead: number): [string, string][] {
  const now = new Date().getFullYear();
  const years = new Set<number>();
  for (let y = now + ahead; y >= now - back; y--) years.add(y);
  if (current) years.add(Number(current));
  return [['', 'Year'], ...[...years].sort((a, b) => b - a).map((y) => [String(y), String(y)] as [string, string])];
}

const monthOptions: [string, string][] = [['', 'Month'], ...MONTHS.map((m, i) => [String(i + 1), m] as [string, string])];

/** Month and year dropdowns. The value stays "YYYY-MM"; it is empty until both are chosen. */
export function MonthInput({ id, value, onChange, disabled, yearsBack = 60, yearsAhead = 10, ...rest }: DatePartsProps) {
  const [parts, set] = useDateParts(value, false, onChange);
  return (
    <div className="flex gap-2">
      <Select id={id} aria-describedby={rest['aria-describedby']} options={monthOptions} value={parts.m} disabled={disabled} onChange={(e) => set({ m: e.target.value })} />
      <Select aria-label="Year" options={yearOptions(parts.y, yearsBack, yearsAhead)} value={parts.y} disabled={disabled} onChange={(e) => set({ y: e.target.value })} />
    </div>
  );
}

/** Month, day and year dropdowns. The day list matches the month. The value stays "YYYY-MM-DD". */
export function DateInput({ id, value, onChange, disabled, yearsBack = 1, yearsAhead = 5, ...rest }: DatePartsProps) {
  const [parts, set] = useDateParts(value, true, onChange);
  const days = parts.m ? new Date(Number(parts.y) || 2024, Number(parts.m), 0).getDate() : 31;
  const dayOptions: [string, string][] = [['', 'Day'], ...Array.from({ length: days }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])];
  return (
    <div className="flex gap-2">
      <Select id={id} aria-describedby={rest['aria-describedby']} options={monthOptions} value={parts.m} disabled={disabled} onChange={(e) => set({ m: e.target.value })} />
      <Select aria-label="Day" options={dayOptions} value={parts.d} disabled={disabled} onChange={(e) => set({ d: e.target.value })} />
      <Select aria-label="Year" options={yearOptions(parts.y, yearsBack, yearsAhead)} value={parts.y} disabled={disabled} onChange={(e) => set({ y: e.target.value })} />
    </div>
  );
}

/** A short-lived confirmation message that fades in and out. Render `toast` once, call `show(message)` to display it. */
export function useToast(ms = 3000) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!message) return;
    const fadeIn = requestAnimationFrame(() => setVisible(true));
    const fadeOut = setTimeout(() => setVisible(false), ms);
    const remove = setTimeout(() => setMessage(''), ms + 400);
    return () => {
      cancelAnimationFrame(fadeIn);
      clearTimeout(fadeOut);
      clearTimeout(remove);
    };
  }, [message, ms]);
  const toast = message ? (
    <div
      role="status"
      className={cx(
        'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      {message}
    </div>
  ) : null;
  const show = (next: string) => {
    setVisible(false);
    setMessage(next);
  };
  return [toast, show] as const;
}

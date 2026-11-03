import { useEffect, useId, useRef } from "react";
import Icon from "./Icon";

export function Pill({ tone = "muted", icon, children }) {
  return (
    <span className={`ad-pill ${tone}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function StatCard({ label, value, icon, delta, deltaTone = "up", foot, accent = false }) {
  return (
    <div className={`ad-stat${accent ? " has-line" : ""}`}>
      <div className="ad-stat-top">
        <span className="ad-eyebrow">{label}</span>
        {icon && (
          <span className="ad-stat-icon">
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>
      <div className="ad-stat-value">{value}</div>
      <div className="ad-stat-foot">
        {delta && <span className={`ad-delta ${deltaTone}`}>{delta}</span>}
        {foot && <span className="ad-stat-note">{foot}</span>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`ad-toggle${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="ad-check" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
}

/** A centred box over a dimmed page. Escape or a click outside closes it (unless `locked`). */
export function Modal({ title, eyebrow, onClose, children, footer, width = 560, locked = false, tone, initialFocusRef }) {
  const box = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    (initialFocusRef?.current || box.current)?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus?.();
    };
  }, [initialFocusRef]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (!locked) onClose();
        return;
      }

      if (e.key !== "Tab" || !box.current) return;
      const focusable = box.current.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const elements = Array.from(focusable).filter(
        (element) => element.getAttribute("aria-hidden") !== "true"
      );

      if (!elements.length) {
        e.preventDefault();
        box.current.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (e.shiftKey && (document.activeElement === first || !box.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !box.current.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, locked]);

  return (
    <div className="ad-overlay" onMouseDown={(e) => e.target === e.currentTarget && !locked && onClose()}>
      <div className={`ad-modal${tone ? ` ${tone}` : ""}`} style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box}>
        <header className="ad-modal-head">
          <div>
            {eyebrow && (
              <div className="ad-modal-eyebrow">
                <i /> {eyebrow}
              </div>
            )}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="ad-icon-btn" onClick={onClose} disabled={locked} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="ad-modal-body">{children}</div>
        {footer && <footer className="ad-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** 1 2 3 ... 12 with previous / next. */
export function Pagination({ page, pageSize, count, noun, onChange }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);

  const shown = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 1) shown.push(n);
    else if (shown[shown.length - 1] !== "...") shown.push("...");
  }
  return (
    <div className="ad-pager">
      <span>
        Showing <b>{from}</b>
        {to > from ? <>–<b>{to}</b></> : null} of {count.toLocaleString("en-IN")} {noun}
      </span>
      <div className="ad-pager-buttons">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
          <Icon name="chevron-left" size={14} />
        </button>
        {shown.map((n, i) =>
          n === "..." ? (
            <span key={`gap${i}`} className="gap">…</span>
          ) : (
            <button type="button" key={n} className={n === page ? "on" : ""} onClick={() => onChange(n)} aria-current={n === page ? "page" : undefined}>
              {n}
            </button>
          )
        )}
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ icon = "package", title, children, action }) {
  return (
    <div className="ad-empty">
      <span className="ad-empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 4 }) {
  return (
    <div className="ad-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  const message = error?.response?.data?.detail || (error?.response ? "Something went wrong." : "Can't reach the server. Check your connection.");
  return (
    <div className="ad-error-note" role="alert">
      <Icon name="alert-triangle" size={16} /> {message}
      {onRetry && (
        <button type="button" className="ad-link" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** A picture, or a coloured square with an icon when there is none. */
export function Thumb({ src, icon = "hanger", size = 44, round = false }) {
  return (
    <span className={`ad-thumb${round ? " round" : ""}`} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" loading="lazy" /> : <Icon name={icon} size={Math.round(size * 0.45)} />}
    </span>
  );
}

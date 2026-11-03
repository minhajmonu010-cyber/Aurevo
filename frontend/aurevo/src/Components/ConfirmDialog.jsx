import { useEffect, useRef } from "react";

/** A small "are you sure?" box. Escape or a click outside it cancels. */
export default function ConfirmDialog({ title, text, children, initialFocusRef, confirmLabel, cancelLabel = "Cancel", danger = false, busy = false, onConfirm, onCancel }) {
  const cancelButton = useRef(null);

  useEffect(() => {
    (initialFocusRef?.current || cancelButton.current)?.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{title}</h2>
        <p>{text}</p>
        {children}
        <div className="dialog-actions">
          <button type="button" ref={cancelButton} className="btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn-solid${danger ? " danger" : ""}`} onClick={onConfirm} disabled={busy}>
            {busy ? "Please wait..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
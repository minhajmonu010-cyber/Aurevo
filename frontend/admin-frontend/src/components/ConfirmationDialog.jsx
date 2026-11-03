import { useRef } from "react";
import Icon from "./Icon";
import { Modal } from "./ui";

export default function ConfirmationDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  error,
  onConfirm,
  onClose,
}) {
  const cancelButtonRef = useRef(null);

  return (
    <Modal
      title={title}
      tone="danger"
      width={460}
      onClose={onClose}
      locked={busy}
      initialFocusRef={cancelButtonRef}
      footer={
        <>
          <button
            ref={cancelButtonRef}
            type="button"
            className="ad-btn ghost"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="ad-btn danger"
            onClick={onConfirm}
            disabled={busy}
          >
            <Icon name="trash" size={15} /> {busy ? "Deleting..." : confirmLabel}
          </button>
        </>
      }
    >
      {error && <div className="ad-alert" role="alert">{error}</div>}
      <p className="ad-modal-text">{message}</p>
    </Modal>
  );
}

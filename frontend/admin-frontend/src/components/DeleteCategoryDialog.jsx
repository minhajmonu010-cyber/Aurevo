import { useState } from "react";
import { deleteCategory } from "../api/admin";
import { formatWhen } from "../utils/format";
import Icon from "./Icon";
import { Modal } from "./ui";

/** "Delete Category?" then "Category Deleted Successfully". The category's products move to the Uncategorized Archive. */
export default function DeleteCategoryDialog({ category, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const count = category.product_count;

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await deleteCategory(category.id));
    } catch (err) {
      setError(err.response?.data?.detail || "The category could not be deleted. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal title="Category Deleted Successfully" width={460} onClose={() => onDeleted(result)}
        footer={<button type="button" className="ad-btn primary" onClick={() => onDeleted(result)}>Back to categories</button>}>
        <div className="ad-success-badge"><Icon name="circle-check" size={26} /></div>
        <p className="ad-modal-text" style={{ textAlign: "center" }}>
          <b>{result.deleted}</b> was removed.{" "}
          {result.reassigned > 0
            ? `${result.reassigned} assigned ${result.reassigned === 1 ? "product was" : "products were"} moved to the ${result.archive}. Nothing was left without a category.`
            : "It had no products."}
        </p>
        <div className="ad-facts">
          <div className="ad-fact"><span className="ad-eyebrow">Time</span><b>{formatWhen(result.deleted_at)}</b></div>
          <div className="ad-fact"><span className="ad-eyebrow">Done by</span><b style={{ wordBreak: "break-all" }}>{result.deleted_by}</b></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Delete Category?" tone="danger" width={480} onClose={onClose} locked={busy}
      footer={
        <>
          <button type="button" className="ad-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ad-btn danger" onClick={confirm} disabled={busy}>
            <Icon name="trash" size={15} /> {busy ? "Deleting…" : "Delete category"}
          </button>
        </>
      }>
      {error && <div className="ad-alert" role="alert"><Icon name="alert-triangle" size={16} /> {error}</div>}
      <p className="ad-modal-text">
        You are about to delete <b>{category.name}</b>.{" "}
        {count > 0
          ? `It contains ${count} ${count === 1 ? "product" : "products"}. To avoid orphan products they will be moved to the Uncategorized Archive, where shoppers cannot see them until you give them a new category.`
          : "It has no products, so nothing else changes."}
      </p>
      <p className="ad-hint" style={{ marginTop: 12 }}>This cannot be undone. Past orders keep their details.</p>
    </Modal>
  );
}

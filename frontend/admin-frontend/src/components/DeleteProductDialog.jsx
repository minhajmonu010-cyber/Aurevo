import { useState } from "react";
import { deleteProduct } from "../api/admin";
import { formatPrice, formatWhen } from "../utils/format";
import Icon from "./Icon";
import { Modal, Thumb } from "./ui";

/** Type DELETE to confirm, then a summary of what was removed. Order history is never touched. */
export default function DeleteProductDialog({ product, onClose, onDeleted }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const variants = product.variant_count ?? product.variants?.length ?? 0;
  const stock = product.total_stock ?? 0;
  const price = product.min_price ?? product.variants?.[0]?.price;

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await deleteProduct(product.id));
    } catch (err) {
      setError(err.response?.data?.detail || "The product could not be deleted. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal title="Product Deleted Successfully" width={480} onClose={() => onDeleted(result)}
        footer={<button type="button" className="ad-btn primary" onClick={() => onDeleted(result)}>Back to products</button>}>
        <div className="ad-success-badge"><Icon name="circle-check" size={26} /></div>
        <p className="ad-modal-text" style={{ textAlign: "center" }}>
          <b>{result.deleted}</b> was removed with its {result.variants_removed} {result.variants_removed === 1 ? "variant" : "variants"}, {result.images_removed} {result.images_removed === 1 ? "picture" : "pictures"} and {result.stock_removed} units of stock records.
        </p>
        <div className="ad-alert ok" style={{ marginTop: 14 }}>
          <Icon name="circle-check" size={16} /> Past orders keep their details, so order history and sales numbers are unchanged.
        </div>
        <p className="ad-hint" style={{ textAlign: "center" }}>{formatWhen(result.deleted_at)} · by {result.deleted_by}</p>
      </Modal>
    );
  }

  return (
    <Modal title="Delete Product?" tone="danger" width={500} onClose={onClose} locked={busy}
      footer={
        <>
          <button type="button" className="ad-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ad-btn danger" onClick={confirm} disabled={busy || typed.trim().toUpperCase() !== "DELETE"}>
            <Icon name="trash" size={15} /> {busy ? "Deleting…" : "Delete product"}
          </button>
        </>
      }>
      {error && <div className="ad-alert" role="alert"><Icon name="alert-triangle" size={16} /> {error}</div>}
      <div className="ad-cell" style={{ marginBottom: 14 }}>
        <Thumb src={product.image || product.images?.[0]?.image} size={52} />
        <div>
          <div className="ad-cell-name">{product.name}</div>
          <div className="ad-cell-sub mono">{product.sku || "No SKU"}</div>
        </div>
      </div>
      <div className="ad-facts" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 0 }}>
        <div className="ad-fact"><span className="ad-eyebrow">Variants</span><b>{variants}</b></div>
        <div className="ad-fact"><span className="ad-eyebrow">Stock</span><b>{stock} units</b></div>
        <div className="ad-fact"><span className="ad-eyebrow">Price</span><b>{formatPrice(price)}</b></div>
      </div>
      <p className="ad-modal-text">This removes the product, its variants, pictures and stock records for good. Order history is kept.</p>
      <div className="ad-field" style={{ marginTop: 16 }}>
        <label className="ad-label" htmlFor="confirm-delete">Type DELETE to confirm</label>
        <input id="confirm-delete" className="ad-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoComplete="off" autoFocus />
      </div>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { listCategories, reorderCategories } from "../api/admin";
import { useToast } from "../context/ToastContext";
import Icon from "./Icon";
import { ErrorNote, Modal, Skeleton, Thumb } from "./ui";

/** "Bulk Reorder": move categories up and down, then save. The first one is shown first in the shop. */
export default function ReorderModal({ onClose, onSaved }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listCategories({ sort: "priority", page_size: 100 }).then((data) => setItems(data.results)).catch(setError);
  }, []);

  const move = (index, step) =>
    setItems((list) => {
      const next = [...list];
      const target = index + step;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await reorderCategories(items.map((c) => c.id));
      toast.show("The new order is saved.", "ok");
      onSaved();
    } catch {
      toast.show("The order could not be saved.", "bad");
      setSaving(false);
    }
  };

  return (
    <Modal eyebrow="Display order" title="Bulk Reorder" width={520} onClose={onClose} locked={saving}
      footer={
        <>
          <button type="button" className="ad-btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="ad-btn primary" onClick={save} disabled={saving || !items?.length}>{saving ? "Saving…" : "Save order"}</button>
        </>
      }>
      <p className="ad-section-sub">The category at the top is shown first in the shop and in menus.</p>
      {error ? <ErrorNote error={error} /> : !items ? <Skeleton rows={4} /> : (
        <ol className="ad-low-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {items.map((c, index) => (
            <li className="ad-low-item" key={c.id}>
              <b style={{ width: 22, color: "var(--ad-muted)" }}>{index + 1}</b>
              <Thumb src={c.image} icon="shapes" size={38} />
              <div className="name"><b>{c.name}</b><small>{c.product_count} items{c.is_active ? "" : " · blocked"}</small></div>
              <button type="button" className="ad-icon-btn" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${c.name} up`}><Icon name="arrow-up" size={15} /></button>
              <button type="button" className="ad-icon-btn" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label={`Move ${c.name} down`}><Icon name="arrow-down" size={15} /></button>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { adjustStock, getInventory } from "../api/admin";
import Icon from "../components/Icon";
import { Modal, Pagination, Pill, StatCard, Thumb } from "../components/ui";
import { mediaUrl } from "../utils/format";

const PAGE_SIZE = 7;

export default function Inventory() {
  const [inventory, setInventory] = useState([]);
  const [summary, setSummary] = useState({});
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [stockItem, setStockItem] = useState(null);
  const [stockType, setStockType] = useState("IN");
  const [stockQuantity, setStockQuantity] = useState("1");
  const [stockNote, setStockNote] = useState("");
  const [stockSaving, setStockSaving] = useState(false);
  const [stockError, setStockError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadInventory() {
      setLoading(true);
      setError("");

      try {
        const data = await getInventory({ search, status, page, page_size: PAGE_SIZE });

        if (active) {
          setInventory(data.results || []);
          setSummary(data.summary || {});
          setCount(data.count || 0);
        }
      } catch {
        if (active) {
          setError("Unable to load inventory. Check your API connection.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadInventory();

    return () => {
      active = false;
    };
  }, [search, status, page, refresh]);

  function openStockUpdate(item) {
    setStockItem(item);
    setStockType("IN");
    setStockQuantity("1");
    setStockNote("");
    setStockError("");
  }

  async function handleStockUpdate(event) {
    event.preventDefault();
    setStockSaving(true);
    setStockError("");

    try {
      await adjustStock(stockItem.id, {
        type: stockType,
        quantity: Number(stockQuantity),
        note: stockNote,
      });
      setStockItem(null);
      setRefresh((value) => value + 1);
    } catch (requestError) {
      const detail = requestError.response?.data?.quantity;
      setStockError(Array.isArray(detail) ? detail[0] : detail || requestError.response?.data?.detail || "Unable to update stock.");
    } finally {
      setStockSaving(false);
    }
  }

  return (
    <>
      <div className="ad-crumbs">
        Catalog / <b>Inventory control</b>
      </div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Inventory</h1>
          <p className="ad-sub">Monitor stock levels across your products.</p>
        </div>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
            <Icon name="refresh" size={15} /> Refresh inventory
          </button>
        </div>
      </div>

      <section className="ad-stats">
        <StatCard label="Variants" value={summary.variant_count ?? 0} icon="shapes" />
        <StatCard label="Stock Units" value={summary.stock_units ?? 0} icon="archive" />
        <StatCard label="Low Stock" value={summary.low_stock ?? 0} icon="trending-up" accent />
        <StatCard label="Out of Stock" value={summary.out_of_stock ?? 0} icon="alert-triangle" />
      </section>

      <section className="ad-toolbar" aria-label="Inventory filters">
        <div className="ad-search">
          <input
            type="search"
            placeholder="Search product or SKU..."
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            aria-label="Search product or SKU"
          />
        </div>

        <label className="ad-select-inline">
          Stock status
          <select className="ad-select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="all">All stock</option>
            <option value="healthy">Healthy</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
        </label>
      </section>

      {loading && <div className="ad-card ad-card-pad ad-muted">Loading inventory...</div>}
      {error && <div className="ad-alert" role="alert">{error}</div>}

      {!loading && !error && (
        <>
        <section className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Product</th>
                <th>SKU</th>
                <th>Size</th>
                <th>Color</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {inventory.map((item) => (
                <tr key={item.id}>
                  <td><Thumb src={mediaUrl(item.image)} size={44} /></td>
                  <td>
                    <div className="ad-cell">
                      <div>
                        <b>{item.product_name}</b>
                        <div className="ad-cell-sub">{item.color || "—"}{item.size ? ` · ${item.size}` : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td>{item.sku || "—"}</td>
                  <td>{item.size || "—"}</td>
                  <td>{item.color || "—"}</td>
                  <td>{item.stock}</td>
                  <td>
                    <Pill tone={item.status === "out" ? "bad" : item.status === "low" ? "warn" : "ok"}>
                      {item.status === "out" ? "Out of stock" : item.status === "low" ? "Low stock" : "Healthy"}
                    </Pill>
                  </td>
                  <td>
                    <button type="button" className="ad-btn sm" onClick={() => openStockUpdate(item)}>
                      <Icon name="plus" size={14} /> Update stock
                    </button>
                  </td>
                </tr>
              ))}

              {inventory.length === 0 && (
                <tr>
                  <td colSpan="8">No inventory items found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        {count > 0 && <Pagination page={page} pageSize={PAGE_SIZE} count={count} noun="variants" onChange={setPage} />}
        </>
      )}

      {stockItem && (
        <Modal
          title="Update stock"
          eyebrow={stockItem.product_name}
          onClose={() => !stockSaving && setStockItem(null)}
          footer={
            <>
              <button type="button" className="ad-btn ghost" onClick={() => setStockItem(null)} disabled={stockSaving}>
                Cancel
              </button>
              <button type="submit" form="inventory-stock-form" className="ad-btn primary" disabled={stockSaving}>
                {stockSaving ? "Saving..." : "Save stock"}
              </button>
            </>
          }
        >
          <form id="inventory-stock-form" className="inventory-stock-form" onSubmit={handleStockUpdate}>
            <p className="ad-hint">
              Current stock: <b>{stockItem.stock}</b>
              {stockItem.size || stockItem.color ? ` · ${[stockItem.size, stockItem.color].filter(Boolean).join(" / ")}` : ""}
            </p>
            <label className="ad-field">
              <span className="ad-label">Adjustment</span>
              <select className="ad-select" value={stockType} onChange={(event) => setStockType(event.target.value)}>
                <option value="IN">Add stock</option>
                <option value="OUT">Remove stock</option>
              </select>
            </label>
            <label className="ad-field">
              <span className="ad-label">Quantity</span>
              <input
                className="ad-input"
                type="number"
                min="1"
                max="100000"
                step="1"
                required
                value={stockQuantity}
                onChange={(event) => setStockQuantity(event.target.value)}
              />
            </label>
            <label className="ad-field">
              <span className="ad-label">Note <span className="ad-muted">(optional)</span></span>
              <input
                className="ad-input"
                maxLength="500"
                value={stockNote}
                onChange={(event) => setStockNote(event.target.value)}
                placeholder="e.g. New shipment"
              />
            </label>
            {stockError && <div className="ad-alert" role="alert">{stockError}</div>}
          </form>
        </Modal>
      )}
    </>
  );
}
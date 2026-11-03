import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listCategories, listProducts, productStats, updateProduct } from "../api/admin";
import DeleteProductDialog from "../components/DeleteProductDialog";
import Icon from "../components/Icon";
import { Checkbox, EmptyState, ErrorNote, Pagination, Pill, Skeleton, StatCard, Thumb } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { downloadCsv, formatNumber, formatPrice } from "../utils/format";
import { useDebounced, useLoad } from "../utils/hooks";

const SORTS = [["newest", "Newest first"], ["oldest", "Oldest first"], ["name", "Name (A-Z)"], ["price_asc", "Price (Low-High)"], ["price_desc", "Price (High-Low)"], ["stock_asc", "Stock (Low-High)"], ["stock_desc", "Stock (High-Low)"]];
const STOCK_PILL = { ok: ["ok", "In stock"], low: ["warn", "Low stock"], out: ["bad", "Sold out"], none: ["muted", "No variants"] };
const PAGE_SIZE = 8;

export default function Products() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const get = (key) => params.get(key) || "";
  const page = Number(params.get("page")) || 1;
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  // the URL holds the filters, so links like /products?stock=low work and a refresh keeps them
  const update = (key, value) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: true });

  const urlSearch = get("search");
  const [box, setBox] = useState(urlSearch);
  useEffect(() => setBox(urlSearch), [urlSearch]); // the top search box changed it
  const typed = useDebounced(box);
  useEffect(() => {
    if (typed !== urlSearch) update("search", typed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const filters = { search: urlSearch, category: get("category"), status: get("status"), stock: get("stock"), sort: get("sort") || "newest" };
  const list = useLoad(() => listProducts({ ...filters, page, page_size: PAGE_SIZE }), [urlSearch, filters.category, filters.status, filters.stock, filters.sort, page, tick]);
  const stats = useLoad(productStats, [tick]);
  const cats = useLoad(() => listCategories({ sort: "name", page_size: 100 }), []);
  const rows = list.data?.results || [];
  const st = stats.data;
  const filtering = Boolean(urlSearch || filters.category || filters.status || filters.stock);

  const setVisibility = async (product, active) => {
    try {
      await updateProduct(product.id, { is_active: active });
      toast.show(active ? `${product.name} is visible again.` : `${product.name} is hidden from shoppers.`, "ok");
      reload();
    } catch {
      toast.show("The product could not be updated.", "bad");
    }
  };

  const bulk = async (active) => {
    try {
      await Promise.all([...selected].map((id) => updateProduct(id, { is_active: active })));
      toast.show(`${selected.size} ${selected.size === 1 ? "product" : "products"} ${active ? "shown" : "hidden"}.`, "ok");
      setSelected(new Set());
      reload();
    } catch {
      toast.show("Some products could not be updated.", "bad");
    }
  };

  const exportCatalog = async () => {
    try {
      const all = [];
      for (let n = 1; n <= 30; n++) {
        const chunk = await listProducts({ ...filters, page: n, page_size: 100 });
        all.push(...chunk.results);
        if (!chunk.next) break;
      }
      downloadCsv("products.csv", [
        ["ID", "Name", "SKU", "Category", "Collection", "Lowest price", "Highest price", "Stock", "Stock status", "Visible"],
        ...all.map((p) => [p.id, p.name, p.sku || "", p.category?.name, p.collection, p.min_price ?? "", p.max_price ?? "", p.total_stock, p.stock_status, p.is_active ? "Yes" : "No"]),
      ]);
    } catch {
      toast.show("Could not export the catalog.", "bad");
    }
  };

  const allSelected = rows.length > 0 && rows.every((p) => selected.has(p.id));

  return (
    <>
      <div className="ad-crumbs">Overview / <b>Catalog control</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Products</h1>
          <p className="ad-sub">Manage your shirts: pictures, prices, stock and what shoppers can see.</p>
        </div>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={exportCatalog}><Icon name="download" size={15} /> Export Catalog</button>
          <Link className="ad-btn primary" to="/products/new"><Icon name="plus" size={15} /> Add Product</Link>
        </div>
      </div>

      <div className="ad-stats">
        <StatCard label="Total Products" icon="hanger" accent value={st ? formatNumber(st.total) : "…"} foot="in your catalog" />
        <StatCard label="Active" icon="circle-check" accent value={st ? formatNumber(st.active) : "…"} delta={st && st.hidden > 0 ? `${st.hidden} hidden` : null} deltaTone="warn" foot="visible to shoppers" />
        <StatCard label="Low Stock" icon="alert-triangle" accent value={st ? <>{st.low_stock} <small>products</small></> : "…"} foot="at or under their alert level" />
        <StatCard label="Average Price" icon="rupee" accent value={st ? formatPrice(st.average_price) : "…"} foot="across active sizes" />
      </div>

      <div className="ad-toolbar">
        <div className="ad-search">
          <Icon name="search" size={16} />
          <input value={box} onChange={(e) => { setBox(e.target.value); setSelected(new Set()); }} placeholder="Search by product name or SKU…" aria-label="Search products" />
        </div>
        <select className="ad-select" style={{ width: "auto" }} value={filters.category} onChange={(e) => update("category", e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(cats.data?.results || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="ad-select" style={{ width: "auto" }} value={filters.status} onChange={(e) => update("status", e.target.value)} aria-label="Visibility">
          <option value="">All visibility</option><option value="active">Active</option><option value="hidden">Hidden</option>
        </select>
        <select className="ad-select" style={{ width: "auto" }} value={filters.stock} onChange={(e) => update("stock", e.target.value)} aria-label="Stock">
          <option value="">All stock</option><option value="low">Low stock</option><option value="out">Sold out</option>
        </select>
        <select className="ad-select" style={{ width: "auto" }} value={filters.sort} onChange={(e) => update("sort", e.target.value)} aria-label="Sort">
          {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {filtering && <button type="button" className="ad-link" onClick={() => { setBox(""); setParams({}, { replace: true }); }}>Clear filters</button>}
      </div>

      {selected.size > 0 && (
        <div className="ad-bulk" role="status">
          {selected.size} selected
          <button type="button" className="ad-btn sm" onClick={() => bulk(false)}><Icon name="eye-off" size={14} /> Hide</button>
          <button type="button" className="ad-btn sm" onClick={() => bulk(true)}><Icon name="eye-open" size={14} /> Show</button>
          <button type="button" className="ad-link" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="ad-table-wrap">
        {list.error && !list.data ? <ErrorNote error={list.error} onRetry={reload} /> : !list.data ? <Skeleton rows={6} /> : list.data.count === 0 ? (
          <EmptyState icon="hanger" title={filtering ? "No products match" : "No products yet"}
            action={!filtering && <Link className="ad-btn primary" to="/products/new"><Icon name="plus" size={15} /> Add your first product</Link>}>
            {filtering ? "Try different filters." : "Add a product and it can appear in the shop."}
          </EmptyState>
        ) : (
          <table className="ad-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}><Checkbox checked={allSelected} indeterminate={!allSelected && selected.size > 0} onChange={(on) => setSelected(on ? new Set(rows.map((p) => p.id)) : new Set())} label="Select all" /></th>
                <th>Product</th><th>Category</th><th>Price</th><th>Total stock</th><th>Visibility</th><th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const [stockTone, stockText] = STOCK_PILL[p.stock_status] || STOCK_PILL.none;
                return (
                  <tr key={p.id} className={selected.has(p.id) ? "selected" : ""}>
                    <td><Checkbox checked={selected.has(p.id)} onChange={(on) => setSelected((s) => { const n = new Set(s); if (on) n.add(p.id); else n.delete(p.id); return n; })} label={`Select ${p.name}`} /></td>
                    <td>
                      <div className="ad-cell">
                        <Thumb src={p.image} size={52} />
                        <div style={{ minWidth: 0 }}>
                          <Link to={`/products/${p.id}/edit`} className="ad-cell-name" style={{ color: "inherit" }}>{p.name}</Link>
                          <div className="ad-cell-sub mono">{p.sku ? `SKU: ${p.sku}` : "No SKU"}{p.collection ? ` · ${p.collection}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td className="ad-muted">{p.category?.name}</td>
                    <td><b>{p.min_price === null ? "-" : p.min_price === p.max_price ? formatPrice(p.min_price) : `${formatPrice(p.min_price)} – ${formatPrice(p.max_price)}`}</b></td>
                    <td><b>{formatNumber(p.total_stock)}</b> <span className="ad-muted">units across variants</span><div style={{ marginTop: 4 }}><Pill tone={stockTone}>{stockText}</Pill></div></td>
                    <td><Pill tone={p.is_active ? "ok" : "muted"}>● {p.is_active ? "Active" : "Hidden"}</Pill></td>
                    <td>
                      <div className="ad-row-actions">
                        <Link className="ad-icon-btn" to={`/products/${p.id}/edit`} title="Edit" aria-label={`Edit ${p.name}`}><Icon name="pencil" size={15} /></Link>
                        <button type="button" className="ad-icon-btn" onClick={() => setVisibility(p, !p.is_active)} title={p.is_active ? "Hide from shoppers" : "Show to shoppers"} aria-label={p.is_active ? `Hide ${p.name}` : `Show ${p.name}`}>
                          <Icon name={p.is_active ? "eye-off" : "eye-open"} size={15} />
                        </button>
                        <button type="button" className="ad-icon-btn danger" onClick={() => setDeleting(p)} title="Delete" aria-label={`Delete ${p.name}`}><Icon name="trash" size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {list.data && list.data.count > 0 && <Pagination page={page} pageSize={PAGE_SIZE} count={list.data.count} noun="products" onChange={(n) => { update("page", n > 1 ? String(n) : ""); setSelected(new Set()); }} />}
      </div>

      {deleting && <DeleteProductDialog product={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); setSelected(new Set()); reload(); }} />}
    </>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { categoryStats, listCategories, updateCategory } from "../api/admin";
import CategoryModal from "../components/CategoryModal";
import { Checkbox, EmptyState, ErrorNote, Pagination, Pill, Skeleton, StatCard, Thumb } from "../components/ui";
import DeleteCategoryDialog from "../components/DeleteCategoryDialog";
import Icon from "../components/Icon";
import ReorderModal from "../components/ReorderModal";
import { useToast } from "../context/ToastContext";
import { downloadCsv, formatDate, formatNumber, formatPriceShort } from "../utils/format";
import { useDebounced, useLoad } from "../utils/hooks";

const SORTS = [
  ["products_desc", "Product Count (High-Low)"],
  ["products_asc", "Product Count (Low-High)"],
  ["name", "Name (A-Z)"],
  ["newest", "Newest first"],
  ["priority", "Display order"],
];

const popularity = (share) => (share >= 30 ? "High Velocity" : share >= 15 ? "Steady Growth" : share >= 5 ? "Standard" : share > 0 ? "Niche Segment" : "Low Traction");

export default function Categories() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("products_desc");
  const [view, setView] = useState("list");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [tick, setTick] = useState(0);
  const query = useDebounced(search);
  const pageSize = view === "grid" ? 12 : 6;
  const reload = () => setTick((t) => t + 1);

  const list = useLoad(() => listCategories({ search: query, status, sort, page, page_size: pageSize }), [query, status, sort, page, pageSize, tick]);
  const stats = useLoad(categoryStats, [tick]);
  const rows = list.data?.results || [];
  const st = stats.data;

  const toggleStatus = async (category) => {
    try {
      await updateCategory(category.id, { is_active: !category.is_active });
      toast.show(category.is_active ? `${category.name} is now blocked.` : `${category.name} is live again.`, "ok");
      reload();
    } catch {
      toast.show("The status could not be changed.", "bad");
    }
  };

  const bulkStatus = async (active) => {
    try {
      await Promise.all([...selected].map((id) => updateCategory(id, { is_active: active })));
      toast.show(`${selected.size} ${selected.size === 1 ? "category" : "categories"} ${active ? "unblocked" : "blocked"}.`, "ok");
      setSelected(new Set());
      reload();
    } catch {
      toast.show("Some categories could not be changed.", "bad");
    }
  };

  const exportData = async () => {
    try {
      const all = await listCategories({ sort: "priority", page_size: 100 });
      downloadCsv("categories.csv", [
        ["ID", "Name", "Slug", "Status", "Products", "Display order", "Featured", "Created"],
        ...all.results.map((c) => [c.id, c.name, c.slug, c.is_active ? "Active" : "Blocked", c.product_count, c.priority, c.is_featured ? "Yes" : "No", c.created_at]),
      ]);
    } catch {
      toast.show("Could not export the categories.", "bad");
    }
  };

  const allSelected = rows.length > 0 && rows.every((c) => selected.has(c.id));
  const toggleAll = (on) => setSelected(on ? new Set(rows.map((c) => c.id)) : new Set());
  const toggleOne = (id, on) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const basis = list.data?.share_basis === "sales" ? "sales" : "products";
  const filtering = Boolean(query || status);

  const actions = (c) => (
    <div className="ad-row-actions">
      <Link className="ad-icon-btn" to={`/products?category=${c.id}`} title="View products" aria-label={`View products in ${c.name}`}><Icon name="eye-open" size={15} /></Link>
      <Link className="ad-icon-btn" to={`/categories/${c.id}/edit`} title="Edit" aria-label={`Edit ${c.name}`}><Icon name="pencil" size={15} /></Link>
      <button type="button" className="ad-icon-btn" onClick={() => toggleStatus(c)} title={c.is_active ? "Block" : "Unblock"} aria-label={c.is_active ? `Block ${c.name}` : `Unblock ${c.name}`}>
        <Icon name={c.is_active ? "ban" : "circle-check"} size={15} />
      </button>
      <button type="button" className="ad-icon-btn danger" onClick={() => setDeleting(c)} title="Delete" aria-label={`Delete ${c.name}`}><Icon name="trash" size={15} /></button>
    </div>
  );

  return (
    <>
      <div className="ad-crumbs">Overview / <b>Catalog control</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Categories</h1>
          <p className="ad-sub">Manage product taxonomy, visibility rules and display order.</p>
        </div>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={() => setReordering(true)}><Icon name="arrow-up-down" size={15} /> Bulk Reorder</button>
          <button type="button" className="ad-btn" onClick={exportData}><Icon name="download" size={15} /> Export Data</button>
          <button type="button" className="ad-btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> Add Category</button>
        </div>
      </div>

      <div className="ad-stats">
        <StatCard label="Total Categories" icon="shapes" accent value={st ? st.total : "…"}
          delta={st && st.new_30d > 0 ? `+${st.new_30d} this month` : null} foot={st && `${st.featured} on the home page`} />
        <StatCard label="Active Taxonomy" icon="circle-check" accent
          value={st ? <>{st.active} <small>/ {st.total} published</small></> : "…"} delta={st && `${st.health}% live`} foot="Visible to shoppers" />
        <StatCard label="Tagged Products" icon="hanger" accent value={st ? formatNumber(st.tagged_products) : "…"}
          delta={st && st.pending_assign > 0 ? `${st.pending_assign} waiting` : null} deltaTone="warn" foot={st && (st.pending_assign > 0 ? "in the Uncategorized Archive" : "all have a category")} />
        <StatCard label="Top Velocity Category" icon="trending-up" accent
          value={st ? (st.top ? st.top.name : "None yet") : "…"}
          delta={st?.top ? `${st.top.share}% of ${st.share_basis}` : null} foot={st && (st.top ? `${formatPriceShort(st.top.revenue_30d)} in 30 days` : "Nothing to compare yet")} />
      </div>

      <div className="ad-toolbar">
        <div className="ad-search">
          <Icon name="search" size={16} />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); setSelected(new Set()); }} placeholder="Search category name, slug or keywords…" aria-label="Search categories" />
        </div>
        <label className="ad-select-inline">Status
          <select className="ad-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option><option value="active">Active</option><option value="blocked">Blocked</option>
          </select>
        </label>
        <label className="ad-select-inline">Sort
          <select className="ad-select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
            {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="ad-seg" role="group" aria-label="View">
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => { setView("list"); setPage(1); }} aria-label="List view"><Icon name="list" size={15} /></button>
          <button type="button" className={view === "grid" ? "on" : ""} onClick={() => { setView("grid"); setPage(1); }} aria-label="Grid view"><Icon name="grid" size={15} /></button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="ad-bulk" role="status">
          {selected.size} selected
          <button type="button" className="ad-btn sm" onClick={() => bulkStatus(false)}><Icon name="ban" size={14} /> Block</button>
          <button type="button" className="ad-btn sm" onClick={() => bulkStatus(true)}><Icon name="circle-check" size={14} /> Unblock</button>
          <button type="button" className="ad-link" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="ad-table-wrap">
        {list.error && !list.data ? <ErrorNote error={list.error} onRetry={reload} /> : !list.data ? <Skeleton rows={6} /> : list.data.count === 0 ? (
          <EmptyState icon="shapes" title={filtering ? "No categories match" : "No categories yet"}
            action={!filtering && <button type="button" className="ad-btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={15} /> Add your first category</button>}>
            {filtering ? "Try a different search or status." : "Categories group your products in the shop."}
          </EmptyState>
        ) : view === "list" ? (
          <table className="ad-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}><Checkbox checked={allSelected} indeterminate={!allSelected && selected.size > 0} onChange={toggleAll} label="Select all" /></th>
                <th>Category</th><th>Products</th><th>Status</th><th>Created</th><th>Popularity / {basis === "sales" ? "sales" : "product"} share</th><th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={selected.has(c.id) ? "selected" : ""}>
                  <td><Checkbox checked={selected.has(c.id)} onChange={(on) => toggleOne(c.id, on)} label={`Select ${c.name}`} /></td>
                  <td>
                    <div className="ad-cell">
                      <Thumb src={c.image} icon="shapes" size={48} />
                      <div>
                        <div className="ad-cell-name" style={c.is_active ? undefined : { opacity: 0.6 }}>{c.name} {!c.is_active && <Icon name="eye-off" size={13} />}</div>
                        <div className="ad-cell-sub">/cat/{c.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td><b>{formatNumber(c.product_count)}</b> <span className="ad-muted">Items</span></td>
                  <td><Pill tone={c.is_active ? "ok" : "warn"}>● {c.is_active ? "Active" : "Blocked"}</Pill></td>
                  <td className="ad-muted">{formatDate(c.created_at)}</td>
                  <td>
                    <div className="ad-bar">
                      <div className="ad-bar-top">{c.share}% <span>{popularity(c.share)}</span></div>
                      <div className="ad-bar-track"><i style={{ width: `${Math.min(100, c.share)}%` }} /></div>
                    </div>
                  </td>
                  <td>{actions(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ad-cards">
            {rows.map((c) => (
              <div className="ad-cat-card" key={c.id}>
                <div className="pic">{c.image ? <img src={c.image} alt="" loading="lazy" /> : null}</div>
                <div className="body">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div className="ad-cell-name">{c.name}</div>
                    <Pill tone={c.is_active ? "ok" : "warn"}>{c.is_active ? "Active" : "Blocked"}</Pill>
                  </div>
                  <div className="ad-cell-sub">/cat/{c.slug} · {c.product_count} items · {c.share}% share</div>
                  <div style={{ marginTop: 10 }}>{actions(c)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {list.data && list.data.count > 0 && <Pagination page={page} pageSize={pageSize} count={list.data.count} noun="categories" onChange={(p) => { setPage(p); setSelected(new Set()); }} />}
      </div>
      {list.data && list.data.count > 0 && (
        <p className="ad-hint" style={{ marginTop: 12 }}>
          {basis === "sales" ? "Share = the part of paid sales that came from this category." : "No sales yet, so share = the part of your products that sit in this category."}
        </p>
      )}

      {creating && <CategoryModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setPage(1); reload(); }} />}
      {reordering && <ReorderModal onClose={() => setReordering(false)} onSaved={() => { setReordering(false); reload(); }} />}
      {deleting && <DeleteCategoryDialog category={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); setSelected(new Set()); reload(); }} />}
    </>
  );
}

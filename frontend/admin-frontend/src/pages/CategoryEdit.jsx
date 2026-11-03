import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getCategory, listCategories, listProducts, toFormData, updateCategory } from "../api/admin";
import DeleteCategoryDialog from "../components/DeleteCategoryDialog";
import DropZone from "../components/DropZone";
import Icon from "../components/Icon";
import { EmptyState, ErrorNote, Pill, Skeleton, Thumb, Toggle } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { formatDate, formatPrice, slugify, timeAgo } from "../utils/format";
import { useLoad, useObjectUrl } from "../utils/hooks";
import { parseApiError } from "../utils/errors";

const FIELDS = ["name", "slug", "description", "parent", "priority", "is_active", "is_featured", "in_search_suggest"];
const fromCategory = (c) => ({
  name: c.name, slug: c.slug, description: c.description || "", parent: c.parent ? String(c.parent) : "", priority: c.priority,
  is_active: c.is_active, is_featured: c.is_featured, in_search_suggest: c.in_search_suggest,
});

export default function CategoryEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const loaded = useLoad(() => getCategory(id), [id, tick]);
  const others = useLoad(() => listCategories({ sort: "name", page_size: 100 }), [tick]);
  const items = useLoad(() => listProducts({ category: id, page_size: 3 }), [id, tick]);
  const category = loaded.data;

  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const preview = useObjectUrl(file);

  // Hydrate the editable form after the category request resolves.
  // oxlint-disable react/set-state-in-effect
  useEffect(() => {
    if (category) {
      // The local edit form is initialized when its async source record arrives.
      // oxlint-disable-next-line react/set-state-in-effect
      setForm(fromCategory(category));
      setFile(null);
      setRemoveImage(false);
    }
  }, [category]);
  // oxlint-enable react/set-state-in-effect

  const dirty = useMemo(
    () => Boolean(form && category && (FIELDS.some((k) => String(form[k]) !== String(fromCategory(category)[k])) || file || removeImage)),
    [form, category, file, removeImage]
  );
  useEffect(() => {
    const warn = (e) => dirty && e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (loaded.error) {
    return loaded.error.response?.status === 404 ? (
      <EmptyState icon="shapes" title="Category not found" action={<Link className="ad-btn primary" to="/categories">Back to categories</Link>}>It may have been deleted.</EmptyState>
    ) : (
      <ErrorNote error={loaded.error} onRetry={() => setTick((t) => t + 1)} />
    );
  }
  if (!category || !form) return <Skeleton rows={6} />;
  if (category.is_system) {
    return <EmptyState icon="archive" title={category.name} action={<Link className="ad-btn primary" to="/categories">Back to categories</Link>}>This is the built-in archive for products whose category was deleted. It cannot be edited. Give those products a new category from their own page.</EmptyState>;
  }

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const shownImage = removeImage ? null : preview || category.image;
  const parents = (others.data?.results || []).filter((c) => c.id !== category.id);
  const products = items.data?.results || [];

  const checks = [
    ["Name", form.name.trim().length >= 2 && form.name.length <= 100, "2 to 100 characters"],
    ["Slug format", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.slug), "lowercase letters, numbers, dashes"],
    ["Display order", /^\d+$/.test(String(form.priority)) && Number(form.priority) <= 9998, "a whole number"],
    ["Cover picture", Boolean(shownImage), "shown in the shop"],
    ["Uniqueness", true, "checked when you save"],
  ];
  const passing = checks.filter((c) => c[1]).length;

  const save = async (e) => {
    e?.preventDefault();
    const next = {};
    if (form.name.trim().length < 2) next.name = "Enter the category name.";
    if (!/^\d+$/.test(String(form.priority)) || Number(form.priority) > 9998) next.priority = "Use a whole number from 0 to 9998.";
    if (!form.slug) next.slug = "The slug cannot be empty.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      await updateCategory(
        category.id,
        toFormData({
          name: form.name.trim(), slug: form.slug, description: form.description, parent: form.parent || null, priority: Number(form.priority),
          is_active: form.is_active, is_featured: form.is_featured, in_search_suggest: form.in_search_suggest,
          image: file || undefined, remove_image: removeImage && !file ? true : undefined,
        })
      );
      toast.show("Changes saved.", "ok");
      setTick((t) => t + 1);
    } catch (err) {
      const parsed = parseApiError(err);
      setErrors({ ...parsed.fields, form: parsed.form });
    } finally {
      setSaving(false);
    }
  };

  const field = (key, label, input, extra, wide = "") => (
    <div className={`ad-field${wide}${errors[key] ? " invalid" : ""}`}>
      <label className="ad-label" htmlFor={`f-${key}`}>{label}</label>
      {input}
      {extra}
      {errors[key] && <p className="ad-field-error">{errors[key]}</p>}
    </div>
  );

  return (
    <form onSubmit={save} noValidate>
      <div className="ad-crumbs"><Link to="/categories">Taxonomy / Categories</Link> / <b>Edit category</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Edit Category <span className="ad-id-tag">#CAT-{String(category.id).padStart(2, "0")}</span></h1>
          <p className="ad-sub"><Pill tone="muted">{category.parent ? `Sub-category of ${category.parent_name}` : "Root taxonomy node"}</Pill></p>
        </div>
        <div className="ad-actions">
          <Link className="ad-btn" to="/categories"><Icon name="arrow-left" size={15} /> Back to Categories</Link>
        </div>
      </div>
      {errors.form && <div className="ad-alert" role="alert"><Icon name="alert-triangle" size={16} /> {errors.form}</div>}

      <div className="ad-editor">
        <div className="ad-stack">
          <section className="ad-card ad-card-pad">
            <div className="ad-section-title"><Icon name="shapes" size={18} /> Category Identity</div>
            <p className="ad-section-sub">Manage the name, address and description shoppers and search engines see.</p>
            <div className="ad-form-grid">
              {field("name", "Category name *", <input id="f-name" className="ad-input" value={form.name} maxLength={100} onChange={(e) => set("name", e.target.value)} />, <div className="ad-counter">{form.name.length} / 100</div>)}
              {field("parent", "Parent category",
                <select id="f-parent" className="ad-select" value={form.parent} onChange={(e) => set("parent", e.target.value)}>
                  <option value="">No parent category (root level)</option>
                  {parents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>,
                <p className="ad-hint">Choose a parent to make this a sub-category.</p>)}
              <div className={`ad-field full${errors.slug ? " invalid" : ""}`}>
                <label className="ad-label" htmlFor="f-slug">URL canonical slug</label>
                <div className="ad-input-group">
                  <span className="prefix">/cat/</span>
                  <input id="f-slug" value={form.slug} onChange={(e) => set("slug", slugify(e.target.value))} />
                  <button type="button" className="tail ad-link" onClick={() => set("slug", slugify(form.name))}><Icon name="refresh" size={13} />&nbsp;Sync from name</button>
                </div>
                {errors.slug && <p className="ad-field-error">{errors.slug}</p>}
              </div>
              {field("description", "Editorial description & SEO copy",
                <textarea id="f-description" className="ad-textarea" value={form.description} onChange={(e) => set("description", e.target.value)} />,
                <div className="ad-counter">{form.description.length} / 260 recommended</div>, " full")}
            </div>
          </section>

          <section className="ad-card ad-card-pad">
            <div className="ad-section-title"><Icon name="image-plus" size={18} /> Visual Asset &amp; Collection Cover</div>
            <p className="ad-section-sub">High-resolution picture for the category banner. JPG, PNG or WebP up to 5 MB.</p>
            {shownImage ? (
              <div className="ad-cover">
                <img src={shownImage} alt="Category cover" />
              </div>
            ) : (
              <p className="ad-hint" style={{ marginBottom: 12 }}>No cover picture yet.</p>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
              <div style={{ flex: "1 1 280px" }}>
                <DropZone compact title="Drop a new cover, or" onFiles={([f]) => { setFile(f); setRemoveImage(false); setErrors((x) => ({ ...x, image: "" })); }} onError={(m) => setErrors((x) => ({ ...x, image: m }))} />
              </div>
              {(category.image || file) && !removeImage && (
                <button type="button" className="ad-btn outline-danger" onClick={() => { setFile(null); setRemoveImage(true); }}><Icon name="trash" size={15} /> Remove</button>
              )}
            </div>
            {errors.image && <p className="ad-field-error" style={{ marginTop: 8 }}>{errors.image}</p>}
          </section>

          <section className="ad-card ad-card-pad">
            <div className="ad-section-title"><Icon name="sliders" size={18} /> Publishing, Hierarchy &amp; Sort Order</div>
            <p className="ad-section-sub">Manage visibility and where this category appears.</p>
            <div className="ad-form-grid">
              <div className="ad-switch-row">
                <div><b>Active on storefront</b><small>{form.is_active ? "Visible and searchable by shoppers" : "Blocked: hidden, along with its products"}</small></div>
                <Toggle checked={form.is_active} onChange={(v) => set("is_active", v)} label="Active on storefront" />
              </div>
              <div className={`ad-field${errors.priority ? " invalid" : ""}`}>
                <label className="ad-label" htmlFor="f-priority">Display priority order</label>
                <div className="ad-stepper">
                  <button type="button" onClick={() => set("priority", Math.max(0, Number(form.priority || 0) - 1))} aria-label="Lower the number"><Icon name="minus" size={14} /></button>
                  <input id="f-priority" inputMode="numeric" value={form.priority} onChange={(e) => set("priority", e.target.value.replace(/\D/g, ""))} />
                  <button type="button" onClick={() => set("priority", Math.min(9998, Number(form.priority || 0) + 1))} aria-label="Raise the number"><Icon name="plus" size={14} /></button>
                </div>
                <p className="ad-hint">A lower number is shown closer to the top.</p>
                {errors.priority && <p className="ad-field-error">{errors.priority}</p>}
              </div>
              <label className="ad-check-row"><input type="checkbox" className="ad-check" checked={form.is_featured} onChange={(e) => set("is_featured", e.target.checked)} /> Feature on homepage</label>
              <label className="ad-check-row"><input type="checkbox" className="ad-check" checked={form.in_search_suggest} onChange={(e) => set("in_search_suggest", e.target.checked)} /> Include in search suggestions</label>
              <p className="ad-hint full">Members-only early access is not available yet. This saved setting does not restrict storefront visibility.</p>
            </div>
          </section>

          <section className="ad-card ad-card-pad">
            <div className="ad-section-title"><Icon name="circle-check" size={18} /> Taxonomy integrity checks <Pill tone={passing === checks.length ? "ok" : "warn"}>{passing}/{checks.length} passing</Pill></div>
            <ul className="ad-checks" style={{ marginTop: 14 }}>
              {checks.map(([label, ok, note]) => (
                <li key={label} className={ok ? "pass" : "warn"}><Icon name={ok ? "circle-check" : "alert-triangle"} size={15} /><span><b>{label}:</b> {note}</span></li>
              ))}
            </ul>
          </section>
        </div>

        <div className="ad-stack">
          <section className="ad-card ad-card-pad">
            <div className="ad-card-head"><h3>Storefront Preview</h3><span className="ad-eyebrow">Live mirror</span></div>
            <div className="ad-preview-card">
              <div className="pic">
                {shownImage && <img src={shownImage} alt="" />}
                <Pill tone={form.is_active ? "ok" : "warn"}>● {form.is_active ? "Active" : "Blocked"}</Pill>
              </div>
              <div className="body">
                <div className="ad-cell-name">{form.name || "Category name"}</div>
                <p className="ad-hint" style={{ margin: "6px 0 10px" }}>{form.description || "The description appears here."}</p>
                <div className="ad-cell-sub mono">/cat/{form.slug || "slug"} · Pos #{form.priority || 0}</div>
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="ad-card-head" style={{ marginBottom: 8 }}><span className="ad-eyebrow">Assigned items</span><Pill tone="purple">{category.product_count} products</Pill></div>
              {products.length === 0 ? <p className="ad-hint">No products in this category yet.</p> : products.map((p) => (
                <div className="ad-low-item" key={p.id} style={{ marginBottom: 8 }}>
                  <Thumb src={p.image} size={38} />
                  <div className="name"><b>{p.name}</b><small>{p.sku || "No SKU"} · {formatPrice(p.min_price)}</small></div>
                </div>
              ))}
              <Link className="ad-btn" style={{ width: "100%", marginTop: 6 }} to={`/products?category=${category.id}`}>Manage product assignments ({category.product_count})</Link>
            </div>
          </section>

          <section className="ad-card ad-card-pad">
            <div className="ad-card-head"><h3>Performance</h3></div>
            <div className="ad-form-grid">
              <div className="ad-fact"><span className="ad-eyebrow">Share of {others.data?.share_basis === "sales" ? "sales" : "products"}</span><b>{category.share}%</b></div>
              <div className="ad-fact"><span className="ad-eyebrow">Products</span><b>{category.product_count}</b></div>
            </div>
          </section>

          <section className="ad-card ad-card-pad">
            <div className="ad-card-head"><h3>Audit trail</h3></div>
            <p className="ad-hint" style={{ marginBottom: 6 }}>Last changed {timeAgo(category.updated_at)} ({formatDate(category.updated_at)})</p>
            <p className="ad-hint">Created {formatDate(category.created_at)}</p>
            <button type="button" className="ad-btn outline-danger" style={{ width: "100%", marginTop: 16 }} onClick={() => setDeleting(true)}><Icon name="trash" size={15} /> Delete category</button>
          </section>
        </div>
      </div>

      <div className="ad-sticky-bar" role="region" aria-label="Save">
        <span className="ad-muted">{dirty ? "You have unsaved changes." : "All changes are saved."}</span>
        <div className="ad-actions">
          <button type="button" className="ad-btn ghost" disabled={!dirty || saving} onClick={() => { setForm(fromCategory(category)); setFile(null); setRemoveImage(false); setErrors({}); }}>Discard</button>
          <button type="submit" className="ad-btn primary" disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>

      {deleting && <DeleteCategoryDialog category={category} onClose={() => setDeleting(false)} onDeleted={() => navigate("/categories", { replace: true })} />}
    </form>
  );
}

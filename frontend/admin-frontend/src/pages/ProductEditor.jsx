import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { addVariant, adjustStock, createProduct, deleteImage, deleteVariant, getProduct, listBrands, listCategories, updateImage, updateProduct, updateVariant, uploadImage } from "../api/admin";
import DeleteProductDialog from "../components/DeleteProductDialog";
import DropZone from "../components/DropZone";
import Icon from "../components/Icon";
import { EmptyState, ErrorNote, Modal, Pill, Skeleton, Toggle } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { API_URL } from "../api/axios";
import { formatDate, formatPrice, slugify, timeAgo } from "../utils/format";
import { useLoad, useObjectUrl } from "../utils/hooks";
import { parseApiError } from "../utils/errors";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const COLORS = [
  ["Black", "#111418"], ["White", "#f4f4f4"], ["Off-White", "#e8e3d3"], ["Navy", "#1f2c5c"], ["Olive", "#5b6b3a"],
  ["Beige", "#cdbf9f"], ["Grey", "#8a8f98"], ["Red", "#c0392b"], ["Sky Blue", "#7fb2e5"], ["Maroon", "#6b1f2b"],
];
const swatch = (name) => (COLORS.find(([n]) => n.toLowerCase() === name.toLowerCase()) || [null, "#6b7190"])[1];
const STORE = import.meta.env.VITE_STORE_URL || new URL(API_URL).origin.replace(":8000", ":5173");

const EMPTY = { name: "", sku: "", category: "", brand: "", collection: "", slug: "", description: "", cost_price: "", low_stock_threshold: "10", meta_title: "", meta_description: "", is_active: true, is_featured: false };
const fromProduct = (p) => ({
  name: p.name, sku: p.sku || "", category: String(p.category), brand: p.brand ? String(p.brand) : "", collection: p.collection || "", slug: p.slug,
  description: p.description || "", cost_price: p.cost_price ?? "", low_stock_threshold: String(p.low_stock_threshold), meta_title: p.meta_title || "",
  meta_description: p.meta_description || "", is_active: p.is_active, is_featured: p.is_featured,
});

const money = (v) => v !== "" && Number.isFinite(Number(v)) && Number(v) > 0;

/** A picture waiting to be uploaded (Add Product): shows a preview. */
function Queued({ file, primary, onRemove, onPrimary }) {
  const url = useObjectUrl(file);
  return (
    <div className="ad-shot">
      {url && <img src={url} alt="" />}
      {primary && <span className="tag">Main</span>}
      <div className="tools">
        {!primary && <button type="button" onClick={onPrimary} title="Make main picture" aria-label="Make main picture"><Icon name="star" size={13} /></button>}
        <button type="button" onClick={onRemove} title="Remove" aria-label="Remove picture"><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
}

export default function ProductEditor() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);

  const loaded = useLoad(() => (editing ? getProduct(id) : Promise.resolve(null)), [id, tick]);
  const cats = useLoad(() => listCategories({ sort: "name", page_size: 100 }), []);
  const brands = useLoad(listBrands, []);
  const product = loaded.data;

  const [form, setForm] = useState(EMPTY);
  const [baseline, setBaseline] = useState(JSON.stringify(EMPTY));
  const [sizes, setSizes] = useState([]);
  const [colors, setColors] = useState([]);
  const [basePrice, setBasePrice] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [variantStocks, setVariantStocks] = useState({});
  const [queued, setQueued] = useState([]);
  const [customSize, setCustomSize] = useState("");
  const [customColor, setCustomColor] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stockFor, setStockFor] = useState(null);
  const [variantDelete, setVariantDelete] = useState(null);
  const [edits, setEdits] = useState({});
  const [newVariant, setNewVariant] = useState({ size: "", color: "", price: "", original_price: "", stock: "0" });

  // fill the form once per product (later reloads after a stock change must not wipe what is being typed)
  useEffect(() => {
    if (product) {
      const next = fromProduct(product);
      setForm(next);
      setBaseline(JSON.stringify(next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  const dirty = editing
    ? JSON.stringify(form) !== baseline
    : JSON.stringify({ form, sizes, colors, basePrice, offerPrice, variantStocks }) !==
        JSON.stringify({
          form: EMPTY,
          sizes: [],
          colors: [],
          basePrice: "",
          offerPrice: "",
          variantStocks: {},
        }) || queued.length > 0;
  useEffect(() => {
    const warn = (e) => dirty && !saving && e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = (list, setList, value) => setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const variantCount = sizes.length * colors.length;
  const variantStockKey = (size, color) => `${size}\u0000${color}`;
  const stockForVariant = (size, color) => variantStocks[variantStockKey(size, color)] ?? "0";
  const openingStockTotal = sizes.reduce(
    (total, size) =>
      total +
      colors.reduce((colorTotal, color) => {
        const stock = stockForVariant(size, color);
        return colorTotal + (/^\d+$/.test(stock) ? Number(stock) : 0);
      }, 0),
    0
  );
  const setVariantStock = (size, color, value) =>
    setVariantStocks((current) => ({
      ...current,
      [variantStockKey(size, color)]: value,
    }));

  if (editing && loaded.error) {
    return loaded.error.response?.status === 404 ? (
      <EmptyState icon="hanger" title="Product not found" action={<Link className="ad-btn primary" to="/products">Back to products</Link>}>It may have been deleted.</EmptyState>
    ) : <ErrorNote error={loaded.error} onRetry={refresh} />;
  }
  if (editing && !product) return <Skeleton rows={6} />;

  const fieldError = (key) => errors[key] && <p className="ad-field-error">{errors[key]}</p>;
  const wrap = (key, label, control, hint, wide = "") => (
    <div className={`ad-field${wide}${errors[key] ? " invalid" : ""}`}>
      <label className="ad-label" htmlFor={`p-${key}`}>{label}</label>
      {control}
      {hint && !errors[key] && <p className="ad-hint">{hint}</p>}
      {fieldError(key)}
    </div>
  );

  const body = () => ({
    name: form.name.trim(), sku: form.sku.trim(), category: Number(form.category), brand: form.brand ? Number(form.brand) : null,
    collection: form.collection.trim(), description: form.description, cost_price: form.cost_price === "" ? null : form.cost_price,
    low_stock_threshold: Number(form.low_stock_threshold), meta_title: form.meta_title, meta_description: form.meta_description,
    is_active: form.is_active, is_featured: form.is_featured,
  });

  const validate = () => {
    const next = {};
    if (form.name.trim().length < 2) next.name = "Enter the product name.";
    if (!form.sku.trim()) next.sku = "Enter a SKU or barcode.";
    if (!form.category) next.category = "Choose a category.";
    if (!/^\d+$/.test(form.low_stock_threshold)) next.low_stock_threshold = "Use a whole number.";
    if (form.cost_price !== "" && !(Number(form.cost_price) >= 0)) next.cost_price = "Enter a valid cost.";
    if (!editing) {
      if (!money(basePrice)) next.basePrice = "Enter the price.";
      if (offerPrice !== "" && !(money(offerPrice) && Number(offerPrice) < Number(basePrice))) next.offerPrice = "The offer price must be lower than the base price.";
      if (sizes.length === 0) next.sizes = "Choose at least one size.";
      if (colors.length === 0) next.colors = "Choose at least one colour.";
      if (sizes.some((size) => colors.some((color) => !/^\d+$/.test(stockForVariant(size, color))))) {
        next.variantStock = "Enter a whole-number stock quantity for every size and colour variant.";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) {
      toast.show("Please fix the highlighted fields.", "bad");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await updateProduct(product.id, { ...body(), slug: form.slug || undefined });
        setBaseline(JSON.stringify(fromProduct(updated)));
        toast.show("Product saved.", "ok");
        refresh();
      } else {
        const selling = Number(offerPrice || basePrice);
        const created = await createProduct({
          ...body(),
          new_variants: sizes.flatMap((size) =>
            colors.map((color) => ({
              size,
              color,
              price: selling.toFixed(2),
              original_price: offerPrice ? Number(basePrice).toFixed(2) : null,
              stock: Number(stockForVariant(size, color)),
            }))
          ),
        });
        let failed = 0;
        for (let i = 0; i < queued.length; i++) {
          try {
            await uploadImage(created.id, queued[i], i === 0);
          } catch {
            failed += 1;
          }
        }
        toast.show(failed ? `Product published, but ${failed} picture(s) did not upload. Add them here.` : "Product published.", failed ? "bad" : "ok");
        navigate(`/products/${created.id}/edit`, { replace: true });
      }
      setErrors({});
    } catch (err) {
      const parsed = parseApiError(err);
      const nested = err.response?.data?.new_variants;
      setErrors({ ...parsed.fields, form: parsed.form || (nested ? String(Array.isArray(nested) ? nested.flat(2).join(" ") : nested) : "") });
      toast.show("The product was not saved.", "bad");
    } finally {
      setSaving(false);
    }
  };

  // ---- edit mode: pictures
  const addPictures = async (files) => {
    try {
      for (const file of files) await uploadImage(product.id, file, product.images.length === 0);
      toast.show("Picture added.", "ok");
      refresh();
    } catch (err) {
      toast.show(err.response?.data?.image?.[0] || "A picture could not be uploaded.", "bad");
    }
  };
  const makeMain = async (image) => { await updateImage(image.id, { is_primary: true }); refresh(); };
  const removePicture = async (image) => { await deleteImage(image.id); toast.show("Picture removed.", "ok"); refresh(); };

  // ---- edit mode: variants
  const rowValue = (v, key) => (edits[v.id]?.[key] !== undefined ? edits[v.id][key] : v[key] ?? "");
  const setRow = (v, key, value) => setEdits((e) => ({ ...e, [v.id]: { ...e[v.id], [key]: value } }));
  const saveRow = async (v) => {
    const row = edits[v.id] || {};
    try {
      await updateVariant(v.id, {
        ...(row.color !== undefined ? { color: row.color.trim() } : {}),
        ...(row.price !== undefined ? { price: row.price } : {}),
        ...(row.original_price !== undefined ? { original_price: row.original_price === "" ? null : row.original_price } : {}),
        ...(row.is_active !== undefined ? { is_active: row.is_active } : {}),
      });
      setEdits((e) => { const n = { ...e }; delete n[v.id]; return n; });
      toast.show("Variant saved.", "ok");
      refresh();
    } catch (err) {
      const p = parseApiError(err);
      toast.show(Object.values(p.fields)[0] || p.form || "The variant was not saved.", "bad");
    }
  };
  const addNewVariant = async (e) => {
    e.preventDefault();
    const nv = newVariant;
    if (!nv.size.trim() || !nv.color.trim() || !money(nv.price)) {
      toast.show("Enter a size, a colour and a price.", "bad");
      return;
    }
    try {
      await addVariant(product.id, {
        size: nv.size.trim(), color: nv.color.trim(), price: nv.price, original_price: nv.original_price || null, stock: Number(nv.stock) || 0,
        sku: `${product.sku || product.slug}-${nv.size}-${nv.color}`.toUpperCase().replace(/[^A-Z0-9]+/g, "-"),
      });
      setNewVariant({ size: "", color: "", price: "", original_price: "", stock: "0" });
      toast.show("Variant added.", "ok");
      refresh();
    } catch (err) {
      const p = parseApiError(err);
      toast.show(Object.values(p.fields)[0] || p.form || "The variant was not added.", "bad");
    }
  };

  const total = product ? product.total_stock : 0;
  const prices = product ? product.variants.map((v) => Number(v.price)) : [];
  const serpTitle = form.meta_title || form.name || "Product title";
  const serpText = form.meta_description || form.description.slice(0, 160) || "The description shoppers see in search results.";

  return (
    <>
    <form onSubmit={submit} noValidate>
      <div className="ad-crumbs"><Link to="/products">Catalog / Products</Link> / <b>{editing ? "Edit product" : "Add product"}</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">{editing ? "Edit Product" : "Add New Product"}{editing && <span className="ad-id-tag">#PRD-{String(product.id).padStart(4, "0")}</span>}</h1>
          <p className="ad-sub">{editing ? "Update details, pricing, stock and pictures." : "Fill in the details, choose sizes and colours, and publish."}</p>
        </div>
        <div className="ad-actions"><Link className="ad-btn" to="/products"><Icon name="arrow-left" size={15} /> Back to Products</Link></div>
      </div>
      {errors.form && <div className="ad-alert" role="alert"><Icon name="alert-triangle" size={16} /> {errors.form}</div>}

      <div className="ad-editor">
        <div className="ad-stack">
          <section className="ad-card ad-card-pad">
            <div className="ad-section-title"><Icon name="hanger" size={18} /> Product details</div>
            <p className="ad-section-sub">What the product is called and where it belongs.</p>
            <div className="ad-form-grid">
              {wrap("name", "Product name *", <input id="p-name" className="ad-input" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={160} placeholder="Heavyweight Boxy Tee" />, null, " full")}
              {wrap("sku", "SKU / barcode *", <input id="p-sku" className="ad-input" value={form.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} maxLength={60} placeholder="OFT-TEE-043" />, "Size and colour codes are added to it automatically.")}
              {wrap("category", "Category *",
                <select id="p-category" className="ad-select" value={form.category} onChange={(e) => set("category", e.target.value)}>
                  <option value="">Choose a category</option>
                  {(cats.data?.results || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? "" : " (blocked)"}</option>)}
                </select>)}
              {wrap("brand", "Brand",
                <select id="p-brand" className="ad-select" value={form.brand} onChange={(e) => set("brand", e.target.value)}>
                  <option value="">No brand</option>
                  {(brands.data?.results || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>)}
              {editing && wrap("slug", "Permalink / slug", <div className="ad-input-group"><span className="prefix">/products/</span><input id="p-slug" value={form.slug} onChange={(e) => set("slug", slugify(e.target.value))} /><button type="button" className="tail ad-link" onClick={() => set("slug", slugify(form.name))}>Sync from name</button></div>)}
              {wrap("description", "Description & material notes", <textarea id="p-description" className="ad-textarea" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Fabric, fit, care…" />, null, " full")}
            </div>
          </section>

          {!editing && (
            <>
              <section className="ad-card ad-card-pad">
                <div className="ad-section-title"><Icon name="rupee" size={18} /> Pricing &amp; stock</div>
                <p className="ad-section-sub">Set pricing for all variants here. Inventory is entered separately for each size and colour below.</p>
                <div className="ad-form-grid three">
                  {wrap("basePrice", "Base price (₹) *", <input id="p-basePrice" className="ad-input" inputMode="decimal" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} placeholder="1999.00" />)}
                  {wrap("offerPrice", "Offer price (₹)", <input id="p-offerPrice" className="ad-input" inputMode="decimal" value={offerPrice} onChange={(e) => setOfferPrice(e.target.value)} placeholder="1499.00" />, "Optional. Shoppers pay this; the base price is shown crossed out.")}
                  {wrap("cost_price", "Unit cost (₹)", <input id="p-cost_price" className="ad-input" inputMode="decimal" value={form.cost_price} onChange={(e) => set("cost_price", e.target.value)} placeholder="Optional" />, "Only you see this.")}
                  {wrap("low_stock_threshold", "Low-stock alert threshold (per variant)", <input id="p-low_stock_threshold" className="ad-input" inputMode="numeric" value={form.low_stock_threshold} onChange={(e) => set("low_stock_threshold", e.target.value)} />, "Alert when any single size/colour variant reaches this stock level. This does not set inventory.")}
                </div>
              </section>

              <section className="ad-card ad-card-pad">
                <div className="ad-section-title"><Icon name="shapes" size={18} /> Sizes &amp; colourways</div>
                <p className="ad-section-sub">{variantCount ? `${variantCount} variant${variantCount === 1 ? "" : "s"} will be created (${sizes.length} size × ${colors.length} colour). Stock is entered per variant, and the product total is calculated from these values.` : "Pick the sizes and colours this product comes in."}</p>
                <div className={`ad-field${errors.sizes ? " invalid" : ""}`}>
                  <span className="ad-label">Available sizes *</span>
                  <div className="ad-chips">
                    {[...SIZES, ...sizes.filter((s) => !SIZES.includes(s))].map((s) => <button type="button" key={s} className={`ad-chip${sizes.includes(s) ? " on" : ""}`} aria-pressed={sizes.includes(s)} onClick={() => toggleIn(sizes, setSizes, s)}>{s}</button>)}
                    <input className="ad-input" style={{ width: 120, minHeight: 36 }} value={customSize} onChange={(e) => setCustomSize(e.target.value)} placeholder="Other, e.g. 32" aria-label="Add another size"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = customSize.trim().toUpperCase(); if (v && !sizes.includes(v)) setSizes([...sizes, v]); setCustomSize(""); } }} />
                  </div>
                  {fieldError("sizes")}
                </div>
                <div className={`ad-field${errors.colors ? " invalid" : ""}`} style={{ marginTop: 18 }}>
                  <span className="ad-label">Colourway swatch *</span>
                  <div className="ad-chips">
                    {[...COLORS.map((c) => c[0]), ...colors.filter((c) => !COLORS.some(([n]) => n === c))].map((c) => (
                      <button type="button" key={c} className={`ad-chip${colors.includes(c) ? " on" : ""}`} aria-pressed={colors.includes(c)} onClick={() => toggleIn(colors, setColors, c)}>
                        <i className="ad-swatch" style={{ background: swatch(c) }} /> {c}
                      </button>
                    ))}
                    <input className="ad-input" style={{ width: 150, minHeight: 36 }} value={customColor} onChange={(e) => setCustomColor(e.target.value)} placeholder="Other colour name" aria-label="Add another colour"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = customColor.trim(); if (v && !colors.some((c) => c.toLowerCase() === v.toLowerCase())) setColors([...colors, v]); setCustomColor(""); } }} />
                  </div>
                  {fieldError("colors")}
                </div>
                {variantCount > 0 && (
                  <div className={`ad-field${errors.variantStock ? " invalid" : ""}`} style={{ marginTop: 18 }}>
                    <span className="ad-label">Opening stock by variant *</span>
                    <p className="ad-hint">Enter the starting quantity for each size and colour. Current combined total: <b>{openingStockTotal} units</b>.</p>
                    <div className="ad-variant-stock-grid">
                      {sizes.flatMap((size) =>
                        colors.map((color) => (
                          <label
                            className="ad-variant-stock-row"
                            htmlFor={`variant-stock-${encodeURIComponent(size)}-${encodeURIComponent(color)}`}
                            key={variantStockKey(size, color)}
                          >
                            <span><b>{size}</b><i className="ad-swatch" style={{ background: swatch(color) }} />{color}</span>
                            <input
                              id={`variant-stock-${encodeURIComponent(size)}-${encodeURIComponent(color)}`}
                              className="ad-input"
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              value={stockForVariant(size, color)}
                              onChange={(event) => setVariantStock(size, color, event.target.value)}
                              aria-label={`Opening stock for size ${size}, colour ${color}`}
                            />
                          </label>
                        ))
                      )}
                    </div>
                    {fieldError("variantStock")}
                  </div>
                )}
              </section>
            </>
          )}

          {editing && (
            <section className="ad-card ad-card-pad">
              <div className="ad-section-title"><Icon name="archive" size={18} /> Variants &amp; inventory</div>
              <p className="ad-section-sub">Each row is one size/colour variant with its own inventory. Update stock from that row; stock changes are always logged. The product total is the sum of all variants.</p>
              <div style={{ overflowX: "auto" }}>
                <table className="ad-mini-table">
                  <thead><tr><th>Size</th><th>Colour</th><th>SKU</th><th>Price (₹)</th><th>Old price (₹)</th><th>Variant stock</th><th>On sale</th><th /></tr></thead>
                  <tbody>
                    {product.variants.map((v) => (
                      <tr key={v.id}>
                        <td><b>{v.size}</b></td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <i className="ad-swatch" style={{ background: swatch(rowValue(v, "color")), flex: "0 0 auto" }} />
                            <input
                              className="ad-input"
                              style={{ width: 120 }}
                              value={rowValue(v, "color")}
                              maxLength={50}
                              onChange={(e) => setRow(v, "color", e.target.value)}
                              aria-label={`Colour for size ${v.size}`}
                            />
                          </div>
                        </td>
                        <td className="ad-cell-sub mono">{v.sku}</td>
                        <td><input className="ad-input" style={{ width: 96 }} inputMode="decimal" value={rowValue(v, "price")} onChange={(e) => setRow(v, "price", e.target.value)} aria-label={`Price of ${v.size} ${v.color}`} /></td>
                        <td><input className="ad-input" style={{ width: 96 }} inputMode="decimal" value={rowValue(v, "original_price")} onChange={(e) => setRow(v, "original_price", e.target.value)} aria-label={`Old price of ${v.size} ${v.color}`} placeholder="-" /></td>
                        <td>
                          <button type="button" className="ad-btn sm" onClick={() => setStockFor(v)} title={`Update stock for size ${v.size}, colour ${v.color}`} aria-label={`Update stock for size ${v.size}, colour ${v.color}; currently ${v.stock} units`}><b>{v.stock}</b> <Icon name="pencil" size={12} /></button>
                          {v.stock <= Number(form.low_stock_threshold || 0) && <div style={{ marginTop: 4 }}><Pill tone={v.stock === 0 ? "bad" : "warn"}>{v.stock === 0 ? "Sold out" : "Low"}</Pill></div>}
                        </td>
                        <td><Toggle checked={Boolean(rowValue(v, "is_active"))} onChange={(on) => setRow(v, "is_active", on)} label={`${v.size} ${v.color} on sale`} /></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button type="button" className="ad-btn sm primary" disabled={!edits[v.id]} onClick={() => saveRow(v)}>Save</button>{" "}
                          <button type="button" className="ad-icon-btn danger" style={{ display: "inline-grid", width: 32, height: 32 }} onClick={() => setVariantDelete(v)} aria-label={`Delete ${v.size} ${v.color}`}><Icon name="trash" size={14} /></button>
                        </td>
                      </tr>
                    ))}
                    {product.variants.length === 0 && <tr><td colSpan={8} className="ad-muted">No sizes yet. Add one below. A product with no active size is not shown in the shop.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="ad-form-grid three" style={{ marginTop: 18, alignItems: "end" }}>
                <div className="ad-field"><label className="ad-label" htmlFor="nv-size">Size</label><input id="nv-size" className="ad-input" value={newVariant.size} onChange={(e) => setNewVariant({ ...newVariant, size: e.target.value })} placeholder="M" /></div>
                <div className="ad-field"><label className="ad-label" htmlFor="nv-color">Colour</label><input id="nv-color" className="ad-input" value={newVariant.color} onChange={(e) => setNewVariant({ ...newVariant, color: e.target.value })} placeholder="Black" /></div>
                <div className="ad-field"><label className="ad-label" htmlFor="nv-price">Price (₹)</label><input id="nv-price" className="ad-input" inputMode="decimal" value={newVariant.price} onChange={(e) => setNewVariant({ ...newVariant, price: e.target.value })} /></div>
                <div className="ad-field"><label className="ad-label" htmlFor="nv-old">Old price (₹)</label><input id="nv-old" className="ad-input" inputMode="decimal" value={newVariant.original_price} onChange={(e) => setNewVariant({ ...newVariant, original_price: e.target.value })} placeholder="Optional" /></div>
                <div className="ad-field"><label className="ad-label" htmlFor="nv-stock">Initial variant stock</label><input id="nv-stock" className="ad-input" type="number" min="0" step="1" inputMode="numeric" value={newVariant.stock} onChange={(e) => setNewVariant({ ...newVariant, stock: e.target.value })} aria-describedby="nv-stock-hint" /><p className="ad-hint" id="nv-stock-hint">Opening quantity for this size and colour only.</p></div>
                <button type="button" className="ad-btn" onClick={addNewVariant}><Icon name="plus" size={15} /> Add size</button>
              </div>
              <div className="ad-form-grid" style={{ marginTop: 18 }}>
                {wrap("cost_price", "Unit cost (₹)", <input id="p-cost_price" className="ad-input" inputMode="decimal" value={form.cost_price} onChange={(e) => set("cost_price", e.target.value)} placeholder="Optional" />, "Only you see this.")}
                {wrap("low_stock_threshold", "Low-stock alert threshold (per variant)", <input id="p-low_stock_threshold" className="ad-input" inputMode="numeric" value={form.low_stock_threshold} onChange={(e) => set("low_stock_threshold", e.target.value)} />, "Alert when any single size/colour variant reaches this stock level. This does not set inventory.")}
              </div>
            </section>
          )}

          <section className="ad-card ad-card-pad">
            <div className="ad-section-title"><Icon name="image-plus" size={18} /> Product pictures</div>
            <p className="ad-section-sub">The main picture is shown first in the shop. JPG, PNG or WebP up to 5 MB each.</p>
            <DropZone multiple compact title="Drop pictures here, or" onError={(m) => setErrors((x) => ({ ...x, pictures: m }))}
              onFiles={(files) => (editing ? addPictures(files) : setQueued((q) => [...q, ...files]))} />
            {errors.pictures && <p className="ad-field-error" style={{ marginTop: 8 }}>{errors.pictures}</p>}
            <div className="ad-gallery">
              {editing
                ? product.images.map((img) => (
                    <div className="ad-shot" key={img.id}>
                      <img src={img.image} alt="" />
                      {img.is_primary && <span className="tag">Main</span>}
                      <div className="tools">
                        {!img.is_primary && <button type="button" onClick={() => makeMain(img)} title="Make main picture" aria-label="Make main picture"><Icon name="star" size={13} /></button>}
                        <button type="button" onClick={() => removePicture(img)} title="Remove" aria-label="Remove picture"><Icon name="trash" size={13} /></button>
                      </div>
                    </div>
                  ))
                : queued.map((file, i) => (
                    <Queued key={`${file.name}-${i}`} file={file} primary={i === 0} onRemove={() => setQueued((q) => q.filter((_, n) => n !== i))}
                      onPrimary={() => setQueued((q) => [q[i], ...q.filter((_, n) => n !== i)])} />
                  ))}
            </div>
          </section>

          <section className="ad-card ad-card-pad">
            <div className="ad-section-title"><Icon name="search" size={18} /> Search engine preview</div>
            <p className="ad-section-sub">How the product may look in Google results. Empty boxes use the product name and description.</p>
            <div className="ad-form-grid" style={{ marginBottom: 16 }}>
              {wrap("meta_title", "Page title", <input id="p-meta_title" className="ad-input" value={form.meta_title} maxLength={70} onChange={(e) => set("meta_title", e.target.value)} />, `${form.meta_title.length} / 70`)}
              {wrap("meta_description", "Meta description", <input id="p-meta_description" className="ad-input" value={form.meta_description} maxLength={160} onChange={(e) => set("meta_description", e.target.value)} />, `${form.meta_description.length} / 160`)}
            </div>
            <div className="ad-serp"><small>{STORE}/products/{form.slug || slugify(form.name) || "your-product"}</small><b>{serpTitle}</b><p>{serpText}</p></div>
          </section>
        </div>

        <div className="ad-stack">
          <section className="ad-card ad-card-pad">
            <div className="ad-section-title"><Icon name="eye-open" size={18} /> Visibility</div>
            <div className="ad-stack" style={{ gap: 12, marginTop: 12 }}>
              <div className="ad-switch-row"><div><b>Active in shop</b><small>{form.is_active ? "Shoppers can see and buy it" : "Hidden from shoppers"}</small></div><Toggle checked={form.is_active} onChange={(v) => set("is_active", v)} label="Active in shop" /></div>
              <div className="ad-switch-row"><div><b>Featured</b><small>Show in Trending Products on the home page</small></div><Toggle checked={form.is_featured} onChange={(v) => set("is_featured", v)} label="Featured" /></div>
            </div>
          </section>

          {editing && (
            <section className="ad-card ad-card-pad">
              <div className="ad-card-head"><h3>Summary</h3>{<Pill tone={product.stock_status === "ok" ? "ok" : product.stock_status === "low" ? "warn" : product.stock_status === "out" ? "bad" : "muted"}>{{ ok: "In stock", low: "Low stock", out: "Sold out", none: "No sizes" }[product.stock_status]}</Pill>}</div>
              <div className="ad-form-grid">
                <div className="ad-fact"><span className="ad-eyebrow">Total across variants</span><b>{total} units</b></div>
                <div className="ad-fact"><span className="ad-eyebrow">Variants</span><b>{product.variants.length}</b></div>
                <div className="ad-fact" style={{ gridColumn: "1 / -1" }}><span className="ad-eyebrow">Price</span><b>{prices.length ? (Math.min(...prices) === Math.max(...prices) ? formatPrice(prices[0]) : `${formatPrice(Math.min(...prices))} – ${formatPrice(Math.max(...prices))}`) : "-"}</b></div>
              </div>
              <p className="ad-hint" style={{ marginTop: 14 }}>Created {formatDate(product.created_at)} · changed {timeAgo(product.updated_at)}</p>
              <button type="button" className="ad-btn outline-danger" style={{ width: "100%", marginTop: 16 }} onClick={() => setDeleting(true)}><Icon name="trash" size={15} /> Delete product</button>
            </section>
          )}
        </div>
      </div>

      <div className="ad-sticky-bar" role="region" aria-label="Save">
        <span className="ad-muted">{editing ? (dirty ? "You have unsaved changes." : "All changes are saved.") : "The product goes live as soon as you publish."}</span>
        <div className="ad-actions">
          <Link className="ad-btn ghost" to="/products">Cancel</Link>
          <button type="submit" className="ad-btn primary" disabled={saving || (editing && !dirty)}>{saving ? "Saving…" : editing ? "Save changes" : "Publish product"}</button>
        </div>
      </div>

    </form>

      {stockFor && <StockModal variant={stockFor} onClose={() => setStockFor(null)} onDone={() => { setStockFor(null); refresh(); }} />}
      {variantDelete && (
        <Modal title="Delete this size?" tone="danger" width={420} onClose={() => setVariantDelete(null)}
          footer={<><button type="button" className="ad-btn ghost" onClick={() => setVariantDelete(null)}>Cancel</button>
            <button type="button" className="ad-btn danger" onClick={async () => { await deleteVariant(variantDelete.id); setVariantDelete(null); toast.show("Variant deleted.", "ok"); refresh(); }}>Delete</button></>}>
          <p className="ad-modal-text">Size {variantDelete.size} in {variantDelete.color} ({variantDelete.stock} in stock) will be removed. Past orders keep their details.</p>
        </Modal>
      )}
      {deleting && product && <DeleteProductDialog product={product} onClose={() => setDeleting(false)} onDeleted={() => navigate("/products", { replace: true })} />}
    </>
  );
}

/** Add or remove units of one variant. Every change is saved with a note in the stock log. */
function StockModal({ variant, onClose, onDone }) {
  const toast = useToast();
  const [type, setType] = useState("IN");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d+$/.test(quantity) || Number(quantity) < 1) return setError("Enter how many units (1 or more).");
    if (type === "OUT" && Number(quantity) > variant.stock) return setError(`Only ${variant.stock} in stock.`);
    setBusy(true);
    try {
      const done = await adjustStock(variant.id, { type, quantity: Number(quantity), note });
      toast.show(`Stock is now ${done.stock}.`, "ok");
      onDone();
    } catch (err) {
      setError(err.response?.data?.detail || Object.values(err.response?.data || {}).flat()[0] || "The stock was not changed.");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Stock: size ${variant.size}, ${variant.color}`} width={440} onClose={onClose} locked={busy}
      footer={<><button type="button" className="ad-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="stock-form" className="ad-btn primary" disabled={busy}>{busy ? "Saving…" : "Update stock"}</button></>}>
      <form id="stock-form" onSubmit={submit} noValidate>
        <p className="ad-modal-text" style={{ marginBottom: 14 }}>In stock now: <b>{variant.stock}</b> units.</p>
        {error && <div className="ad-alert" role="alert">{error}</div>}
        <div className="ad-seg" style={{ marginBottom: 14 }}>
          <button type="button" className={type === "IN" ? "on" : ""} onClick={() => setType("IN")}>Add stock</button>
          <button type="button" className={type === "OUT" ? "on" : ""} onClick={() => setType("OUT")}>Remove stock</button>
        </div>
        <div className="ad-form-grid">
          <div className="ad-field"><label className="ad-label" htmlFor="st-q">Units</label><input id="st-q" className="ad-input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus /></div>
          <div className="ad-field"><label className="ad-label" htmlFor="st-n">Note</label><input id="st-n" className="ad-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="New delivery, damaged…" /></div>
        </div>
      </form>
    </Modal>
  );
}

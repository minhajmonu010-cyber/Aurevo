import { useState } from "react";
import { createCategory, toFormData } from "../api/admin";
import { useToast } from "../context/ToastContext";
import { slugify } from "../utils/format";
import { useObjectUrl } from "../utils/hooks";
import { parseApiError } from "../utils/errors";
import DropZone, { MAX_MB } from "./DropZone";
import ImageCropDialog from "./ImageCropDialog";
import Icon from "./Icon";
import { Modal, Toggle } from "./ui";

/** "Create New Category" box on the Categories page. */
export default function CategoryModal({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", slug: "", description: "", is_active: true, priority: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [file, setFile] = useState(null);
  const [cropFile, setCropFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const preview = useObjectUrl(file);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setName = (name) => setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : slugify(name) }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (form.name.trim().length < 2) next.name = "Enter the category name.";
    if (form.priority !== "" && (!/^\d+$/.test(form.priority) || Number(form.priority) > 9998)) next.priority = "Use a whole number from 0 to 9998.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const created = await createCategory(
        toFormData({
          name: form.name.trim(),
          slug: form.slug || undefined,
          description: form.description,
          is_active: form.is_active,
          priority: form.priority === "" ? undefined : Number(form.priority),
          image: file || undefined,
        })
      );
      toast.show(`"${created.name}" was created.`, "ok");
      onCreated(created);
    } catch (err) {
      const parsed = parseApiError(err);
      setErrors({ ...parsed.fields, form: parsed.form });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      eyebrow="Catalog taxonomy builder"
      title="Create New Category"
      width={640}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <button type="button" className="ad-btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="category-form" className="ad-btn primary" disabled={saving}>
            <Icon name="cloud-upload" size={15} /> {saving ? "Saving…" : form.is_active ? "Save & Publish Category" : "Save Category (hidden)"}
          </button>
        </>
      }
    >
      <p className="ad-section-sub">Define the name, picture and visibility of a shop category.</p>
      <form id="category-form" onSubmit={submit} noValidate>
        {errors.form && <div className="ad-alert" role="alert"><Icon name="alert-triangle" size={16} /> {errors.form}</div>}
        <div className="ad-form-grid">
          <div className={`ad-field${errors.name ? " invalid" : ""}`}>
            <label className="ad-label" htmlFor="cat-name">Category name <span className="req">*</span></label>
            <input id="cat-name" className="ad-input" value={form.name} onChange={(e) => setName(e.target.value)} placeholder="Cyberpunk Utility" maxLength={100} autoFocus />
            {errors.name && <p className="ad-field-error">{errors.name}</p>}
          </div>
          <div className={`ad-field${errors.slug ? " invalid" : ""}`}>
            <label className="ad-label" htmlFor="cat-slug">Slug / route URL</label>
            <div className="ad-input-group">
              <span className="prefix">/cat/</span>
              <input id="cat-slug" value={form.slug} onChange={(e) => { setSlugTouched(true); set("slug", slugify(e.target.value)); }} placeholder="cyberpunk-utility" />
            </div>
            {errors.slug && <p className="ad-field-error">{errors.slug}</p>}
          </div>

          <div className={`ad-field full${errors.image ? " invalid" : ""}`}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <label className="ad-label">Collection banner image</label>
              <span className="ad-hint">Recommended 1:1 (1080×1080 px)</span>
            </div>
            {preview ? (
              <div className="ad-cover">
                <img src={preview} alt="Chosen category banner" />
                <div className="ad-shot" style={{ position: "absolute", inset: "auto 10px 10px auto", width: "auto", aspectRatio: "auto", border: 0, background: "none" }}>
                  <div className="tools" style={{ position: "static" }}>
                    <button type="button" onClick={() => setCropFile(file)} aria-label="Crop picture"><Icon name="crop" size={14} /></button>
                    <button type="button" onClick={() => setFile(null)} aria-label="Remove picture"><Icon name="trash" size={14} /></button>
                  </div>
                </div>
              </div>
            ) : (
              <DropZone onFiles={([f]) => setCropFile(f)} onError={(message) => setErrors((e) => ({ ...e, image: message }))} hint={`JPG, PNG, WEBP (max ${MAX_MB} MB)`} />
            )}
            {errors.image && <p className="ad-field-error">{errors.image}</p>}
          </div>

          <div className="ad-field full">
            <label className="ad-label" htmlFor="cat-desc">Description &amp; SEO meta copy</label>
            <textarea id="cat-desc" className="ad-textarea" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Describe what shoppers will find in this category." />
          </div>

          <div className="ad-switch-row">
            <div>
              <b>Category status</b>
              <small>{form.is_active ? "Publish immediately to the shop" : "Keep hidden from shoppers"}</small>
            </div>
            <Toggle checked={form.is_active} onChange={(v) => set("is_active", v)} label="Publish immediately" />
          </div>
          <div className={`ad-field${errors.priority ? " invalid" : ""}`}>
            <label className="ad-label" htmlFor="cat-priority">Catalog priority index</label>
            <div className="ad-input-group">
              <input id="cat-priority" inputMode="numeric" value={form.priority} onChange={(e) => set("priority", e.target.value.trim())} placeholder="Next free place" style={{ color: "var(--ad-ink)", paddingLeft: 14 }} />
              <span className="tail">1 = shown first</span>
            </div>
            {errors.priority && <p className="ad-field-error">{errors.priority}</p>}
          </div>
        </div>
      </form>
      {cropFile && (
        <ImageCropDialog
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onComplete={(croppedFile) => {
            setFile(croppedFile);
            setCropFile(null);
            setErrors((current) => ({ ...current, image: "" }));
          }}
        />
      )}
    </Modal>
  );
}

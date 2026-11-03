
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAdminCoupons,
  createAdminCoupon,
  updateAdminCoupon,
  deleteAdminCoupon,
} from "../api/admin";
import ConfirmationDialog from "../components/ConfirmationDialog";
import Icon from "../components/Icon";
import { EmptyState, Modal, Pagination, Pill, Skeleton, StatCard } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { downloadCsv, formatNumber } from "../utils/format";
import "../admin.css";

const emptyForm = {
  code: "",
  description: "",
  discount_type: "percentage",
  discount_value: "",
  minimum_order_amount: "0",
  usage_limit: "",
  start_date: "",
  end_date: "",
  is_active: true,
};

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 16);
}

function toApiDate(value) {
  return value ? new Date(value).toISOString() : "";
}

export default function Coupons() {
  const toast = useToast();
  const [coupons, setCoupons] = useState([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, scheduled: 0, expired: 0, inactive: 0, used_up: 0 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [couponToDelete, setCouponToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deletingCoupon, setDeletingCoupon] = useState(false);
  const couponCodeInput = useRef(null);

  const pageSize = 10;

  const closeModal = useCallback(() => setModal(false), []);

  const loadCoupons = useCallback(async () => {
    try {
      const response = await getAdminCoupons({
        search,
        status: filter,
        page,
        page_size: pageSize,
      });

      setCoupons(response.data.results);
      setCount(response.data.count);
      setSummary(response.data.summary);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        "Unable to load coupons. Check your API and admin login."
      );
    } finally {
      setLoading(false);
    }
  }, [search, filter, page]);

  useEffect(() => {
    // This effect synchronizes filters with an asynchronous API request.
    void Promise.resolve().then(loadCoupons);
  }, [loadCoupons]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setModal(true);
  }

  function openEdit(coupon) {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      description: coupon.description || "",
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      minimum_order_amount: coupon.minimum_order_amount,
      usage_limit: coupon.usage_limit ?? "",
      start_date: toLocalInput(coupon.start_date),
      end_date: toLocalInput(coupon.end_date),
      is_active: coupon.is_active,
    });
    setError("");
    setModal(true);
  }

  function changeField(event) {
    const { name, value, type, checked } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!form.start_date || !form.end_date) {
      setError("Please select both validity dates.");
      return;
    }

    if (new Date(form.end_date) <= new Date(form.start_date)) {
      setError("End date must be after start date.");
      return;
    }

    const value = Number(form.discount_value);
    const minimum = Number(form.minimum_order_amount);

    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a discount value greater than zero.");
      return;
    }

    if (form.discount_type === "percentage" && value > 100) {
      setError("Percentage discount cannot exceed 100.");
      return;
    }

    if (!Number.isFinite(minimum) || minimum < 0) {
      setError("Minimum order amount cannot be negative.");
      return;
    }

    const payload = {
      ...form,
      code: form.code.trim().toUpperCase(),
      discount_value: value,
      minimum_order_amount: minimum,
      usage_limit:
        form.usage_limit === "" ? null : Number(form.usage_limit),
      start_date: toApiDate(form.start_date),
      end_date: toApiDate(form.end_date),
    };

    if (!payload.code) {
      setError("Coupon code is required.");
      return;
    }

    if (
      payload.usage_limit !== null &&
      (!Number.isInteger(payload.usage_limit) ||
        payload.usage_limit < 1)
    ) {
      setError("Usage limit must be a positive whole number.");
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        await updateAdminCoupon(editingId, payload);
      } else {
        await createAdminCoupon(payload);
      }

      setModal(false);
      await loadCoupons();
    } catch (err) {
      const data = err.response?.data;
      const firstError = data
        ? Object.values(data).flat(Infinity)[0]
        : null;

      setError(
        typeof firstError === "string"
          ? firstError
          : "Could not save coupon. Please check your inputs."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(coupon) {
    try {
      await updateAdminCoupon(coupon.id, {
        is_active: !coupon.is_active,
      });
      await loadCoupons();
    } catch {
      setError("Could not update coupon status.");
    }
  }

  async function confirmDeleteCoupon() {
    if (!couponToDelete) return;
    setDeletingCoupon(true);
    setDeleteError("");
    try {
      await deleteAdminCoupon(couponToDelete.id);
      setCouponToDelete(null);
      await loadCoupons();
    } catch (err) {
      setDeleteError(
        err.response?.data?.detail || "Could not delete coupon."
      );
    } finally {
      setDeletingCoupon(false);
    }
  }

  function removeCoupon(coupon) {
    setDeleteError("");
    setCouponToDelete(coupon);
  }

  async function copyCode(coupon) {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopiedId(coupon.id);
      toast.show(`${coupon.code} copied.`, "ok");
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setError("Could not copy the coupon code.");
    }
  }

  async function exportCoupons() {
    setExporting(true);
    setError("");
    try {
      const rows = [];
      const pages = Math.ceil(count / 100);
      for (let currentPage = 1; currentPage <= pages; currentPage += 1) {
        const response = await getAdminCoupons({ search, status: filter, page: currentPage, page_size: 100 });
        rows.push(...response.data.results);
      }
      downloadCsv("coupons.csv", [
        ["Code", "Description", "Discount type", "Discount value", "Minimum order", "Used", "Usage limit", "Starts", "Ends", "Status"],
        ...rows.map((coupon) => [coupon.code, coupon.description, coupon.discount_type, coupon.discount_value, coupon.minimum_order_amount, coupon.used_count, coupon.usage_limit ?? "Unlimited", coupon.start_date, coupon.end_date, coupon.status]),
      ]);
    } catch {
      setError("Could not export coupons.");
    } finally {
      setExporting(false);
    }
  }

  const money = (amount) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));

  return (
    <div className="coupon-page">
      <div className="ad-crumbs">Promotions / <b>Coupons</b></div>
      <div className="ad-head coupon-heading">
        <div>
          <h1 className="ad-h1">Coupons</h1>
          <p className="ad-sub">Create, track, and manage customer discounts.</p>
        </div>
        <button type="button" className="ad-btn primary" onClick={openCreate}>
          <Icon name="plus" size={15} /> Create coupon
        </button>
      </div>

      <section className="ad-stats coupon-stats">
        <StatCard label="Total coupons" value={loading ? "…" : formatNumber(summary.total)} icon="ticket" accent foot="all promotions" />
        <StatCard label="Active now" value={loading ? "…" : formatNumber(summary.active)} icon="circle-check" foot="available to customers" />
        <StatCard label="Scheduled" value={loading ? "…" : formatNumber(summary.scheduled)} icon="calendar" foot="starting later" />
        <StatCard label="Ended or unavailable" value={loading ? "…" : formatNumber(summary.expired + summary.inactive + summary.used_up)} icon="clock" foot="expired, disabled, or used up" />
      </section>

      <section className="ad-toolbar coupon-toolbar" aria-label="Coupon filters">
        <div className="ad-search coupon-search">
          <Icon name="search" size={15} />
          <input
          type="search"
          placeholder="Search coupon code..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        </div>
        <label className="coupon-status-filter">
          <span className="ad-label">Status</span>
          <select
            className="ad-select"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="Scheduled">Scheduled</option>
          <option value="Expired">Expired</option>
          <option value="Used up">Used up</option>
        </select>
        </label>
        {filter && <button type="button" className="ad-link" onClick={() => { setFilter(""); setPage(1); }}>Clear filter</button>}
        <div className="coupon-toolbar-actions">
          <button type="button" className="ad-btn" onClick={loadCoupons} disabled={loading}><Icon name="refresh" size={14} /> Refresh</button>
          <button type="button" className="ad-btn" onClick={exportCoupons} disabled={exporting || count === 0}><Icon name="download" size={14} /> {exporting ? "Exporting..." : "Export CSV"}</button>
        </div>
      </section>

      {error && <div className="ad-alert" role="alert">{error}</div>}

      <section className="ad-card coupon-table-wrap" aria-label="Coupons">
        <div className="ad-card-pad coupon-table-heading">
          <div className="ad-card-head">
            <div>
              <h3>Coupon list</h3>
              <p className="ad-hint">{formatNumber(count)} {count === 1 ? "coupon" : "coupons"}{filter || search ? " match your filters" : " in your store"}</p>
            </div>
          </div>
        </div>
        <table className="ad-table coupon-table">
          <thead>
            <tr>
              <th>Coupon</th>
              <th>Discount</th>
              <th>Minimum Order</th>
              <th>Usage</th>
              <th>Valid Until</th>
              <th>Status</th>
              <th className="right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="coupon-empty"><Skeleton rows={4} /></td></tr>
            ) : coupons.length === 0 ? (
              <tr><td colSpan="7" className="coupon-empty"><EmptyState icon="ticket" title="No coupons found">Create a coupon or adjust your filters.</EmptyState></td></tr>
            ) : (
              coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td>
                    <strong className="coupon-code">{coupon.code}</strong>
                    <small>{coupon.description || "No description"}</small>
                  </td>

                  <td>
                    {coupon.discount_type === "percentage"
                      ? `${coupon.discount_value}%`
                      : money(coupon.discount_value)}
                  </td>

                  <td>{money(coupon.minimum_order_amount)}</td>

                  <td>
                    <div className="coupon-usage-count">{coupon.used_count} / {coupon.usage_limit ?? "Unlimited"}</div>
                    {coupon.usage_limit !== null && <progress className="coupon-usage-bar" max={coupon.usage_limit} value={Math.min(coupon.used_count, coupon.usage_limit)} aria-label={`${coupon.used_count} of ${coupon.usage_limit} uses`} />}
                  </td>

                  <td>
                    {new Date(coupon.end_date).toLocaleDateString("en-IN")}
                  </td>

                  <td><Pill tone={coupon.status === "Active" ? "ok" : coupon.status === "Scheduled" ? "warn" : "muted"}>{coupon.status}</Pill></td>

                  <td className="right">
                    <div className="coupon-actions">
                      <button type="button" className="ad-icon-btn" title="Edit coupon" aria-label={`Edit ${coupon.code}`} onClick={() => openEdit(coupon)}><Icon name="pencil" size={14} /></button>
                      <button type="button" className="ad-btn sm coupon-copy" onClick={() => copyCode(coupon)}>{copiedId === coupon.id ? "Copied" : "Copy code"}</button>
                      <button type="button" className="ad-icon-btn" title={coupon.is_active ? "Disable coupon" : "Enable coupon"} aria-label={`${coupon.is_active ? "Disable" : "Enable"} ${coupon.code}`} onClick={() => toggleActive(coupon)}><Icon name={coupon.is_active ? "eye-off" : "circle-check"} size={14} /></button>
                      <button type="button" className="ad-icon-btn danger" title="Delete coupon" aria-label={`Delete ${coupon.code}`} onClick={() => removeCoupon(coupon)}><Icon name="trash" size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination page={page} pageSize={pageSize} count={count} noun="coupons" onChange={setPage} />
      </section>

      {modal && (
        <Modal
          title={editingId ? "Edit coupon" : "Create coupon"}
          eyebrow="Promotions"
          width={720}
          locked={saving}
          onClose={closeModal}
          initialFocusRef={couponCodeInput}
          footer={(
            <>
              <button type="button" className="ad-btn ghost" onClick={closeModal} disabled={saving}>Cancel</button>
              <button type="submit" className="ad-btn primary" form="coupon-form" disabled={saving}>
                {saving ? "Saving..." : editingId ? "Save changes" : "Create coupon"}
              </button>
            </>
          )}
        >
            <form id="coupon-form" className="coupon-form" onSubmit={handleSubmit}>
              <label>
                Coupon Code *
                <input
                  ref={couponCodeInput}
                  name="code"
                  value={form.code}
                  onChange={changeField}
                  placeholder="e.g. AUREVO20"
                  maxLength={50}
                  required
                />
              </label>

              <label>
                Description
                <input
                  name="description"
                  value={form.description}
                  onChange={changeField}
                  placeholder="Summer collection discount"
                />
              </label>

              <div className="coupon-form-grid">
                <label>
                  Discount Type *
                  <select
                    name="discount_type"
                    value={form.discount_type}
                    onChange={changeField}
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed amount (₹)</option>
                  </select>
                </label>

                <label>
                  Discount Value *
                  <input
                    name="discount_value"
                    type="number"
                    min="0.01"
                    max={
                      form.discount_type === "percentage" ? "100" : undefined
                    }
                    step="0.01"
                    value={form.discount_value}
                    onChange={changeField}
                    required
                  />
                </label>

                <label>
                  Minimum Order (₹)
                  <input
                    name="minimum_order_amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.minimum_order_amount}
                    onChange={changeField}
                  />
                </label>

                <label>
                  Usage Limit
                  <input
                    name="usage_limit"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Unlimited"
                    value={form.usage_limit}
                    onChange={changeField}
                  />
                </label>

                <label>
                  Start Date *
                  <input
                    name="start_date"
                    type="datetime-local"
                    value={form.start_date}
                    onChange={changeField}
                    required
                  />
                </label>

                <label>
                  End Date *
                  <input
                    name="end_date"
                    type="datetime-local"
                    value={form.end_date}
                    onChange={changeField}
                    required
                  />
                </label>
              </div>

              <label className="coupon-active-toggle">
                <input
                  name="is_active"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={changeField}
                />
                Coupon is enabled
              </label>

              {error && <div className="ad-alert" role="alert">{error}</div>}
            </form>
        </Modal>
      )}
      {couponToDelete && (
        <ConfirmationDialog
          title="Delete coupon?"
          message={`Delete coupon ${couponToDelete.code}? This action cannot be undone.`}
          confirmLabel="Delete coupon"
          busy={deletingCoupon}
          error={deleteError}
          onConfirm={confirmDeleteCoupon}
          onClose={() => {
            setCouponToDelete(null);
            setDeleteError("");
          }}
        />
      )}
    </div>
  );
}


import { useCallback, useEffect, useState } from "react";
import {
  getAdminOffers,
  createAdminOffer,
  updateAdminOffer,
  deleteAdminOffer,
  listCategories,
  listProducts,
} from "../api/admin";
import ConfirmationDialog from "../components/ConfirmationDialog";
import Icon from "../components/Icon";
import { EmptyState, Modal, Pagination, Pill, StatCard } from "../components/ui";
import "../admin.css";

const initialForm = {
  name: "",
  description: "",
  discount_type: "percentage",
  discount_value: "",
  applies_to: "all",
  target_ids: [],
  start_date: "",
  end_date: "",
  is_active: true,
};

function toLocalDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function toIso(value) {
  return new Date(value).toISOString();
}

async function loadAllOptions(loader) {
  const items = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await loader({ page, page_size: 100, sort: "name" });
    items.push(...(response.results || []));
    hasMore = Boolean(response.next);
    page += 1;
  }

  return items;
}

export default function Offers() {
  const [offers, setOffers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [error, setError] = useState("");
  const [offerToDelete, setOfferToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [deletingOffer, setDeletingOffer] = useState(false);

  const pageSize = 10;

  const money = (value) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(value || 0));

  const loadOffers = useCallback(async () => {
    try {
      const response = await getAdminOffers({
        search,
        status: filter,
        page,
        page_size: pageSize,
      });

      setOffers(response.data.results);
      setCount(response.data.count);
    } catch (err) {
      setError(
        err.response?.data?.detail || "Could not load offers."
      );
    } finally {
      setLoading(false);
    }
  }, [search, filter, page]);

  useEffect(() => {
    // This effect synchronizes filters with an asynchronous API request.
    void Promise.resolve().then(loadOffers);
  }, [loadOffers]);

  useEffect(() => {
    if (!modalOpen) return undefined;

    let cancelled = false;
    Promise.all([loadAllOptions(listProducts), loadAllOptions(listCategories)])
      .then(([productOptions, categoryOptions]) => {
        if (cancelled) return;
        setProducts(productOptions);
        setCategories(categoryOptions);
      })
      .catch(() => {
        if (!cancelled) setTargetsError("Could not load products and categories.");
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modalOpen]);

  function handleChange(event) {
    const { name, value, checked, type } = event.target;
    setForm((previous) => ({
      ...previous,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function openCreate() {
    setEditingId(null);
    setForm(initialForm);
    setError("");
    setTargetSearch("");
    setTargetsLoading(true);
    setTargetsError("");
    setModalOpen(true);
  }

  function openEdit(offer) {
    setEditingId(offer.id);
    setForm({
      name: offer.name,
      description: offer.description || "",
      discount_type: offer.discount_type,
      discount_value: offer.discount_value,
      applies_to: offer.applies_to,
      target_ids: (offer.target_ids || []).map(String),
      start_date: toLocalDateTime(offer.start_date),
      end_date: toLocalDateTime(offer.end_date),
      is_active: offer.is_active,
    });
    setError("");
    setTargetSearch("");
    setTargetsLoading(true);
    setTargetsError("");
    setModalOpen(true);
  }

  function openDuplicate(offer) {
    setEditingId(null);
    setForm({
      name: `${offer.name} copy`.slice(0, 150),
      description: offer.description || "",
      discount_type: offer.discount_type,
      discount_value: offer.discount_value,
      applies_to: offer.applies_to,
      target_ids: (offer.target_ids || []).map(String),
      start_date: toLocalDateTime(offer.start_date),
      end_date: toLocalDateTime(offer.end_date),
      is_active: false,
    });
    setError("");
    setTargetSearch("");
    setTargetsLoading(true);
    setTargetsError("");
    setModalOpen(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!form.start_date || !form.end_date) {
      setError("Select both start and end dates.");
      return;
    }

    if (new Date(form.end_date) <= new Date(form.start_date)) {
      setError("End date must be after start date.");
      return;
    }

    const discount = Number(form.discount_value);

    if (!Number.isFinite(discount) || discount <= 0) {
      setError("Enter a discount greater than zero.");
      return;
    }

    if (form.discount_type === "percentage" && discount > 100) {
      setError("Percentage discount cannot exceed 100%.");
      return;
    }

    let targetIds = [];

    if (form.applies_to !== "all") {
      targetIds = form.target_ids.map(Number);

      if (
        !targetIds.length ||
        targetIds.some(
          (id) => !Number.isInteger(id) || id <= 0
        )
      ) {
        setError("Select at least one valid product or category.");
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      discount_type: form.discount_type,
      discount_value: discount,
      applies_to: form.applies_to,
      target_ids: targetIds,
      start_date: toIso(form.start_date),
      end_date: toIso(form.end_date),
      is_active: form.is_active,
    };

    if (!payload.name) {
      setError("Offer name is required.");
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        await updateAdminOffer(editingId, payload);
      } else {
        await createAdminOffer(payload);
      }

      setModalOpen(false);
      await loadOffers();
    } catch (err) {
      const data = err.response?.data;
      const firstError = data
        ? Object.values(data).flat(Infinity)[0]
        : null;

      setError(
        typeof firstError === "string"
          ? firstError
          : "Could not save offer. Check the entered details."
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleOffer(offer) {
    setError("");

    try {
      await updateAdminOffer(offer.id, {
        is_active: !offer.is_active,
      });
      await loadOffers();
    } catch {
      setError("Could not update offer status.");
    }
  }

  async function confirmDeleteOffer() {
    if (!offerToDelete) return;
    setDeletingOffer(true);
    setDeleteError("");
    try {
      await deleteAdminOffer(offerToDelete.id);
      setOfferToDelete(null);
      await loadOffers();
    } catch (err) {
      setDeleteError(
        err.response?.data?.detail || "Could not delete offer."
      );
    } finally {
      setDeletingOffer(false);
    }
  }

  function removeOffer(offer) {
    setDeleteError("");
    setOfferToDelete(offer);
  }

  function toggleTarget(id, checked) {
    const selectedId = String(id);
    setForm((previous) => ({
      ...previous,
      target_ids: checked
        ? [...new Set([...previous.target_ids, selectedId])]
        : previous.target_ids.filter((targetId) => targetId !== selectedId),
    }));
  }

  const targetOptions = form.applies_to === "products" ? products : categories;
  const filteredTargetOptions = targetOptions.filter((item) =>
    `${item.name} ${item.sku || ""}`.toLowerCase().includes(targetSearch.trim().toLowerCase())
  );

  return (
    <div className="offers-page">
      <div className="ad-crumbs">Commerce / <b>Offers</b></div>
      <header className="ad-head">
        <div>
          <h1 className="ad-h1">Offers</h1>
          <p className="ad-sub">
            Create and manage storewide and product promotions.
          </p>
        </div>

        <button type="button" className="ad-btn primary" onClick={openCreate}>
          <Icon name="plus" size={15} /> Create Offer
        </button>
      </header>

      <section className="ad-stats offers-summary">
        <StatCard label="Matching offers" value={count} icon="ticket" foot={filter ? `filtered by ${filter.toLowerCase()}` : "across all statuses"} />
        <StatCard label="Active on this page" value={offers.filter((offer) => offer.status === "Active").length} icon="circle-check" foot="currently available" />
        <StatCard label="Scheduled on this page" value={offers.filter((offer) => offer.status === "Scheduled").length} icon="calendar" deltaTone="warn" foot="upcoming campaigns" />
      </section>

      <section className="ad-toolbar" aria-label="Offer filters">
        <div className="ad-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={search}
            aria-label="Search offers"
            placeholder="Search offer name..."
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <label className="ad-select-inline">
          Status
          <select
            className="ad-select"
            value={filter}
            aria-label="Filter offer status"
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
          </select>
        </label>

      </section>

      {error && <div className="ad-alert" role="alert">{error}</div>}

      <section className="ad-card" aria-label="Offers">
        <div className="ad-card-pad offers-table-heading">
          <div className="ad-card-head">
            <div>
              <h3>Promotion list</h3>
              <p className="ad-hint">{count.toLocaleString("en-IN")} {count === 1 ? "offer" : "offers"}{filter || search ? " match your filters" : " in your store"}</p>
            </div>
            <Pill tone="purple">Campaigns</Pill>
          </div>
        </div>

        {loading ? (
          <div className="ad-card-pad ad-muted">Loading offers...</div>
        ) : offers.length === 0 ? (
          <EmptyState icon="ticket" title={search || filter ? "No offers match these filters" : "No offers yet"}>
            {search || filter ? "Try changing the search or status filter." : "Create an offer to promote products and categories."}
          </EmptyState>
        ) : (
          <div className="offers-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Offer</th>
                <th>Discount</th>
                <th>Applies To</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" className="offers-empty">
                    Loading offers...
                  </td>
                </tr>
              ) : offers.length === 0 ? (
                <tr>
                  <td colSpan="7" className="offers-empty">
                    No offers found. Create your first offer.
                  </td>
                </tr>
              ) : (
                offers.map((offer) => (
                  <tr key={offer.id}>
                    <td>
                      <b className="ad-cell-name">{offer.name}</b>
                      <div className="ad-cell-sub">
                        {offer.description || "No description"}
                      </div>
                    </td>

                    <td>
                      <Pill tone="purple">
                        {offer.discount_type === "percentage"
                          ? `${offer.discount_value}% OFF`
                          : `${money(offer.discount_value)} OFF`}
                      </Pill>
                    </td>

                    <td>
                      {offer.applies_to === "all"
                        ? "All products"
                        : offer.applies_to === "products"
                        ? `${offer.target_ids.length} products`
                        : `${offer.target_ids.length} categories`}
                    </td>

                    <td>
                      {new Date(offer.start_date).toLocaleDateString(
                        "en-IN"
                      )}
                    </td>

                    <td>
                      {new Date(offer.end_date).toLocaleDateString(
                        "en-IN"
                      )}
                    </td>

                    <td>
                      <Pill tone={offer.status === "Active" ? "ok" : offer.status === "Scheduled" ? "warn" : offer.status === "Expired" ? "bad" : "muted"}>
                        {offer.status}
                      </Pill>
                    </td>

                    <td>
                      <div className="ad-row-actions offers-row-actions">
                        <button type="button" className="ad-btn sm" onClick={() => openEdit(offer)}>
                          <Icon name="pencil" size={13} />
                          Edit
                        </button>
                        <button type="button" className="ad-btn sm" onClick={() => openDuplicate(offer)}>
                          <Icon name="plus" size={13} />
                          Duplicate
                        </button>
                        <button type="button" className="ad-btn sm" onClick={() => toggleOffer(offer)}>
                          <Icon name={offer.is_active ? "ban" : "circle-check"} size={13} />
                          {offer.is_active ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          className="ad-btn sm outline-danger"
                          onClick={() => removeOffer(offer)}
                        >
                          <Icon name="trash" size={13} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        )}
        <Pagination page={page} pageSize={pageSize} count={count} noun="offers" onChange={setPage} />
      </section>

      {modalOpen && (
        <Modal
          title={editingId ? "Edit Offer" : "Create Offer"}
          eyebrow="Campaign settings"
          onClose={() => setModalOpen(false)}
          locked={saving}
          footer={
            <>
              <button type="button" className="ad-btn ghost" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</button>
              <button type="submit" form="admin-offer-form" className="ad-btn primary" disabled={saving}>
                {saving ? "Saving..." : editingId ? "Save Changes" : "Create Offer"}
              </button>
            </>
          }
        >
            <p className="ad-hint offer-form-intro">
              Set the discount and choose whether it applies to all products, selected products, or selected categories.
            </p>
            <form id="admin-offer-form" onSubmit={handleSubmit}>
              <label className="ad-field">
                Offer Name *
                <input
                  className="ad-input"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Summer Shirt Sale"
                  required
                  maxLength={150}
                />
              </label>

              <label className="ad-field">
                Description
                <textarea
                  className="ad-textarea"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="Describe this promotion..."
                  rows={3}
                />
              </label>

              <div className="ad-form-grid">
                <label className="ad-field">
                  Discount Type *
                  <select
                    className="ad-select"
                    name="discount_type"
                    value={form.discount_type}
                    onChange={handleChange}
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed amount (₹)</option>
                  </select>
                </label>

                <label className="ad-field">
                  Discount Value *
                  <input
                    className="ad-input"
                    name="discount_value"
                    type="number"
                    min="0.01"
                    max={
                      form.discount_type === "percentage"
                        ? "100"
                        : undefined
                    }
                    step="0.01"
                    value={form.discount_value}
                    onChange={handleChange}
                    required
                  />
                </label>

                <label className="ad-field">
                  Applies To
                  <select
                    className="ad-select"
                    name="applies_to"
                    value={form.applies_to}
                    onChange={(event) => {
                      setForm((previous) => ({
                        ...previous,
                        applies_to: event.target.value,
                        target_ids: [],
                      }));
                      setTargetSearch("");
                    }}
                  >
                    <option value="all">All Products</option>
                    <option value="products">Selected Products</option>
                    <option value="categories">Selected Categories</option>
                  </select>
                </label>

                {form.applies_to !== "all" && (
                  <div className="ad-field offer-target-field">
                    <div className="offer-target-heading">
                      <span>{form.applies_to === "products" ? "Products *" : "Categories *"}</span>
                      <span>{form.target_ids.length} selected</span>
                    </div>
                    <input
                      className="ad-input"
                      type="search"
                      value={targetSearch}
                      onChange={(event) => setTargetSearch(event.target.value)}
                      placeholder={form.applies_to === "products" ? "Search products..." : "Search categories..."}
                      aria-label={form.applies_to === "products" ? "Search products to include" : "Search categories to include"}
                    />
                    <div className="offer-target-list" role="group" aria-label={form.applies_to === "products" ? "Products included in offer" : "Categories included in offer"}>
                      {targetsLoading ? (
                        <p className="offer-target-message">Loading options...</p>
                      ) : targetsError ? (
                        <p className="offer-target-message error">{targetsError}</p>
                      ) : filteredTargetOptions.length ? (
                        filteredTargetOptions.map((item) => (
                          <label className="offer-target-option" key={item.id}>
                            <input
                              className="ad-check"
                              type="checkbox"
                              checked={form.target_ids.includes(String(item.id))}
                              onChange={(event) => toggleTarget(item.id, event.target.checked)}
                            />
                            <span>{item.name}{item.sku ? ` · ${item.sku}` : ""}</span>
                          </label>
                        ))
                      ) : (
                        <p className="offer-target-message">No matching options.</p>
                      )}
                    </div>
                  </div>
                )}

                <label className="ad-field">
                  Start Date and Time *
                  <input
                    className="ad-input"
                    type="datetime-local"
                    name="start_date"
                    value={form.start_date}
                    onChange={handleChange}
                    required
                  />
                </label>

                <label className="ad-field">
                  End Date and Time *
                  <input
                    className="ad-input"
                    type="datetime-local"
                    name="end_date"
                    value={form.end_date}
                    onChange={handleChange}
                    required
                  />
                </label>
              </div>

              <label className="ad-check-row">
                <input className="ad-check"
                  type="checkbox"
                  name="is_active"
                  checked={form.is_active}
                  onChange={handleChange}
                />
                Offer is enabled
              </label>

              {error && <div className="ad-alert" role="alert">{error}</div>}
            </form>
        </Modal>
      )}
      {offerToDelete && (
        <ConfirmationDialog
          title="Delete offer?"
          message={`Delete "${offerToDelete.name}"? This action cannot be undone.`}
          confirmLabel="Delete offer"
          busy={deletingOffer}
          error={deleteError}
          onConfirm={confirmDeleteOffer}
          onClose={() => {
            setOfferToDelete(null);
            setDeleteError("");
          }}
        />
      )}
    </div>
  );
}

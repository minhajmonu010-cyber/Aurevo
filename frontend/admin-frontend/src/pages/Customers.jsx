import { useCallback, useEffect, useState } from "react";
import { getAdminCustomer, getAdminCustomers, updateAdminCustomer } from "../api/admin";
import Icon from "../components/Icon";
import { EmptyState, ErrorNote, Modal, Pagination, Pill, Skeleton, StatCard } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { downloadCsv, formatDate, formatWhen, initials } from "../utils/format";
import { useDebounced } from "../utils/hooks";

const PAGE_SIZE = 6;
const STATUS_TONE = { pending: "warn", processing: "info", shipped: "purple", delivered: "ok", cancelled: "muted", returned: "bad" };
const PAYMENT_TONE = { pending: "warn", paid: "ok", failed: "bad", refunded: "muted" };

function formatPrice(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1) : "Unknown";
}

export default function Customers() {
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [summary, setSummary] = useState({});
  const [search, setSearch] = useState("");
  const query = useDebounced(search);
  const [statusFilter, setStatusFilter] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [statusCustomer, setStatusCustomer] = useState(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await getAdminCustomers({
        search: query.trim(),
        status: statusFilter,
        start,
        end,
        sort,
        page,
        page_size: PAGE_SIZE,
      });
      setCustomers(data.results || []);
      setCount(data.count || 0);
      setSummary(data.summary || {});
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to load customers. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [query, statusFilter, start, end, sort, page]);

  useEffect(() => {
    // This effect synchronizes query changes with an asynchronous API request.
    void Promise.resolve().then(loadCustomers);
  }, [loadCustomers, refresh]);

  const filtersActive = Boolean(query || statusFilter !== "all" || start || end);

  async function openCustomer(customer) {
    setSelectedCustomer(customer);
    setDetailLoading(true);
    setDetailError("");
    try {
      setSelectedCustomer(await getAdminCustomer(customer.id));
    } catch (requestError) {
      setDetailError(requestError.response?.data?.detail || "Unable to load customer details.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function exportCustomers() {
    setExporting(true);
    try {
      const allCustomers = [];
      const filters = { search: query.trim(), status: statusFilter, start, end, sort, page_size: 100 };
      const pages = Math.max(1, Math.ceil(count / 100));
      for (let currentPage = 1; currentPage <= pages; currentPage += 1) {
        const data = await getAdminCustomers({ ...filters, page: currentPage });
        allCustomers.push(...data.results);
      }
      downloadCsv("customers.csv", [
        ["Name", "Email", "Phone", "Joined", "Active", "Verified", "Orders", "Paid spend", "Last order"],
        ...allCustomers.map((customer) => [
          customer.name,
          customer.email,
          customer.phone,
          customer.date_joined,
          customer.is_active ? "Yes" : "No",
          customer.is_verified ? "Yes" : "No",
          customer.total_orders,
          customer.total_spent,
          customer.last_order,
        ]),
      ]);
      toast.show(`${allCustomers.length} customers exported.`, "ok");
    } catch (requestError) {
      toast.show(requestError.response?.data?.detail || "Unable to export customers.", "bad");
    } finally {
      setExporting(false);
    }
  }

  async function confirmStatusChange() {
    if (!statusCustomer) return;
    setStatusSaving(true);
    try {
      const data = await updateAdminCustomer(statusCustomer.id, { is_active: !statusCustomer.is_active });
      toast.show(data.message || "Customer status updated.", "ok");
      setStatusCustomer(null);
      if (selectedCustomer?.id === data.customer.id) {
        setSelectedCustomer((current) => ({ ...current, ...data.customer, orders: current.orders || [] }));
      }
      setRefresh((value) => value + 1);
    } catch (requestError) {
      toast.show(requestError.response?.data?.detail || "Unable to update customer status.", "bad");
    } finally {
      setStatusSaving(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setStart("");
    setEnd("");
    setSort("newest");
    setPage(1);
  }

  return (
    <>
      <div className="ad-crumbs">Commerce / <b>Customer directory</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Customers</h1>
          <p className="ad-sub">Understand your customer base, purchase activity, and account status.</p>
        </div>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
          <button type="button" className="ad-btn primary" onClick={exportCustomers} disabled={loading || exporting || count === 0}>
            <Icon name="download" size={15} /> {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </div>

      <section className="ad-stats admin-customer-stats">
        <StatCard label="Total Customers" value={summary.total ?? 0} icon="users" accent foot="registered accounts" />
        <StatCard label="Active Accounts" value={summary.active ?? 0} icon="circle-check" foot="can sign in" />
        <StatCard label="Verified" value={summary.verified ?? 0} icon="shield-check" foot="email verified" />
        <StatCard label="Repeat Buyers" value={summary.repeat ?? 0} icon="trending-up" foot="placed 2+ orders" />
      </section>

      <section className="ad-toolbar admin-customer-toolbar" aria-label="Customer filters">
        <div className="ad-search admin-customer-search">
          <Icon name="search" size={16} />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, email or phone..." aria-label="Search customers" />
          {search && <button type="button" className="ad-link" onClick={() => setSearch("")} aria-label="Clear search"><Icon name="x" size={14} /></button>}
        </div>
        <label className="admin-customer-filter">
          <span className="ad-label">Account</span>
          <select className="ad-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} aria-label="Customer account status">
            <option value="all">All customers</option>
            <option value="active">Active accounts</option>
            <option value="inactive">Inactive accounts</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
          </select>
        </label>
        <label className="admin-customer-filter admin-customer-date">
          <span className="ad-label">Joined from</span>
          <input className="ad-input" type="date" value={start} max={end || undefined} onChange={(event) => { setStart(event.target.value); setPage(1); }} aria-label="Joined from" />
        </label>
        <label className="admin-customer-filter admin-customer-date">
          <span className="ad-label">Joined to</span>
          <input className="ad-input" type="date" value={end} min={start || undefined} onChange={(event) => { setEnd(event.target.value); setPage(1); }} aria-label="Joined to" />
        </label>
        <label className="admin-customer-filter admin-customer-sort">
          <span className="ad-label">Sort by</span>
          <select className="ad-select" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} aria-label="Sort customers">
            <option value="newest">Recently joined</option>
            <option value="oldest">Joined earliest</option>
            <option value="name">Name A–Z</option>
            <option value="orders">Most orders</option>
            <option value="spend">Highest spend</option>
          </select>
        </label>
        {filtersActive && <button type="button" className="ad-link admin-customer-clear" onClick={clearFilters}>Clear filters</button>}
      </section>

      <section className="ad-card admin-customer-table-card" aria-label="Customer list">
        <div className="ad-card-pad admin-customer-table-heading">
          <div className="ad-card-head">
            <div>
              <h3>Customer directory</h3>
              <p className="ad-hint">{count.toLocaleString("en-IN")} {count === 1 ? "customer" : "customers"}{filtersActive ? " match your filters" : " total"}</p>
            </div>
            <Pill tone="purple">Customer accounts</Pill>
          </div>
        </div>
        {loading ? (
          <div className="admin-customer-loading"><Skeleton rows={5} /></div>
        ) : error ? (
          <ErrorNote error={{ response: { data: { detail: error } } }} onRetry={loadCustomers} />
        ) : customers.length === 0 ? (
          <EmptyState icon="users" title={filtersActive ? "No customers match these filters" : "No customers yet"}>
            {filtersActive ? "Try changing your search or filters." : "Registered customers will appear here."}
          </EmptyState>
        ) : (
          <>
            <div className="admin-customer-table-scroll">
              <table className="ad-table admin-customer-table">
                <thead>
                  <tr><th>Customer</th><th>Contact</th><th>Joined</th><th>Orders</th><th>Paid spend</th><th>Account</th><th>Verification</th><th className="right">Actions</th></tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <div className="ad-cell">
                          <span className="admin-customer-avatar">{initials(customer.name)}</span>
                          <div className="admin-customer-name">
                            <b>{customer.name}</b>
                            <span className="ad-cell-sub">Customer #{customer.id}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="admin-customer-contact">
                          <span>{customer.email || "—"}</span>
                          <small>{customer.phone || "No phone number"}</small>
                        </div>
                      </td>
                      <td className="ad-muted">{formatDate(customer.date_joined)}</td>
                      <td><b>{customer.total_orders ?? 0}</b></td>
                      <td><b>{formatPrice(customer.total_spent)}</b></td>
                      <td><Pill tone={customer.is_active ? "ok" : "muted"}>{customer.is_active ? "Active" : "Inactive"}</Pill></td>
                      <td><Pill tone={customer.is_verified ? "info" : "warn"}>{customer.is_verified ? "Verified" : "Unverified"}</Pill></td>
                      <td className="right">
                        <div className="admin-customer-row-actions">
                          <button type="button" className="ad-btn sm" onClick={() => openCustomer(customer)}><Icon name="external-link" size={13} /> Details</button>
                          <button
                            type="button"
                            className={`ad-btn sm${customer.is_active ? " outline-danger" : ""}`}
                            onClick={() => setStatusCustomer(customer)}
                          >
                            {customer.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} count={count} noun="customers" onChange={setPage} />
          </>
        )}
      </section>

      {selectedCustomer && (
        <Modal
          title={selectedCustomer.name || "Customer details"}
          eyebrow={`Customer #${selectedCustomer.id}`}
          width={760}
          onClose={() => !detailLoading && setSelectedCustomer(null)}
          footer={
            <>
              <button type="button" className="ad-btn ghost" onClick={() => setSelectedCustomer(null)} disabled={detailLoading}>Close</button>
              <button type="button" className={selectedCustomer.is_active ? "ad-btn outline-danger" : "ad-btn primary"} onClick={() => setStatusCustomer(selectedCustomer)} disabled={detailLoading}>
                {selectedCustomer.is_active ? "Deactivate account" : "Activate account"}
              </button>
            </>
          }
        >
          {detailLoading ? <Skeleton rows={4} /> : detailError ? (
            <div className="ad-alert" role="alert">{detailError}<button type="button" className="ad-link" onClick={() => openCustomer(selectedCustomer)}>Retry</button></div>
          ) : (
            <div className="admin-customer-detail">
              <div className="admin-customer-detail-hero">
                <span className="admin-customer-avatar large">{initials(selectedCustomer.name)}</span>
                <div>
                  <h3>{selectedCustomer.name}</h3>
                  <span>{selectedCustomer.email}</span>
                  <div className="admin-customer-detail-pills">
                    <Pill tone={selectedCustomer.is_active ? "ok" : "muted"}>{selectedCustomer.is_active ? "Active account" : "Inactive account"}</Pill>
                    <Pill tone={selectedCustomer.is_verified ? "info" : "warn"}>{selectedCustomer.is_verified ? "Verified" : "Unverified"}</Pill>
                  </div>
                </div>
              </div>
              <div className="admin-customer-detail-stats">
                <div><span className="ad-eyebrow">Total orders</span><b>{selectedCustomer.total_orders ?? 0}</b></div>
                <div><span className="ad-eyebrow">Paid spend</span><b>{formatPrice(selectedCustomer.total_spent)}</b></div>
                <div><span className="ad-eyebrow">Wallet balance</span><b>{formatPrice(selectedCustomer.wallet_balance)}</b></div>
              </div>
              <div className="admin-customer-detail-info">
                <div><span>Email</span><b>{selectedCustomer.email || "—"}</b></div>
                <div><span>Phone</span><b>{selectedCustomer.phone || "Not provided"}</b></div>
                <div><span>Joined</span><b>{formatDate(selectedCustomer.date_joined)}</b></div>
                <div><span>Last order</span><b>{selectedCustomer.last_order ? formatWhen(selectedCustomer.last_order) : "No orders yet"}</b></div>
              </div>
              <section className="admin-customer-orders">
                <div className="ad-card-head">
                  <h3><Icon name="receipt" size={15} /> Recent orders</h3>
                  <span className="ad-hint">Latest 20</span>
                </div>
                {(selectedCustomer.orders || []).length ? (
                  <div className="admin-customer-orders-list">
                    {selectedCustomer.orders.map((order) => (
                      <div className="admin-customer-order-row" key={order.id}>
                        <div><b>#{order.order_number}</b><span>{order.created_at ? formatWhen(order.created_at) : "—"} · {order.item_count} items</span></div>
                        <Pill tone={PAYMENT_TONE[order.payment_status] || "muted"}>{titleCase(order.payment_status)}</Pill>
                        <Pill tone={STATUS_TONE[order.order_status] || "muted"}>{titleCase(order.order_status)}</Pill>
                        <b>{formatPrice(order.total_amount)}</b>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState icon="receipt" title="No orders yet">This customer has not placed an order.</EmptyState>}
              </section>
            </div>
          )}
        </Modal>
      )}

      {statusCustomer && (
        <Modal
          title={`${statusCustomer.is_active ? "Deactivate" : "Activate"} customer?`}
          width={440}
          onClose={() => !statusSaving && setStatusCustomer(null)}
          footer={
            <>
              <button type="button" className="ad-btn ghost" onClick={() => setStatusCustomer(null)} disabled={statusSaving}>Cancel</button>
              <button type="button" className={statusCustomer.is_active ? "ad-btn danger" : "ad-btn primary"} onClick={confirmStatusChange} disabled={statusSaving}>
                {statusSaving ? "Updating..." : statusCustomer.is_active ? "Deactivate account" : "Activate account"}
              </button>
            </>
          }
        >
          <p className="ad-modal-text">
            {statusCustomer.is_active
              ? `${statusCustomer.name} will no longer be able to sign in. Their order history will be preserved.`
              : `${statusCustomer.name} will be able to sign in to their account again.`}
          </p>
        </Modal>
      )}
    </>
  );
}

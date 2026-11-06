import { useCallback, useEffect, useState } from "react";
import {
  getAdminReturns,
  updateAdminReturnStatus,
} from "../api/admin";
import Icon from "../components/Icon";
import { EmptyState, ErrorNote, Modal, Pagination, Pill, Skeleton, StatCard } from "../components/ui";
import { downloadCsv, formatNumber, formatWhen, initials } from "../utils/format";
import { useDebounced } from "../utils/hooks";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 20;
const STATUS_TONE = { requested: "warn", approved: "ok", rejected: "bad" };

export default function Returns() {
  const toast = useToast();
  const [returns, setReturns] = useState([]);
  const [summary, setSummary] = useState({ total: 0, requested: 0, approved: 0, rejected: 0 });
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim());
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [selectedReturn, setSelectedReturn] = useState(null);

  const loadReturns = useCallback(async () => {
    try {
      const data = await getAdminReturns({
        search: query,
        status: statusFilter,
        page,
      });

      setReturns(data.results || []);
      setCount(data.count || 0);
      setSummary(data.summary || { total: data.count || 0, requested: 0, approved: 0, rejected: 0 });
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          "Unable to load return requests."
      );
    } finally {
      setLoading(false);
    }
  }, [query, statusFilter, page]);

  useEffect(() => {
    // This effect synchronizes query changes with an asynchronous API request.
    void Promise.resolve().then(loadReturns);
  }, [loadReturns]);

  async function changeStatus(returnId, newStatus) {
    const returnRequest = returns.find((item) => item.id === returnId);
    setUpdatingId(returnId);
    setActionError("");

    try {
      await updateAdminReturnStatus(returnId, newStatus);
      await loadReturns();
      setSelectedReturn(null);
      toast.show(
        newStatus === "approved"
          ? `${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(returnRequest?.refund_amount || 0))} added to the customer's wallet.`
          : "Return rejected.",
        "ok"
      );
    } catch (err) {
      setActionError(
        err?.response?.data?.detail ||
          "Unable to update return status."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  const exportReturns = async () => {
    setExporting(true);
    setError("");
    try {
      const allReturns = [];
      const totalPages = Math.ceil(count / PAGE_SIZE);
      for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
        const data = await getAdminReturns({ search: query, status: statusFilter, page: currentPage });
        allReturns.push(...data.results);
      }
      downloadCsv("returns.csv", [
        ["Order", "Product", "SKU", "Size", "Color", "Quantity", "Customer", "Email", "Reason", "Refund amount", "Requested on", "Status"],
        ...allReturns.map((item) => [item.order_number, item.item_product_name, item.item_sku, item.item_size, item.item_color, item.item_quantity, item.customer_name, item.customer_email, item.reason, item.refund_amount, item.created_at, item.status]),
      ]);
    } catch (err) {
      setError(err?.response?.data?.detail || "Unable to export return requests.");
    } finally {
      setExporting(false);
    }
  };

  const filtersActive = Boolean(query || statusFilter);

  return (
    <>
      <div className="ad-crumbs">Commerce / <b>Returns</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Returns</h1>
          <p className="ad-sub">Review customer requests and track refund decisions.</p>
        </div>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={loadReturns} disabled={loading}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
          <button type="button" className="ad-btn primary" onClick={exportReturns} disabled={loading || exporting || count === 0}>
            <Icon name="download" size={15} /> {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </div>

      <section className="ad-stats admin-return-stats">
        <StatCard label="All requests" value={loading ? "…" : formatNumber(summary.total ?? count)} icon="undo" accent foot="all return requests" />
        <StatCard label="Needs review" value={loading ? "…" : formatNumber(summary.requested ?? 0)} icon="clock" deltaTone="warn" foot="awaiting a decision" />
        <StatCard label="Approved" value={loading ? "…" : formatNumber(summary.approved ?? 0)} icon="circle-check" foot="approved requests" />
        <StatCard label="Rejected" value={loading ? "…" : formatNumber(summary.rejected ?? 0)} icon="x" foot="declined requests" />
      </section>

      <section className="ad-toolbar admin-returns-toolbar" aria-label="Return filters">
        <div className="ad-search admin-returns-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Search order, customer, email, or reason..."
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            aria-label="Search returns"
          />
          {search && <button type="button" className="ad-link" onClick={() => { setSearch(""); setPage(1); }} aria-label="Clear search"><Icon name="x" size={14} /></button>}
        </div>
        <label className="admin-returns-filter">
          <span className="ad-label">Status</span>
          <select className="ad-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} aria-label="Return status">
            <option value="">All statuses</option>
            <option value="requested">Requested</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        {filtersActive && <button type="button" className="ad-link" onClick={() => { setSearch(""); setStatusFilter(""); setPage(1); }}>Clear filters</button>}
      </section>

      {error && <div className="ad-alert" role="alert">{error}<button type="button" className="ad-link" onClick={loadReturns}>Try again</button></div>}

      <section className="ad-card admin-returns-card" aria-label="Return requests">
        <div className="ad-card-pad">
          <div className="ad-card-head">
            <div>
              <h3>Return requests</h3>
              <p className="ad-hint">{formatNumber(count)} {count === 1 ? "request" : "requests"}{filtersActive ? " match your filters" : " in your store"}</p>
            </div>
            <Pill tone="warn">{formatNumber(summary.requested ?? 0)} awaiting review</Pill>
          </div>
        </div>
        {loading ? (
          <div className="admin-returns-loading"><Skeleton rows={5} /></div>
        ) : error && returns.length === 0 ? (
          <ErrorNote error={{ response: { data: { detail: error } } }} onRetry={loadReturns} />
        ) : returns.length === 0 ? (
          <EmptyState icon="undo" title={filtersActive ? "No requests match these filters" : "No return requests yet"}>
            {filtersActive ? "Try changing your search or status filter." : "Customer return requests will appear here."}
          </EmptyState>
        ) : (
          <>
            <div className="admin-returns-table-scroll">
              <table className="ad-table admin-returns-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Product</th>
                  <th>Customer</th>
                  <th>Reason</th>
                  <th>Refund amount</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th className="right">Review</th>
                </tr>
              </thead>

              <tbody>
                {returns.map((item) => (
                  <tr key={item.id}>
                    <td><span className="ad-order-id">#{item.order_number || item.order}</span></td>
                    <td>
                      <b>{item.item_product_name || "Legacy whole-order return"}</b>
                      {item.item_product_name && (
                        <span className="ad-cell-sub">
                          {[item.item_sku, item.item_size, item.item_color, item.item_quantity ? `Qty ${item.item_quantity}` : ""].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="ad-cell">
                        <span className="ad-initials">{initials(item.customer_name || "Customer")}</span>
                        <div className="admin-return-customer"><b>{item.customer_name || "Customer"}</b><span className="ad-cell-sub">{item.customer_email || "Guest customer"}</span></div>
                      </div>
                    </td>
                    <td><span className="admin-return-reason" title={item.reason}>{item.reason || "Not specified"}</span></td>
                    <td><b>{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(item.refund_amount || 0))}</b></td>
                    <td className="ad-muted">{formatWhen(item.created_at)}</td>
                    <td><Pill tone={STATUS_TONE[item.status] || "muted"}>{item.status}</Pill></td>
                    <td className="right"><button type="button" className="ad-btn sm" onClick={() => { setActionError(""); setSelectedReturn(item); }}><Icon name="external-link" size={13} /> Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            <Pagination page={page} pageSize={PAGE_SIZE} count={count} noun="return requests" onChange={setPage} />
          </>
        )}
      </section>

      {selectedReturn && (
        <Modal
          title={`Return #${selectedReturn.order_number || selectedReturn.order}`}
          eyebrow="Return review"
          width={560}
          onClose={() => setSelectedReturn(null)}
          locked={updatingId === selectedReturn.id}
          footer={(
            <>
              <button type="button" className="ad-btn ghost" onClick={() => setSelectedReturn(null)} disabled={updatingId === selectedReturn.id}>Close</button>
              {selectedReturn.status === "requested" && <>
                <button type="button" className="ad-btn admin-return-reject" onClick={() => changeStatus(selectedReturn.id, "rejected")} disabled={updatingId === selectedReturn.id}>
                  <Icon name="x" size={14} /> {updatingId === selectedReturn.id ? "Updating..." : "Reject"}
                </button>
                <button type="button" className="ad-btn primary" onClick={() => changeStatus(selectedReturn.id, "approved")} disabled={updatingId === selectedReturn.id}>
                  <Icon name="check" size={14} /> {updatingId === selectedReturn.id ? "Updating..." : "Approve return"}
                </button>
              </>}
            </>
          )}
        >
          {actionError && <ErrorNote error={{ response: { data: { detail: actionError } } }} />}
          <dl className="admin-return-details">
            <div><dt>Customer</dt><dd>{selectedReturn.customer_name || "Customer"}{selectedReturn.customer_email && <small>{selectedReturn.customer_email}</small>}</dd></div>
            <div><dt>Product</dt><dd>{selectedReturn.item_product_name || "Legacy whole-order return"}{selectedReturn.item_product_name && <small>{[selectedReturn.item_sku, selectedReturn.item_size, selectedReturn.item_color, selectedReturn.item_quantity ? `Quantity ${selectedReturn.item_quantity}` : ""].filter(Boolean).join(" · ")}</small>}</dd></div>
            <div><dt>Requested refund</dt><dd><b>{new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(selectedReturn.refund_amount || 0))}</b></dd></div>
            <div><dt>Requested</dt><dd>{formatWhen(selectedReturn.created_at)}</dd></div>
            <div><dt>Status</dt><dd><Pill tone={STATUS_TONE[selectedReturn.status] || "muted"}>{selectedReturn.status}</Pill></dd></div>
            <div className="reason"><dt>Reason</dt><dd>{selectedReturn.reason || "Not specified"}</dd></div>
          </dl>
        </Modal>
      )}
    </>
  );
}
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkAdminOrderRefundStatus,
  creditAdminOrderRefundToWallet,
  getAdminOrder,
  getAdminOrders,
  updateAdminOrderStatus,
} from "../api/admin";
import { useSearchParams } from "react-router-dom";
import ConfirmationDialog from "../components/ConfirmationDialog";
import Icon from "../components/Icon";
import { EmptyState, ErrorNote, Modal, Pagination, Pill, Skeleton, StatCard } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { downloadCsv, formatDate, formatWhen, initials } from "../utils/format";
import { useDebounced } from "../utils/hooks";

const PAGE_SIZE = 6;
const STATUSES = [
  ["pending", "Pending"],
  ["processing", "Processing"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
  ["returned", "Returned"],
];
const PAYMENT_STATUSES = [["pending", "Pending"], ["paid", "Paid"], ["failed", "Failed"], ["refund_pending", "Refund pending"], ["refunded", "Refunded"]];
const STATUS_TONE = { pending: "warn", processing: "info", shipped: "purple", delivered: "ok", cancelled: "muted", returned: "bad" };
const PAYMENT_TONE = { pending: "warn", paid: "ok", failed: "bad", refund_pending: "warn", refunded: "muted" };

function formatPrice(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function statusLabel(status) {
  const label = status?.replaceAll("_", " ");
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Unknown";
}

function addressLines(address) {
  if (!address || typeof address !== "object") return [];
  return Object.entries(address)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .filter(([key]) => !["id", "user", "is_default", "created_at", "updated_at"].includes(key))
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`);
}

export default function Orders() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedOrderId = searchParams.get("order");
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({});
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");
  const [trackingDraft, setTrackingDraft] = useState("");
  const [deliveryDraft, setDeliveryDraft] = useState("");
  const [refundToWallet, setRefundToWallet] = useState(false);
  const [refundActionLoading, setRefundActionLoading] = useState(false);
  const [confirmWalletRefund, setConfirmWalletRefund] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getAdminOrders({
        search: debouncedSearch.trim(),
        status: statusFilter,
        payment: paymentFilter,
        start,
        end,
        sort,
        page,
        page_size: PAGE_SIZE,
      });
      setOrders(data.results || []);
      setCount(data.count || 0);
      setSummary(data.summary || {});
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to load orders. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, paymentFilter, start, end, sort, page]);

  useEffect(() => {
    void Promise.resolve().then(loadOrders);
  }, [loadOrders, refresh]);

  useEffect(() => {
    if (!linkedOrderId) return undefined;
    const orderId = Number(linkedOrderId);
    if (!Number.isInteger(orderId) || orderId < 1) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("order");
        return next;
      }, { replace: true });
      return undefined;
    }

    let active = true;
    // The URL requests this order; initialize its modal while the detail request runs.
    // oxlint-disable-next-line react/set-state-in-effect
    setSelectedOrder({
      id: orderId,
      order_number: String(orderId),
      order_status: "pending",
      payment_status: "pending",
      customer_name: "",
      customer_email: "",
      created_at: "",
      shipping_address: {},
      items: [],
      payments: [],
      history: [],
      total_amount: 0,
      discount_amount: 0,
      shipping_charge: 0,
    });
    setDetailLoading(true);
    setDetailError("");
    getAdminOrder(orderId)
      .then((detail) => {
        if (!active) return;
        setSelectedOrder(detail);
        setStatusDraft(detail.order_status);
        setTrackingDraft(detail.tracking_id || "");
        setDeliveryDraft(detail.delivery_date || "");
        setRefundToWallet(false);
      })
      .catch((requestError) => {
        if (active) {
          setDetailError(requestError.response?.data?.detail || "Could not load order details.");
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });

    return () => { active = false; };
  }, [linkedOrderId, setSearchParams]);

  const filtersActive = Boolean(debouncedSearch || statusFilter || paymentFilter || start || end);

  const openOrder = async (order) => {
    setSelectedOrder({ ...order, _loading: true });
    setDetailLoading(true);
    setDetailError("");
    try {
      const detail = await getAdminOrder(order.id);
      setSelectedOrder(detail);
      setStatusDraft(detail.order_status);
      setTrackingDraft(detail.tracking_id || "");
      setDeliveryDraft(detail.delivery_date || "");
      setRefundToWallet(false);
    } catch (requestError) {
      setDetailError(requestError.response?.data?.detail || "Could not load order details.");
      setSelectedOrder(order);
      setStatusDraft(order.order_status);
      setTrackingDraft(order.tracking_id || "");
      setDeliveryDraft(order.delivery_date || "");
      setRefundToWallet(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeOrder = () => {
    if (!saving) {
      setSelectedOrder(null);
      setDetailError("");
      if (linkedOrderId) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.delete("order");
          return next;
        }, { replace: true });
      }
    }
  };

  const saveOrder = async (event) => {
    event.preventDefault();
    if (!selectedOrder) return;
    setSaving(true);
    setDetailError("");
    try {
      const result = await updateAdminOrderStatus(selectedOrder.id, {
        status: statusDraft,
        tracking_id: trackingDraft,
        delivery_date: deliveryDraft || null,
        refund_to_wallet: refundToWallet,
      });
      setSelectedOrder(result.order);
      setStatusDraft(result.order.order_status);
      setTrackingDraft(result.order.tracking_id || "");
      setDeliveryDraft(result.order.delivery_date || "");
      setRefundToWallet(false);
      toast.show(
        result.refund
          ? `Order cancelled. ${formatPrice(result.refund.amount)} added to the customer's wallet.`
          : "Order updated successfully.",
        "ok"
      );
      setRefresh((value) => value + 1);
    } catch (requestError) {
      setDetailError(requestError.response?.data?.detail || "Could not update the order. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const checkRefundStatus = async () => {
    if (!selectedOrder) return;
    setRefundActionLoading(true);
    setDetailError("");
    try {
      const result = await checkAdminOrderRefundStatus(selectedOrder.id);
      setSelectedOrder(await getAdminOrder(selectedOrder.id));
      setRefresh((value) => value + 1);
      toast.show(result.message, result.provider_status === "failed" ? "warn" : "ok");
    } catch (requestError) {
      setDetailError(requestError.response?.data?.detail || "Could not check the Razorpay refund status.");
    } finally {
      setRefundActionLoading(false);
    }
  };

  const creditRefundToWallet = async () => {
    if (!selectedOrder) return;
    const payment = selectedOrder.payments?.find((entry) =>
      ["paid", "refund_pending"].includes(entry.payment_status)
    );
    if (!payment) return;
    const amount = Number(payment.amount)
      - Number(payment.refunded_amount || 0)
      + Number(payment.pending_refund_amount || 0);
    if (amount <= 0) return;

    setRefundActionLoading(true);
    setDetailError("");
    try {
      const result = await creditAdminOrderRefundToWallet(selectedOrder.id);
      setConfirmWalletRefund(false);
      setSelectedOrder(result.order);
      toast.show(`${formatPrice(result.refund.amount)} credited to the customer's wallet.`, "ok");
      setRefresh((value) => value + 1);
    } catch (requestError) {
      setDetailError(requestError.response?.data?.detail || "Could not credit the wallet refund.");
    } finally {
      setRefundActionLoading(false);
    }
  };

  const exportOrders = async () => {
    try {
      const allOrders = [];
      const exportFilters = {
        search: debouncedSearch.trim(),
        status: statusFilter,
        payment: paymentFilter,
        start,
        end,
        sort,
        page_size: 100,
      };
      const pages = Math.max(1, Math.ceil(count / 100));
      for (let currentPage = 1; currentPage <= pages; currentPage += 1) {
        const data = await getAdminOrders({ ...exportFilters, page: currentPage });
        allOrders.push(...data.results);
      }
      downloadCsv("orders.csv", [
        ["Order", "Customer", "Email", "Date", "Items", "Total", "Order status", "Payment status", "Payment method", "Tracking ID"],
        ...allOrders.map((order) => [
          order.order_number,
          order.customer_name,
          order.customer_email,
          order.created_at,
          order.item_count,
          order.total_amount,
          order.order_status,
          order.payment_status,
          order.payment_method,
          order.tracking_id,
        ]),
      ]);
    } catch (requestError) {
      toast.show(requestError.response?.data?.detail || "Could not export orders.", "bad");
    }
  };

  const detailItemsTotal = useMemo(
    () => (selectedOrder?.items || []).reduce((total, item) => total + Number(item.quantity || 0), 0),
    [selectedOrder]
  );
  const walletRefundPayment = selectedOrder?.payments?.find((payment) =>
    ["paid", "refund_pending"].includes(payment.payment_status)
  );
  const walletRefundAmount = walletRefundPayment
    ? Number(walletRefundPayment.amount)
      - Number(walletRefundPayment.refunded_amount || 0)
      + Number(walletRefundPayment.pending_refund_amount || 0)
    : 0;

  return (
    <>
      <div className="ad-crumbs">Commerce / <b>Order management</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Orders</h1>
          <p className="ad-sub">Track fulfillment, review payments, and keep every customer order moving.</p>
        </div>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
          <button type="button" className="ad-btn primary" onClick={exportOrders} disabled={loading || count === 0}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        </div>
      </div>

      <section className="ad-stats admin-order-stats">
        <StatCard label="All Orders" value={summary.total ?? 0} icon="receipt" accent foot="all-time orders" />
        <StatCard label="Pending" value={summary.pending ?? 0} icon="clock" deltaTone="warn" foot="awaiting processing" />
        <StatCard label="Processing" value={summary.processing ?? 0} icon="refresh" foot="being prepared" />
        <StatCard label="Shipped" value={summary.shipped ?? 0} icon="package" foot="on the way" />
      </section>

      <section className="ad-toolbar admin-orders-toolbar" aria-label="Order filters">
        <div className="ad-search admin-orders-search">
          <Icon name="search" size={16} />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search order, customer or email..." aria-label="Search orders" />
          {search && <button type="button" className="ad-link" onClick={() => setSearch("")} aria-label="Clear search"><Icon name="x" size={14} /></button>}
        </div>
        <label className="admin-orders-filter">
          <span className="ad-label">Order status</span>
          <select className="ad-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} aria-label="Order status">
            <option value="">All statuses</option>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="admin-orders-filter">
          <span className="ad-label">Payment</span>
          <select className="ad-select" value={paymentFilter} onChange={(event) => { setPaymentFilter(event.target.value); setPage(1); }} aria-label="Payment status">
            <option value="">All payments</option>
            {PAYMENT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="admin-orders-filter admin-orders-date">
          <span className="ad-label">From</span>
          <input className="ad-input" type="date" value={start} max={end || undefined} onChange={(event) => { setStart(event.target.value); setPage(1); }} aria-label="Start date" />
        </label>
        <label className="admin-orders-filter admin-orders-date">
          <span className="ad-label">To</span>
          <input className="ad-input" type="date" value={end} min={start || undefined} onChange={(event) => { setEnd(event.target.value); setPage(1); }} aria-label="End date" />
        </label>
        <label className="admin-orders-filter admin-orders-sort">
          <span className="ad-label">Sort by</span>
          <select className="ad-select" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} aria-label="Sort orders">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount_desc">Amount: high to low</option>
            <option value="amount_asc">Amount: low to high</option>
          </select>
        </label>
        {filtersActive && <button type="button" className="ad-link admin-orders-clear" onClick={() => { setSearch(""); setStatusFilter(""); setPaymentFilter(""); setStart(""); setEnd(""); setSort("newest"); setPage(1); }}>Clear filters</button>}
      </section>

      {error && <div className="ad-alert" role="alert">{error}<button type="button" className="ad-link" onClick={loadOrders}>Try again</button></div>}

      <section className="ad-card admin-orders-table-card" aria-label="Orders">
        <div className="ad-card-pad admin-orders-table-heading">
          <div>
            <div className="ad-card-head">
              <div>
                <h3>Order list</h3>
                <p className="ad-hint">{count.toLocaleString("en-IN")} {count === 1 ? "order" : "orders"}{filtersActive ? " match your filters" : " in your store"}</p>
              </div>
              <Pill tone="purple">Live order data</Pill>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="admin-orders-loading"><Skeleton rows={5} /></div>
        ) : error ? (
          <ErrorNote error={{ response: { data: { detail: error } } }} onRetry={loadOrders} />
        ) : orders.length === 0 ? (
          <EmptyState icon="receipt" title={filtersActive ? "No orders match these filters" : "No orders yet"}>
            {filtersActive ? "Try changing the search or filters." : "Customer orders will appear here when they check out."}
          </EmptyState>
        ) : (
          <>
            <div className="admin-orders-table-scroll">
              <table className="ad-table admin-orders-table">
                <thead>
                  <tr>
                    <th>Order</th><th>Customer</th><th>Date</th><th>Items</th><th className="right">Total</th><th>Payment</th><th>Status</th><th className="right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td><span className="ad-order-id">#{order.order_number}</span></td>
                      <td>
                        <div className="ad-cell">
                          <span className="ad-initials">{initials(order.customer_name)}</span>
                          <div className="admin-order-customer">
                            <b>{order.customer_name}</b>
                            <span className="ad-cell-sub">{order.customer_email || "Guest checkout"}</span>
                          </div>
                        </div>
                      </td>
                      <td className="ad-muted">{formatWhen(order.created_at)}</td>
                      <td>{order.item_count ?? 0}</td>
                      <td className="right"><b>{formatPrice(order.total_amount)}</b></td>
                      <td><Pill tone={PAYMENT_TONE[order.payment_status] || "muted"}>{statusLabel(order.payment_status)}</Pill></td>
                      <td><Pill tone={STATUS_TONE[order.order_status] || "muted"}>{statusLabel(order.order_status)}</Pill></td>
                      <td className="right"><button type="button" className="ad-btn sm" onClick={() => openOrder(order)}><Icon name="external-link" size={13} /> View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} count={count} noun="orders" onChange={setPage} />
          </>
        )}
      </section>

      {selectedOrder && (
        <Modal
          title={`Order #${selectedOrder.order_number}`}
          eyebrow="Order details"
          width={760}
          onClose={closeOrder}
          locked={saving}
          footer={
            <>
              <button type="button" className="ad-btn ghost" onClick={closeOrder} disabled={saving}>Close</button>
              <button type="submit" form="admin-order-update-form" className="ad-btn primary" disabled={saving || detailLoading}>
                {saving ? "Saving..." : "Save fulfillment"}
              </button>
            </>
          }
        >
          {detailLoading ? <Skeleton rows={4} /> : (
            <div className="admin-order-detail">
              {detailError && <div className="ad-alert" role="alert">{detailError}</div>}
              <div className="admin-order-detail-summary">
                <div><span className="ad-eyebrow">Order total</span><strong>{formatPrice(selectedOrder.total_amount)}</strong></div>
                <div><span className="ad-eyebrow">Order status</span><Pill tone={STATUS_TONE[selectedOrder.order_status]}>{statusLabel(selectedOrder.order_status)}</Pill></div>
                <div><span className="ad-eyebrow">Payment</span><Pill tone={PAYMENT_TONE[selectedOrder.payment_status]}>{statusLabel(selectedOrder.payment_status)}</Pill></div>
              </div>

              <div className="admin-order-detail-grid">
                <section className="admin-order-detail-section">
                  <h3><Icon name="user" size={15} /> Customer</h3>
                  <b>{selectedOrder.customer_name}</b>
                  <span>{selectedOrder.customer_email || "Guest checkout"}</span>
                  <span>Placed {formatDate(selectedOrder.created_at)}</span>
                </section>
                <section className="admin-order-detail-section">
                  <h3><Icon name="map-pin" size={15} /> Shipping address</h3>
                  {addressLines(selectedOrder.shipping_address).length
                    ? addressLines(selectedOrder.shipping_address).map((line) => <span key={line}>{line}</span>)
                    : <span>No shipping address available.</span>}
                </section>
              </div>

              {selectedOrder.return_reason && (
                <section className="admin-order-detail-section">
                  <h3>Return reason</h3>
                  <span>{selectedOrder.return_reason}</span>
                </section>
              )}

              <section className="admin-order-detail-section admin-order-items">
                <h3><Icon name="package" size={15} /> Items <span className="ad-muted">({detailItemsTotal})</span></h3>
                {(selectedOrder.items || []).length ? selectedOrder.items.map((item) => (
                  <div className="admin-order-item" key={item.id}>
                    <div><b>{item.product_name}</b><span>{[item.sku, item.size, item.color].filter(Boolean).join(" · ")}</span></div>
                    <span>× {item.quantity}</span>
                    <b>{formatPrice(item.total_price)}</b>
                  </div>
                )) : <span>No item details available.</span>}
                <div className="admin-order-totals">
                  <span>Shipping <b>{formatPrice(selectedOrder.shipping_charge)}</b></span>
                  <span>Discount <b>−{formatPrice(selectedOrder.discount_amount)}</b></span>
                  <span className="total">Total <b>{formatPrice(selectedOrder.total_amount)}</b></span>
                </div>
              </section>

              <form id="admin-order-update-form" className="admin-order-fulfillment" onSubmit={saveOrder}>
                <div className="admin-order-fulfillment-heading">
                  <div><span className="ad-eyebrow">Fulfillment</span><h3>Update order</h3></div>
                  <span className="ad-hint">Status changes are added to order history.</span>
                </div>
                <div className="admin-order-fulfillment-fields">
                  <label className="ad-field">
                    <span className="ad-label">Status</span>
                    <select
                      className="ad-select"
                      value={statusDraft}
                      onChange={(event) => {
                        const nextStatus = event.target.value;
                        setStatusDraft(nextStatus);
                        setRefundToWallet(
                          nextStatus === "cancelled"
                          && selectedOrder.order_status !== "cancelled"
                          && selectedOrder.payment_status === "paid"
                        );
                      }}
                    >
                      {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="ad-field">
                    <span className="ad-label">Tracking ID</span>
                    <input className="ad-input" value={trackingDraft} maxLength={100} onChange={(event) => setTrackingDraft(event.target.value)} placeholder="Add tracking number" />
                  </label>
                  <label className="ad-field">
                    <span className="ad-label">Delivery date</span>
                    <input className="ad-input" type="date" value={deliveryDraft} onChange={(event) => setDeliveryDraft(event.target.value)} />
                  </label>
                </div>
                {statusDraft === "cancelled"
                  && selectedOrder.order_status !== "cancelled"
                  && selectedOrder.payment_status === "paid" && (
                  <label className="ad-check-row">
                    <input
                      type="checkbox"
                      className="ad-check"
                      checked={refundToWallet}
                      onChange={(event) => setRefundToWallet(event.target.checked)}
                    />
                    Credit {formatPrice(selectedOrder.total_amount)} to the customer wallet
                  </label>
                )}
              </form>

              {(selectedOrder.payments || []).length > 0 && (
                <section className="admin-order-detail-section admin-order-payment-history">
                  <h3><Icon name="wallet" size={15} /> Payment history</h3>
                  {selectedOrder.payments.map((payment) => (
                    <div className="admin-order-history-row" key={payment.id}>
                      <Pill tone={PAYMENT_TONE[payment.payment_status]}>{statusLabel(payment.payment_status)}</Pill>
                      <span>{payment.payment_method || selectedOrder.payment_method || "Payment"}</span>
                      <b>{formatPrice(payment.amount)}</b>
                      <span>{payment.created_at ? formatWhen(payment.created_at) : "—"}</span>
                    </div>
                  ))}
                  {selectedOrder.order_status === "cancelled"
                    && selectedOrder.payments.some((payment) => payment.payment_status === "refund_pending") && (
                    <div className="ad-actions" style={{ marginTop: 12 }}>
                      <p className="ad-hint">
                        Razorpay is still processing. You can check its status, or credit the wallet immediately.
                        If both refunds complete, the customer may receive the amount twice.
                      </p>
                      <button
                        type="button"
                        className="ad-btn"
                        onClick={checkRefundStatus}
                        disabled={refundActionLoading}
                      >
                        {refundActionLoading ? "Checking..." : "Check Razorpay refund"}
                      </button>
                      <button
                        type="button"
                        className="ad-btn primary"
                        onClick={creditRefundToWallet}
                        disabled={refundActionLoading}
                      >
                        {refundActionLoading ? "Refunding..." : "Refund to wallet now"}
                      </button>
                    </div>
                  )}
                  {selectedOrder.order_status === "cancelled"
                    && selectedOrder.payments.some((payment) =>
                      ["paid", "refund_pending"].includes(payment.payment_status)
                      && Number(payment.amount)
                        - Number(payment.refunded_amount || 0)
                        + Number(payment.pending_refund_amount || 0) > 0
                    )
                    && !selectedOrder.payments.some((payment) => payment.payment_status === "refund_pending")
                    && (
                    <div className="ad-actions" style={{ marginTop: 12 }}>
                      <p className="ad-hint">The remaining paid amount can be credited immediately.</p>
                      <button
                        type="button"
                        className="ad-btn primary"
                        onClick={creditRefundToWallet}
                        disabled={refundActionLoading}
                      >
                        {refundActionLoading ? "Refunding..." : "Refund to wallet"}
                      </button>
                    </div>
                  )}
                </section>
              )}

              {(selectedOrder.history || []).length > 0 && (
                <section className="admin-order-detail-section">
                  <h3><Icon name="history" size={15} /> Status history</h3>
                  <div className="admin-order-status-history">
                    {selectedOrder.history.map((entry, index) => (
                      <div className="admin-order-history-row" key={`${entry.status}-${entry.updated_at}-${index}`}>
                        <Pill tone={STATUS_TONE[entry.status]}>{statusLabel(entry.status)}</Pill>
                        <span>{entry.updated_at ? formatWhen(entry.updated_at) : "—"}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </Modal>
      )}
      {confirmWalletRefund && selectedOrder && (
        <ConfirmationDialog
          title="Refund to customer wallet?"
          message={`Credit ${formatPrice(walletRefundAmount)} to ${selectedOrder.customer_name}'s wallet now? This cannot be undone.${
            selectedOrder.payments?.some((payment) => payment.payment_status === "refund_pending")
              ? " Razorpay is still processing its refund. If it completes later, the customer may receive the amount twice."
              : ""
          }`}
          confirmLabel="Refund to wallet"
          busyLabel="Refunding..."
          icon="wallet"
          tone={undefined}
          confirmClassName="ad-btn primary"
          busy={refundActionLoading}
          error={detailError}
          onConfirm={creditRefundToWallet}
          onClose={() => {
            if (!refundActionLoading) {
              setConfirmWalletRefund(false);
              setDetailError("");
            }
          }}
        />
      )}
    </>
  );
}


import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getOrders, cancelOrder, returnOrder, submitOrderItemReview } from "../api/orders";
import AccountLayout from "../Components/AccountLayout";
import ConfirmDialog from "../Components/ConfirmDialog";
import { mediaUrl } from "../utils/media";
import "../styles/orders.css";

const money = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const date = (value) => {
  if (!value) return "Not available";

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Not available"
    : parsed.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

const dateTime = (value) => {
  if (!value) return "Not available";

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Not available"
    : parsed.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const readable = (value) =>
  String(value || "pending")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewRating, setReviewRating] = useState("5");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [returnReason, setReturnReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const returnReasonInput = useRef(null);

  async function loadOrders(isActive = () => true) {
    setLoading(true);
    setError("");

    try {
      const response = await getOrders();
      const data = response.data;
      if (isActive()) setOrders(Array.isArray(data) ? data : data.results || []);
    } catch (err) {
      if (isActive()) {
        setError(
          err.response?.status === 401
            ? "Please log in to view your orders."
            : "Unable to load orders. Please try again."
        );
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => loadOrders(() => active));
    return () => {
      active = false;
    };
  }, []);

  async function handleCancel(order) {
    if (order.order_status !== "pending") {
      setError("Only pending orders can be cancelled online.");
      return;
    }

    setBusyId(order.id);
    setError("");
    setMessage("");

    try {
      await cancelOrder(order.id);
      setMessage(`Order ${order.order_number} was cancelled.`);
      setConfirmation(null);
      await loadOrders();
    } catch (err) {
      setError(
        err.response?.data?.detail || "Unable to cancel this order."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleReturn(order) {
    if (order.order_status !== "delivered") {
      setError("Only delivered orders can be returned.");
      return;
    }

    if (!returnReason.trim()) {
      setError("Please provide a reason for the return.");
      return;
    }
    if (returnReason.trim().length > 1000) {
      setError("Return reason must be 1000 characters or fewer.");
      return;
    }

    setBusyId(order.id);
    setError("");
    setMessage("");

    try {
      await returnOrder(order.id, returnReason.trim());
      setMessage(`Order ${order.order_number} was returned.`);
      setConfirmation(null);
      setReturnReason("");
      await loadOrders();
    } catch (err) {
      setError(
        err.response?.data?.reason?.[0]
          || err.response?.data?.detail
          || "Unable to return this order."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleReviewSubmit(event) {
    event.preventDefault();
    if (!reviewTarget) return;

    setReviewBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await submitOrderItemReview(
        reviewTarget.orderId,
        reviewTarget.itemId,
        { rating: Number(reviewRating), comment: reviewComment.trim() }
      );
      setMessage(response.data.detail || "Your review was submitted for approval.");
      setReviewTarget(null);
      setReviewComment("");
      await loadOrders();
    } catch (err) {
      setError(err.response?.data?.detail || "Unable to submit your review.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function copyOrderValue(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
      setError("");
    } catch {
      setError(`Could not copy the ${label.toLowerCase()}.`);
    }
  }

  const normalizedSearch = search.trim().toLowerCase();
  const visibleOrders = orders
    .filter((order) => filter === "all" || order.order_status === filter)
    .filter((order) => !normalizedSearch || [
      order.order_number,
      order.payment_method,
      ...(order.items || []).map((item) => item.product_name),
    ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch)))
    .sort((first, second) => {
      if (sort === "amount_high") {
        return Number(second.total_amount) - Number(first.total_amount)
          || new Date(second.created_at) - new Date(first.created_at)
          || Number(second.id) - Number(first.id);
      }
      if (sort === "amount_low") {
        return Number(first.total_amount) - Number(second.total_amount)
          || new Date(second.created_at) - new Date(first.created_at)
          || Number(second.id) - Number(first.id);
      }
      const newestFirst = new Date(second.created_at) - new Date(first.created_at)
        || Number(second.id) - Number(first.id);
      return sort === "oldest" ? -newestFirst : newestFirst;
    });

  return (
    <AccountLayout>
      <main className="orders-page">
      <header className="orders-heading">
        <span className="orders-eyebrow">AUREVO / ACCOUNT</span>
        <h1>My Orders</h1>
        <p>Track your purchases and revisit your order details.</p>
      </header>

      {error && <div className="orders-message orders-error">{error}</div>}
      {message && (
        <div className="orders-message orders-success">{message}</div>
      )}

      <section className="orders-toolbar">
        <div>
          <h2>Order history</h2>
          <p>Showing {visibleOrders.length} of {orders.length} order(s)</p>
        </div>

        <div className="orders-controls">
          <label className="orders-search">
            <span className="visually-hidden">Search orders</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order or item"
            />
          </label>
          <label className="orders-filter">
            Status
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All orders</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
              <option value="returned">Returned</option>
            </select>
          </label>
          <label className="orders-filter">
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="amount_high">Amount: high to low</option>
              <option value="amount_low">Amount: low to high</option>
            </select>
          </label>
          <button className="orders-refresh" type="button" onClick={loadOrders} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {loading ? (
        <div className="orders-empty">Loading your orders...</div>
      ) : visibleOrders.length === 0 ? (
        <section className="orders-empty">
          <div className="orders-empty-icon">↗</div>
          <h2>{orders.length ? "No matching orders" : "No orders yet"}</h2>
          <p>{orders.length ? "Try another search or status filter." : "Your order history will appear here once you have orders."}</p>
          {orders.length ? (
            <button className="orders-shop-button" type="button" onClick={() => { setSearch(""); setFilter("all"); }}>
              Clear filters
            </button>
          ) : (
            <Link className="orders-shop-button" to="/">Explore collection</Link>
          )}
        </section>
      ) : (
        <section className="orders-list">
          {visibleOrders.map((order) => {
            const latestPayment = order.payments?.[0];
            const isExpanded = expanded === order.id;
            const orderItems = order.items || [];
            const itemCount = orderItems.reduce((total, item) => total + item.quantity, 0);
            const previewItems = orderItems.slice(0, 3);
            const additionalProducts = Math.max(orderItems.length - previewItems.length, 0);
            const statusUpdates = [...(order.history || [])];
            if (
              order.order_status &&
              !statusUpdates.some((entry) => entry.status === order.order_status)
            ) {
              statusUpdates.push({
                status: order.order_status,
                updated_at: order.updated_at,
              });
            }
            const activeStages = ["pending", "processing", "shipped", "delivered"];
            const activeStageIndex = activeStages.indexOf(order.order_status);
            const terminalStatus = ["cancelled", "returned"].includes(order.order_status);
            const address = order.shipping_address || {};
            const addressLines = [
              address.full_name,
              address.address_line1,
              address.address_line2,
              [address.city, address.district, address.state, address.postal_code]
                .filter(Boolean)
                .join(", "),
              address.country,
              address.phone,
            ].filter(Boolean);

            return (
              <article className="order-card" key={order.id}>
                <div className="order-card-header">
                  <div>
                    <span className="order-label">ORDER NUMBER</span>
                    <h3>{order.order_number}</h3>
                    <p>Placed on {date(order.created_at)}</p>
                  </div>

                  <span
                    className={`order-status ${order.order_status}`}
                  >
                    {readable(order.order_status)}
                  </span>
                </div>

                <div className="order-card-summary">
                  <div className="order-card-products">
                    <div className="order-preview-images" aria-label={`${itemCount} items in this order`}>
                      {previewItems.map((item) => item.image ? (
                        <img key={item.id} src={mediaUrl(item.image)} alt={item.product_name} loading="lazy" />
                      ) : (
                        <span className="order-preview-placeholder" key={item.id} aria-hidden="true">A</span>
                      ))}
                      {additionalProducts > 0 && <span className="order-preview-more">+{additionalProducts}</span>}
                    </div>
                    <div className="order-preview-copy">
                      <span className="order-label">{itemCount} {itemCount === 1 ? "ITEM" : "ITEMS"}</span>
                      <strong>{orderItems[0]?.product_name || "Order items"}{orderItems.length > 1 ? ` +${orderItems.length - 1} more` : ""}</strong>
                    </div>
                  </div>
                  <div className="order-preview-total">
                    <span className="order-label">ORDER TOTAL</span>
                    <strong>{money(order.total_amount)}</strong>
                    <small>{readable(latestPayment?.payment_status || "pending")}</small>
                  </div>
                </div>

                {order.tracking_id && (
                  <div className="order-tracking">
                    <span>Tracking ID: <strong>{order.tracking_id}</strong></span>
                    <button
                      type="button"
                      onClick={() => copyOrderValue(order.tracking_id, "Tracking ID")}
                    >
                      Copy
                    </button>
                  </div>
                )}

                {order.delivery_date && (
                  <p className="order-delivery">
                    {order.order_status === "delivered" ? "Delivered on" : "Expected delivery"}: {date(order.delivery_date)}
                  </p>
                )}
                <p className="order-last-updated">
                  Last updated {dateTime(order.updated_at || order.created_at)}
                </p>

                <div className="order-card-footer">
                  <button
                    className="order-details-button"
                    type="button"
                    onClick={() =>
                      setExpanded(isExpanded ? null : order.id)
                    }
                  >
                    {isExpanded ? "Hide details" : "View details"}
                  </button>

                  {order.order_status === "pending" && (
                    <button
                      className="order-cancel-button"
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() => {
                        setError("");
                        setConfirmation({ type: "cancel", order });
                      }}
                    >
                      {busyId === order.id ? "Cancelling..." : "Cancel order"}
                    </button>
                  )}

                  {order.order_status === "delivered" && (
                    <button
                      className="order-return-button"
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() => {
                        setError("");
                        setReturnReason("");
                        setConfirmation({ type: "return", order });
                      }}
                    >
                      {busyId === order.id ? "Returning..." : "Return order"}
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="order-expanded">
                    <section className="order-updates" aria-labelledby={`order-updates-${order.id}`}>
                      <div className="order-section-heading">
                        <div>
                          <span className="order-label">LIVE ORDER STATUS</span>
                          <h4 id={`order-updates-${order.id}`}>Order updates</h4>
                        </div>
                        <span className={`order-status ${order.order_status}`}>
                          {readable(order.order_status)}
                        </span>
                      </div>

                      {terminalStatus ? (
                        <ol className="order-update-list">
                          {statusUpdates.map((entry, index) => (
                            <li key={`${entry.status}-${entry.updated_at || index}`}>
                              <span className="order-update-dot" />
                              <div>
                                <strong>{readable(entry.status)}</strong>
                                <time>{dateTime(entry.updated_at)}</time>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <ol className="order-progress">
                          {activeStages.map((stage, index) => {
                            const update = [...statusUpdates]
                              .reverse()
                              .find((entry) => entry.status === stage);
                            const complete = activeStageIndex >= index;
                            return (
                              <li
                                className={`${complete ? "complete" : ""}${order.order_status === stage ? " current" : ""}`}
                                key={stage}
                              >
                                <span className="order-progress-marker">
                                  {complete ? "✓" : index + 1}
                                </span>
                                <strong>{readable(stage)}</strong>
                                {complete && (
                                  <time>
                                    {date(update?.updated_at || (stage === "pending" ? order.created_at : null))}
                                  </time>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}

                      {order.tracking_id && (
                        <p className="order-tracking-note">
                          Use the tracking ID shown on the order card to follow the shipment.
                        </p>
                      )}
                    </section>

                    <h4>Items in this order</h4>

                    {order.items?.length ? (
                      order.items.map((item) => (
                        <div className="order-item" key={item.id}>
                          <div className="order-item-product">
                            {item.image ? (
                              <img className="order-item-image" src={mediaUrl(item.image)} alt={item.product_name} loading="lazy" />
                            ) : (
                              <span className="order-item-image order-item-image-empty" aria-label="Product image unavailable">No image</span>
                            )}
                            <div className="order-item-copy">
                              <strong>{item.product_name}</strong>
                              <p>
                                SKU: {item.sku || "—"} · Size: {item.size || "—"}
                                {" · "}Color: {item.color || "—"}
                              </p>
                              <p>Quantity: {item.quantity}</p>
                            </div>
                          </div>
                          {order.order_status === "delivered" && item.product_id && (
                            <div className="order-item-review">
                              {item.reviewed ? (
                                <span className="order-review-submitted">Review submitted</span>
                              ) : reviewTarget?.itemId === item.id ? (
                                <form className="order-review-form" onSubmit={handleReviewSubmit}>
                                  <label>
                                    Your rating
                                    <select value={reviewRating} onChange={(event) => setReviewRating(event.target.value)}>
                                      <option value="5">5 stars · Loved it</option>
                                      <option value="4">4 stars · Liked it</option>
                                      <option value="3">3 stars · It was okay</option>
                                      <option value="2">2 stars · Disappointed</option>
                                      <option value="1">1 star · Not for me</option>
                                    </select>
                                  </label>
                                  <label>
                                    Your review <span>(optional)</span>
                                    <textarea
                                      value={reviewComment}
                                      onChange={(event) => setReviewComment(event.target.value)}
                                      maxLength={2000}
                                      rows={3}
                                      placeholder="Share what you thought about this product"
                                    />
                                  </label>
                                  <div className="order-review-actions">
                                    <button className="order-review-submit" type="submit" disabled={reviewBusy}>
                                      {reviewBusy ? "Submitting..." : "Submit review"}
                                    </button>
                                    <button className="order-review-cancel" type="button" disabled={reviewBusy} onClick={() => setReviewTarget(null)}>
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <button
                                  className="order-review-open"
                                  type="button"
                                  onClick={() => {
                                    setError("");
                                    setReviewRating("5");
                                    setReviewComment("");
                                    setReviewTarget({ orderId: order.id, itemId: item.id });
                                  }}
                                >
                                  Write a review
                                </button>
                              )}
                            </div>
                          )}
                          <strong className="order-item-total">{money(item.total_price)}</strong>
                        </div>
                      ))
                    ) : (
                      <p>No item details are available.</p>
                    )}

                    <div className="order-total-lines">
                      <p>
                        Order total:{" "}
                        <strong>{money(order.total_amount)}</strong>
                      </p>
                      <p>
                        Discount: <strong>{money(order.discount_amount)}</strong>
                      </p>
                      <p>
                        Shipping: <strong>{money(order.shipping_charge)}</strong>
                      </p>
                      <p>
                        Payment method:{" "}
                        <strong>{readable(order.payment_method || "Not specified")}</strong>
                      </p>
                      {order.coupon_code && (
                        <p>
                          Coupon applied: <strong>{order.coupon_code}</strong>
                        </p>
                      )}
                    </div>

                    <section className="order-address" aria-labelledby={`order-address-${order.id}`}>
                      <h4 id={`order-address-${order.id}`}>Delivery address</h4>
                      {addressLines.length ? (
                        <address>
                          {addressLines.map((line, index) => (
                            <span key={`${line}-${index}`}>{line}</span>
                          ))}
                        </address>
                      ) : (
                        <p>Delivery address details are not available.</p>
                      )}
                    </section>

                    <h4>Payment history</h4>
                    {order.payments?.length ? (
                      order.payments.map((payment) => (
                        <p className="order-history-line" key={payment.id}>
                          {readable(payment.payment_status)} —{" "}
                          {money(payment.amount)} — {date(payment.created_at)}
                        </p>
                      ))
                    ) : (
                      <p>No payment records available.</p>
                    )}

                    <p className="order-updates-refresh-note">
                      Order status and tracking details refresh when you select Refresh above.
                    </p>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
      {confirmation && (
        <ConfirmDialog
          title={confirmation.type === "return" ? "Return this order?" : "Cancel this order?"}
          initialFocusRef={confirmation.type === "return" ? returnReasonInput : undefined}
          text={
            confirmation.type === "return"
              ? `Tell us why you are returning order ${confirmation.order.order_number}.`
              : `Are you sure you want to cancel order ${confirmation.order.order_number}?`
          }
          confirmLabel={confirmation.type === "return" ? "Submit return" : "Cancel order"}
          danger={confirmation.type === "cancel"}
          busy={busyId === confirmation.order.id}
          onConfirm={() =>
            confirmation.type === "return"
              ? handleReturn(confirmation.order)
              : handleCancel(confirmation.order)
          }
          onCancel={() => {
            if (busyId === null) {
              setConfirmation(null);
              setReturnReason("");
            }
          }}
        >
          {confirmation.type === "return" && (
            <label className="return-reason-field">
              Return reason
              <textarea
                ref={returnReasonInput}
                maxLength={1000}
                required
                rows={4}
                value={returnReason}
                onChange={(event) => {
                  setError("");
                  setReturnReason(event.target.value);
                }}
                placeholder="Please describe why you want to return this order"
              />
              {error && <span className="return-reason-error" role="alert">{error}</span>}
            </label>
          )}
        </ConfirmDialog>
      )}
      </main>
    </AccountLayout>
  );
}

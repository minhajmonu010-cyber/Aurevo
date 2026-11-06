import { useEffect, useMemo, useState } from "react";
import { getSalesReport } from "../api/admin";
import Icon from "../components/Icon";
import { EmptyState, StatCard } from "../components/ui";
import { formatNumber, mediaUrl } from "../utils/format";

const PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];
const EMPTY_DAILY_SALES = [];
const EMPTY_PRODUCT_SALES = [];
const EMPTY_ORDERS = [];

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateDaysAgo(daysAgo, fromDate) {
  const date = new Date(`${fromDate}T00:00:00`);
  date.setDate(date.getDate() - daysAgo);
  return localDateString(date);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatReportDate(value, options = { day: "2-digit", month: "short", year: "numeric" }) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", options);
}

function readableMethod(value) {
  return String(value || "other")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reportProductImage(path) {
  if (!path) return null;
  if (/^https?:/i.test(path)) return path;
  if (path.startsWith("/")) return mediaUrl(path);
  return mediaUrl(`/media/${path.replace(/^media\//, "")}`);
}

export default function SalesReports() {
  const [today] = useState(() => localDateString(new Date()));
  const [start, setStart] = useState(() => dateDaysAgo(29, today));
  const [end, setEnd] = useState(today);
  const [activePresetDays, setActivePresetDays] = useState(30);
  const [report, setReport] = useState(null);
  const [productSearch, setProductSearch] = useState("");
  const [productSort, setProductSort] = useState("revenue");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadReport() {
      setLoading(true);
      setError("");

      try {
        const data = await getSalesReport({ start, end });
        if (active) setReport(data);
      } catch (requestError) {
        if (active) {
          setReport(null);
          setError(requestError.response?.data?.detail || "Unable to load sales report.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadReport();

    return () => {
      active = false;
    };
  }, [start, end]);

  const dailySales = report?.daily_sales || EMPTY_DAILY_SALES;
  const reportDays = useMemo(() => {
    if (!report) return [];
    const salesByDate = new Map(dailySales.map((item) => [
      item.date,
      {
        sales: Number(item.sales || 0),
        payment_count: Number(item.payment_count || 0),
      },
    ]));
    const days = [];
    const cursor = new Date(`${report.start_date}T00:00:00`);
    const lastDay = new Date(`${report.end_date}T00:00:00`);

    while (cursor <= lastDay) {
      const date = localDateString(cursor);
      const daily = salesByDate.get(date);
      days.push({ date, sales: daily?.sales || 0, payment_count: daily?.payment_count || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [report, dailySales]);

  const summary = useMemo(() => {
    const total = Number(report?.total_sales || 0);
    const bestDay = dailySales.reduce(
      (best, item) => Number(item.sales) > Number(best?.sales || 0) ? item : best,
      null
    );
    return {
      average: reportDays.length ? total / reportDays.length : 0,
      activeDays: dailySales.filter((item) => Number(item.sales) > 0).length,
      bestDay: bestDay && Number(bestDay.sales) > 0 ? bestDay : null,
      topProduct: report?.product_sales?.[0] || null,
    };
  }, [dailySales, report, reportDays.length]);

  const productSales = report?.product_sales || EMPTY_PRODUCT_SALES;
  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    return productSales
      .filter((product) =>
        [
          product.product_name,
          product.sku,
          product.category__name,
          product.size,
          product.color,
        ].some((value) => String(value || "").toLowerCase().includes(query))
      )
      .sort((first, second) =>
        productSort === "units"
          ? Number(second.units_sold) - Number(first.units_sold) ||
            Number(second.revenue) - Number(first.revenue)
          : Number(second.revenue) - Number(first.revenue) ||
            Number(second.units_sold) - Number(first.units_sold)
      );
  }, [productSales, productSearch, productSort]);
  const orderDetails = report?.orders || EMPTY_ORDERS;
  const visibleOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    return orderDetails.filter((order) => {
      if (orderStatus !== "all" && order.order_status !== orderStatus) return false;
      if (!query) return true;
      const itemText = order.items
        .map((item) => [item.product_name, item.sku, item.size, item.color].join(" "))
        .join(" ");
      return [
        order.order_number,
        order.customer_name,
        order.customer_email,
        order.coupon_code,
        order.payment_method,
        order.order_status,
        itemText,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [orderDetails, orderSearch, orderStatus]);

  const maxSales = Math.max(0, ...reportDays.map((day) => day.sales));
  const maxPaymentMethodSales = Math.max(
    0,
    ...(report?.payment_methods || []).map((item) => Number(item.amount || 0))
  );

  function applyPreset(days) {
    setActivePresetDays(days);
    setStart(dateDaysAgo(days - 1, today));
    setEnd(today);
  }

  function updateStart(value) {
    setActivePresetDays(null);
    setStart(value);
  }

  function updateEnd(value) {
    setActivePresetDays(null);
    setEnd(value);
  }

  function exportCSV() {
    if (!report) return;
    const cell = (value) => {
      const text = String(value ?? "");
      const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const rows = [
      ["Aurevo sales report"],
      ["Date range", report.start_date, report.end_date],
      ["Total paid sales", report.total_sales],
      ["Paid orders", report.paid_order_count],
      ["Successful payments", report.payment_count],
      ["Average order value", report.average_order_value],
      ["Units sold", report.units_sold],
      ["Products sold", report.product_count],
      ["Average daily sales", summary.average.toFixed(2)],
      [],
      ["Date", "Paid sales", "Payments"],
      ...reportDays.map((item) => [item.date, item.sales.toFixed(2), item.payment_count || 0]),
      [],
      ["Payment method", "Payments", "Paid amount", "Share of sales"],
      ...(report.payment_methods || []).map((item) => [
        readableMethod(item.method),
        item.payment_count,
        item.amount,
        Number(report.total_sales) > 0
          ? `${((Number(item.amount) / Number(report.total_sales)) * 100).toFixed(1)}%`
          : "0%",
      ]),
      [],
      ["Top products (up to 100, sorted by revenue)", "SKU", "Category", "Size", "Color", "Orders", "Units sold", "Average unit price", "Item revenue", "Share of item revenue"],
      ...productSales.map((item) => [
        item.product_name,
        item.sku,
        item.category__name,
        item.size,
        item.color,
        item.order_count,
        item.units_sold,
        item.average_unit_price,
        item.revenue,
        Number(report.product_revenue) > 0
          ? `${((Number(item.revenue) / Number(report.product_revenue)) * 100).toFixed(1)}%`
          : "0%",
      ]),
      [],
      ["Order details", "Order date", "Customer", "Email", "Ship to", "Order status", "Payment status", "Payment method", "Product / SKU / variant / qty / unit price / line total", "Item subtotal", "Product/offer discount", "Coupon code", "Coupon discount", "Total discount", "Shipping", "Order total", "Paid amount", "Transactions"],
      ...orderDetails.map((order) => [
        order.order_number,
        order.created_at,
        order.customer_name,
        order.customer_email,
        Object.values(order.shipping_address || {}).filter(Boolean).join(", "),
        order.order_status,
        order.payment_status,
        order.payment_method,
        order.items.map((item) =>
          `${item.product_name} / ${item.sku || "no SKU"} / ${[item.size, item.color].filter(Boolean).join(" ")} / qty ${item.quantity} / ${item.unit_price} each / ${item.line_total}${item.is_cancelled ? " / cancelled" : ""}`
        ).join("; "),
        order.item_subtotal,
        order.product_offer_discount,
        order.coupon_code,
        order.coupon_discount,
        order.total_discount,
        order.shipping_charge,
        order.order_total,
        order.paid_amount,
        order.payments.map((payment) =>
          `${payment.method}: ${payment.transaction_id || "no transaction ID"} (${payment.amount})`
        ).join("; "),
      ]),
    ];
    const csv = rows
      .map((row) => row.map(cell).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `aurevo-sales-${report.start_date}-to-${report.end_date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="ad-crumbs admin-report-controls">
        Analytics / <b>Sales reports</b>
      </div>
      <div className="ad-head admin-report-controls">
        <div>
          <h1 className="ad-h1">Sales Reports</h1>
          <p className="ad-sub">Track paid sales, spot daily trends, and export your results.</p>
        </div>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={() => window.print()} disabled={!report || loading}>
            <Icon name="download" size={15} /> Download PDF
          </button>
          <button type="button" className="ad-btn primary" onClick={exportCSV} disabled={!report || loading}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        </div>
      </div>

      <section className="ad-card ad-card-pad admin-report-filters admin-report-controls" aria-label="Report filters">
        <div className="ad-seg" role="group" aria-label="Quick date range">
          {PRESETS.map(({ label, days }) => (
            <button key={days} type="button" className={activePresetDays === days ? "on" : ""} onClick={() => applyPreset(days)}>
              {label}
            </button>
          ))}
        </div>
        <label className="ad-field">
          <span className="ad-label">Start date</span>
          <input className="ad-input" type="date" value={start} max={end} onChange={(event) => updateStart(event.target.value)} />
        </label>
        <label className="ad-field">
          <span className="ad-label">End date</span>
          <input className="ad-input" type="date" value={end} min={start} max={today} onChange={(event) => updateEnd(event.target.value)} />
        </label>
      </section>

      {loading && <div className="ad-card ad-card-pad ad-muted">Loading report...</div>}
      {error && <div className="ad-alert" role="alert">{error}</div>}

      {report && !loading && (
        <div className="admin-report-print">
          <header className="admin-report-print-heading">
            <div>
              <span className="ad-eyebrow">AUREVO · BUSINESS INTELLIGENCE</span>
              <h2>Sales performance report</h2>
              <p>{formatReportDate(report.start_date)} – {formatReportDate(report.end_date)}</p>
            </div>
            <span className="admin-report-print-mark">A</span>
          </header>

          <section className="ad-stats admin-report-stats">
            <StatCard label="Paid sales" value={formatCurrency(report.total_sales)} icon="rupee" accent foot={`${report.payment_count ?? 0} successful payments`} />
            <StatCard label="Paid orders" value={formatNumber(report.paid_order_count)} icon="package" foot={`${formatNumber(report.units_sold)} items sold`} />
            <StatCard label="Average order value" value={formatCurrency(report.average_order_value)} icon="bar-chart" foot="Paid sales ÷ paid orders" />
            <StatCard label="Average daily sales" value={formatCurrency(summary.average)} icon="calendar" foot={`${summary.activeDays} active days of ${reportDays.length}`} />
          </section>

          <section className="ad-card ad-card-pad admin-report-highlights">
            <div>
              <span className="ad-eyebrow">Best sales day</span>
              <strong>{summary.bestDay ? formatReportDate(summary.bestDay.date) : "No sales yet"}</strong>
            </div>
            <div>
              <span className="ad-eyebrow">Best day total</span>
              <strong>{formatCurrency(summary.bestDay?.sales || 0)}</strong>
            </div>
            <div>
              <span className="ad-eyebrow">Top product by revenue</span>
              <strong>{summary.topProduct?.product_name || "No product sales"}</strong>
              {summary.topProduct && (
                <small>{formatCurrency(summary.topProduct.revenue)} · {formatNumber(summary.topProduct.units_sold)} sold</small>
              )}
            </div>
            <div>
              <span className="ad-eyebrow">Products sold</span>
              <strong>{formatNumber(report.product_count)}</strong>
              <small>Product and variant combinations</small>
            </div>
          </section>

          <section className="ad-card ad-card-pad admin-sales-chart" aria-label="Daily sales chart">
            <div className="ad-card-head">
              <div>
                <h3>Daily sales trend</h3>
                <p className="ad-hint">Paid sales by day for the selected period.</p>
              </div>
            </div>
            {maxSales > 0 ? (
              <div className="admin-sales-chart-scroll">
                <div className="admin-sales-chart-bars">
                  {reportDays.map((day) => (
                    <div className="admin-sales-chart-day" key={day.date} title={`${formatReportDate(day.date)}: ${formatCurrency(day.sales)}`}>
                      <span className="admin-sales-chart-value">{day.sales > 0 ? formatCurrency(day.sales) : ""}</span>
                      <i
                        className={day.sales > 0 ? "has-sales" : ""}
                        style={{ height: `${day.sales > 0 ? Math.max(5, (day.sales / maxSales) * 100) : 2}%` }}
                      />
                      <span className="admin-sales-chart-date">{formatReportDate(day.date, { day: "2-digit", month: "short" })}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState icon="bar-chart" title="No paid sales in this period">
                Choose another date range to review sales activity.
              </EmptyState>
            )}
          </section>

          <section className="ad-card ad-card-pad admin-report-payments" aria-label="Sales by payment method">
            <div className="ad-card-head">
              <div>
                <h3>Payment methods</h3>
                <p className="ad-hint">Share of successful payment value in this period.</p>
              </div>
            </div>
            {(report.payment_methods || []).length ? (
              <div className="admin-report-payment-list">
                {report.payment_methods.map((item) => {
                  const amount = Number(item.amount || 0);
                  const share = Number(report.total_sales) > 0
                    ? (amount / Number(report.total_sales)) * 100
                    : 0;
                  return (
                    <div className="admin-report-payment" key={item.method}>
                      <div className="admin-report-payment-top">
                        <strong>{readableMethod(item.method)}</strong>
                        <span>{formatCurrency(amount)} <small>· {item.payment_count} payments · {share.toFixed(1)}%</small></span>
                      </div>
                      <div className="admin-report-payment-track">
                        <i style={{ width: `${maxPaymentMethodSales ? (amount / maxPaymentMethodSales) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="ad-muted">No successful payments in this period.</p>
            )}
          </section>

          <section className="ad-card admin-report-products" aria-label="Product sales performance">
            <div className="ad-card-pad admin-report-table-head admin-report-products-head">
              <div className="ad-card-head">
                <div>
                  <h3>Product performance</h3>
                  <p className="ad-hint">Line-item totals from paid orders, excluding cancelled items · Top 100 variants by revenue</p>
                </div>
                <div className="admin-report-product-controls admin-report-controls">
                  <label>
                    <span className="ad-sr-only">Search products</span>
                    <input
                      className="ad-input"
                      type="search"
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Search product, SKU, size..."
                    />
                  </label>
                  <label>
                    <span className="ad-sr-only">Sort products</span>
                    <select className="ad-select" value={productSort} onChange={(event) => setProductSort(event.target.value)}>
                      <option value="revenue">Highest revenue</option>
                      <option value="units">Most units sold</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
            {visibleProducts.length ? (
              <div className="ad-table-wrap admin-report-table admin-report-product-table">
                <table className="ad-table">
                  <thead>
                    <tr><th>Product</th><th>Category</th><th>Variant</th><th className="right">Orders</th><th className="right">Units</th><th className="right">Avg. unit price</th><th className="right">Item revenue</th><th className="right">Item share</th></tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((item) => (
                      <tr key={`${item.product_name}-${item.sku}-${item.size}-${item.color}-${item.category__name}-${item.product_image}`}>
                        <td>
                          <div className="ad-cell admin-report-product-cell">
                            <span className="ad-thumb" style={{ width: 44, height: 54 }}>
                              {item.product_image ? <img src={reportProductImage(item.product_image)} alt="" loading="lazy" /> : <Icon name="hanger" size={18} />}
                            </span>
                            <span>
                              <strong className="admin-report-product-name">{item.product_name}</strong>
                              <span className="ad-cell-sub mono">{item.sku || "No SKU"}</span>
                            </span>
                          </div>
                        </td>
                        <td>{item.category__name || "Uncategorized"}</td>
                        <td>{[item.size, item.color].filter(Boolean).join(" · ") || "Standard"}</td>
                        <td className="right">{formatNumber(item.order_count)}</td>
                        <td className="right"><strong>{formatNumber(item.units_sold)}</strong></td>
                        <td className="right">{formatCurrency(item.average_unit_price)}</td>
                        <td className="right"><strong>{formatCurrency(item.revenue)}</strong></td>
                        <td className="right">{Number(report.product_revenue) > 0 ? `${((Number(item.revenue) / Number(report.product_revenue)) * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ad-card-pad">
                <EmptyState icon="hanger" title={productSearch ? "No matching products" : "No product sales"}>
                  {productSearch ? "Try another product name, SKU, category, or variant." : "Products from paid orders will appear here."}
                </EmptyState>
              </div>
            )}
          </section>

          <section className="ad-card admin-report-orders" aria-label="Paid order details">
            <div className="ad-card-pad admin-report-table-head admin-report-orders-head">
              <div className="ad-card-head">
                <div>
                  <h3>Order details</h3>
                  <p className="ad-hint">
                    {formatNumber(orderDetails.length)} paid orders · Item/offer discount is total discount less coupon discount; offer names are not stored in historical orders.
                  </p>
                </div>
                <div className="admin-report-order-controls admin-report-controls">
                  <label>
                    <span className="ad-sr-only">Search orders, customers, products, or coupons</span>
                    <input
                      className="ad-input"
                      type="search"
                      value={orderSearch}
                      onChange={(event) => setOrderSearch(event.target.value)}
                      placeholder="Search order, customer, product, coupon..."
                    />
                  </label>
                  <label>
                    <span className="ad-sr-only">Filter orders by status</span>
                    <select className="ad-select" value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>
                      <option value="all">All statuses</option>
                      <option value="pending">Pending</option>
                      <option value="processing">Processing</option>
                      <option value="shipped">Shipped</option>
                      <option value="delivered">Delivered</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="returned">Returned</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
            {visibleOrders.length ? (
              <div className="ad-table-wrap admin-report-table admin-report-order-table">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Order / customer</th><th>Date / status</th><th>Items</th>
                      <th className="right">Subtotal</th><th className="right">Offer discount</th>
                      <th>Coupon</th><th className="right">Coupon discount</th><th className="right">Total discount</th>
                      <th>Ship to</th><th className="right">Shipping</th><th className="right">Order total</th>
                      <th className="right">Paid</th>
                      <th>Payment / transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.map((order) => (
                      <tr key={order.order_number}>
                        <td>
                          <strong>{order.order_number}</strong>
                          <span className="admin-report-order-customer">
                            {order.customer_name}<br />{order.customer_email || "Customer account deleted"}
                          </span>
                        </td>
                        <td>
                          <span>{formatReportDate(order.created_at.slice(0, 10))}</span>
                          <span className={`admin-report-order-status ${order.order_status}`}>{readableMethod(order.order_status)}</span>
                        </td>
                        <td className="admin-report-order-items">
                          {order.items.map((item, index) => (
                            <span className={item.is_cancelled ? "is-cancelled" : ""} key={`${item.sku}-${index}`}>
                              <strong>{item.product_name}</strong> · {item.sku || "No SKU"} · {[item.size, item.color].filter(Boolean).join(" / ") || "Standard"}
                              {" · "}×{item.quantity} · {formatCurrency(item.unit_price)} ea · {formatCurrency(item.line_total)}
                              {item.is_cancelled ? " · Cancelled" : ""}
                            </span>
                          ))}
                        </td>
                        <td className="right">{formatCurrency(order.item_subtotal)}</td>
                        <td className="right">{formatCurrency(order.product_offer_discount)}</td>
                        <td>{order.coupon_code || "—"}</td>
                        <td className="right">{formatCurrency(order.coupon_discount)}</td>
                        <td className="right">{formatCurrency(order.total_discount)}</td>
                        <td className="admin-report-order-address">
                          {[
                            order.shipping_address?.full_name,
                            order.shipping_address?.address_line1,
                            order.shipping_address?.address_line2,
                            order.shipping_address?.city,
                            order.shipping_address?.district,
                            order.shipping_address?.state,
                            order.shipping_address?.postal_code,
                            order.shipping_address?.country,
                            order.shipping_address?.phone,
                          ].filter(Boolean).join(", ") || "Address unavailable"}
                        </td>
                        <td className="right">{formatCurrency(order.shipping_charge)}</td>
                        <td className="right"><strong>{formatCurrency(order.order_total)}</strong></td>
                        <td className="right">{formatCurrency(order.paid_amount)}</td>
                        <td>
                          <strong>{readableMethod(order.payment_method)}</strong>
                          {order.payments.map((payment, index) => (
                            <span className="admin-report-order-transaction" key={`${payment.transaction_id}-${index}`}>
                              {payment.transaction_id || "No transaction ID"} · {formatCurrency(payment.amount)}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ad-card-pad">
                <EmptyState icon="package" title={orderDetails.length ? "No matching orders" : "No paid orders"}>
                  {orderDetails.length ? "Try another search or order status." : "Paid orders in this date range will appear here."}
                </EmptyState>
              </div>
            )}
          </section>

          <section className="ad-card admin-report-daily-table" aria-label="Daily sales breakdown">
            <div className="ad-card-pad admin-report-table-head">
              <div className="ad-card-head">
                <div>
                  <h3>Daily breakdown</h3>
                  <p className="ad-hint">Includes days with no sales.</p>
                </div>
              </div>
            </div>
            <div className="ad-table-wrap admin-report-table">
              <table className="ad-table">
                <thead>
                  <tr><th>Date</th><th>Paid sales</th><th>Payments</th><th>Share of total</th></tr>
                </thead>
                <tbody>
                  {[...reportDays].reverse().map((item) => (
                    <tr key={item.date}>
                      <td>{formatReportDate(item.date)}</td>
                      <td><strong>{formatCurrency(item.sales)}</strong></td>
                      <td>{formatNumber(item.payment_count || 0)}</td>
                      <td>{Number(report.total_sales) > 0 ? `${((item.sales / Number(report.total_sales)) * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                  {reportDays.length === 0 && <tr><td colSpan="4">No days in this date range.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

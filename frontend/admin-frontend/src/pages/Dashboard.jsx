import { useState } from "react";
import { Link } from "react-router-dom";
import { getDashboard, getDashboardOrders } from "../api/admin";
import AreaChart from "../components/AreaChart";
import Icon from "../components/Icon";
import { EmptyState, ErrorNote, Pagination, Pill, Skeleton, StatCard, Thumb } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { changeText, downloadCsv, formatNumber, formatPrice, formatPriceShort, formatWhen, mediaUrl } from "../utils/format";
import { useDebounced, useLoad } from "../utils/hooks";

const RANGES = { "7d": "Last 7 Days", "30d": "Last 30 Days", "12m": "Last 12 Months" };
const TAB_LABEL = { "7d": "7 Days", "30d": "30 Days", "12m": "12 Months" };
const PAYMENT_TONE = { paid: "ok", pending: "warn", failed: "bad", refunded: "bad" };
const ORDER_TONE = { pending: ["warn", "clock"], processing: ["warn", "refresh"], shipped: ["purple", "package"], delivered: ["ok", "check"], cancelled: ["muted", "x"], returned: ["bad", "undo"] };
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const tone = (change) => (change < 0 ? "down" : "up");

export default function Dashboard() {
  const toast = useToast();
  const [range, setRange] = useState("7d");
  const [tick, setTick] = useState(0); // "try again" reloads the page's numbers

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const query = useDebounced(search);

  const summary = useLoad(() => getDashboard(range), [range, tick]);
  const orders = useLoad(
    () => getDashboardOrders({ search: query, status, start, end, page }),
    [query, status, start, end, page, tick]
  );
  const d = summary.data;
  const orderFiltersActive = Boolean(query || status || start || end);

  const exportOrders = async () => {
    try {
      const all = await getDashboardOrders({ search: query, status, start, end, page_size: 1000 });
      downloadCsv("recent-orders.csv", [
        ["Order", "Customer", "Email", "Date", "Amount", "Payment status", "Order status", "Items"],
        ...all.results.map((o) => [o.order_number, o.customer.name, o.customer.email, o.created_at, o.amount, o.payment_status, o.order_status, o.items_count]),
      ]);
    } catch {
      toast.show("Could not export the orders.", "bad");
    }
  };

  const s = d?.stats;
  return (
    <>
      <div className="ad-crumbs">
        Overview / <b>Executive feed</b>
      </div>
      <div className="ad-head">
        <h1 className="ad-h1">Commerce Analytics &amp; Drop Control</h1>
        <div className="ad-actions">
          <button type="button" className="ad-btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
            <Icon name="sliders" size={15} /> Filters
          </button>
          <label className="ad-btn" style={{ gap: 6 }}>
            <Icon name="calendar" size={15} />
            <select className="ad-select" style={{ border: 0, background: "transparent", minHeight: 0, padding: "0 20px 0 0", width: "auto", fontWeight: 600 }} value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
              {Object.entries(RANGES).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="ad-btn primary" onClick={exportOrders}>
            <Icon name="download" size={15} /> Export Feed
          </button>
        </div>
      </div>

      {filtersOpen && (
        <section className="ad-toolbar" aria-label="Dashboard order filters">
          <label className="ad-select-inline">
            Orders from
            <input className="ad-input" type="date" value={start} onChange={(event) => { setStart(event.target.value); setPage(1); }} />
          </label>
          <label className="ad-select-inline">
            Orders through
            <input className="ad-input" type="date" value={end} min={start || undefined} onChange={(event) => { setEnd(event.target.value); setPage(1); }} />
          </label>
          <button type="button" className="ad-btn" onClick={() => { setStart(""); setEnd(""); setStatus(""); setSearch(""); setPage(1); }}>
            Clear filters
          </button>
        </section>
      )}

      {summary.error && !d && <div className="ad-card"><ErrorNote error={summary.error} onRetry={() => setTick((t) => t + 1)} /></div>}

      <div className="ad-stats">
        <StatCard label="Total Sales" icon="rupee" value={s ? formatPrice(s.total_sales.value) : "…"}
          delta={s && changeText(s.total_sales.change)} deltaTone={s && tone(s.total_sales.change)} foot={s && s.total_sales.change !== null ? "vs last month" : "No earlier month to compare"} />
        <StatCard label="Total Orders" icon="shopping-bag" value={s ? formatNumber(s.total_orders.value) : "…"}
          delta={s && changeText(s.total_orders.change)} deltaTone={s && tone(s.total_orders.change)} foot={s && s.total_orders.change !== null ? "vs last month" : "No earlier month to compare"} />
        <StatCard label="Total Customers" icon="users" value={s ? formatNumber(s.total_customers.value) : "…"}
          delta={s && changeText(s.total_customers.change)} deltaTone={s && tone(s.total_customers.change)} foot={s && s.total_customers.change !== null ? "new signups" : "No earlier month to compare"} />
        <StatCard label="Low Stock Items" icon="alert-triangle" accent
          value={s ? <>{s.low_stock.count} <small>Items</small></> : "…"}
          delta={s && s.low_stock.critical > 0 ? `${s.low_stock.critical} Critical` : null} deltaTone="down"
          foot={s && (s.low_stock.critical > 0 ? "immediate reorder" : "Everything is stocked")} />
      </div>

      <div className="ad-dash-grid">
        <section className="ad-card ad-card-pad" aria-label="Sales overview">
          <div className="ad-card-head" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <h3>
                Sales Overview{" "}
                {s && s.total_sales.change !== null && <Pill tone={s.total_sales.change < 0 ? "bad" : "ok"}>{changeText(s.total_sales.change)} vs last month</Pill>}
              </h3>
              <p className="ad-hint" style={{ marginTop: 6 }}>{range === "12m" ? "Monthly" : "Daily"} gross store revenue (paid orders)</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {d?.sales_chart.peak && (
                <div style={{ textAlign: "right" }}>
                  <span className="ad-eyebrow">Peak volume</span>
                  <div style={{ fontWeight: 700 }}>{d.sales_chart.peak.label} · {formatPriceShort(d.sales_chart.peak.value)}</div>
                </div>
              )}
              <div className="ad-seg" role="tablist" aria-label="Chart range">
                {Object.keys(RANGES).map((key) => (
                  <button key={key} type="button" role="tab" aria-selected={range === key} className={range === key ? "on" : ""} onClick={() => setRange(key)}>
                    {TAB_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {d ? <AreaChart points={d.sales_chart.points} /> : <Skeleton rows={3} />}
          {d && (
            <div className="ad-highlights">
              <div>
                <span className="ad-eyebrow">Avg order value</span>
                <b>{formatPrice(d.highlights.avg_order_value.value)}{" "}
                  {d.highlights.avg_order_value.change !== null && <span className={`ad-delta ${tone(d.highlights.avg_order_value.change)}`}>{changeText(d.highlights.avg_order_value.change)}</span>}
                </b>
              </div>
              <div>
                <span className="ad-eyebrow">Repeat buyers</span>
                <b>{d.highlights.repeat_buyers}%</b>
              </div>
              <div>
                <span className="ad-eyebrow">Sell-through</span>
                <b>{d.highlights.sell_through}% <span className="ad-muted" style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 500 }}>of units sold</span></b>
              </div>
            </div>
          )}
        </section>

        <section className="ad-card ad-card-pad" aria-label="Low stock">
          <div className="ad-card-head">
            <h3>Low Stock {d && d.low_stock_alerting > 0 && <Pill tone="bad">{d.low_stock_alerting} alerting</Pill>}</h3>
            <Link to="/products?stock=low" className="ad-link">Manage <Icon name="arrow-right" size={13} /></Link>
          </div>
          {!d ? <Skeleton rows={4} /> : d.low_stock_items.length === 0 ? (
            <EmptyState icon="circle-check" title="All stocked up">No product is at or below its alert level.</EmptyState>
          ) : (
            <div className="ad-low-list">
              {d.low_stock_items.map((item) => (
                <div className="ad-low-item" key={item.variant_id}>
                  <Thumb src={mediaUrl(item.image)} size={42} />
                  <div className="name">
                    <b title={item.name}>{item.name}</b>
                    <small>Size: {item.size} · {item.color}</small>
                  </div>
                  <div className="ad-left" style={{ color: item.critical ? "var(--ad-red)" : "var(--ad-amber)" }}>
                    <Pill tone={item.critical ? "bad" : "warn"}>{item.stock === 0 ? "SOLD OUT" : `${item.stock} LEFT`}</Pill>
                    <i style={{ "--w": `${Math.min(100, Math.max(6, item.stock * 10))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="ad-hint" style={{ marginTop: 16 }}>The alert level is set on each product (10 units by default).</p>
        </section>
      </div>

      <section className="ad-card" aria-label="Recent orders">
        <div className="ad-card-pad" style={{ paddingBottom: 0 }}>
          <div className="ad-card-head" style={{ flexWrap: "wrap" }}>
            <div>
              <h3>Recent Orders <Pill tone="purple">Live feed</Pill></h3>
              <p className="ad-hint" style={{ marginTop: 6 }}>Latest customer checkouts</p>
            </div>
            <div className="ad-actions">
              <div className="ad-search" style={{ flex: "0 1 200px", height: 38 }}>
                <Icon name="search" size={15} />
                <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Filter orders…" aria-label="Filter orders" />
              </div>
              <label className="ad-select-inline">
                <select className="ad-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Order status">
                  <option value="">All statuses</option>
                  {Object.keys(ORDER_TONE).map((key) => <option key={key} value={key}>{cap(key)}</option>)}
                </select>
              </label>
              <button type="button" className="ad-btn primary" onClick={exportOrders}>
                <Icon name="download" size={15} /> Export CSV
              </button>
            </div>
          </div>
        </div>

        {orders.error && !orders.data ? <ErrorNote error={orders.error} onRetry={() => setTick((t) => t + 1)} /> : !orders.data ? <Skeleton /> : orders.data.count === 0 ? (
          <EmptyState icon="receipt" title={orderFiltersActive ? "No orders match" : "No orders yet"}>
            {orderFiltersActive ? "Try changing the search, date range or status." : "Orders will appear here as soon as customers check out."}
          </EmptyState>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="ad-table">
                <thead>
                  <tr><th>Order ID</th><th>Customer</th><th>Date</th><th>Amount</th><th>Payment</th><th>Order status</th><th className="right">Action</th></tr>
                </thead>
                <tbody>
                  {orders.data.results.map((o) => {
                    const [orderTone, orderIcon] = ORDER_TONE[o.order_status] || ["muted", "clock"];
                    return (
                      <tr key={o.id}>
                        <td><span className="ad-order-id">#{o.order_number}</span></td>
                        <td>
                          <div className="ad-cell">
                            <span className="ad-initials">{o.customer.initials}</span>
                            <div>
                              <b>{o.customer.name}</b>
                              <div className="ad-cell-sub">{o.customer.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="ad-muted">{formatWhen(o.created_at)}</td>
                        <td><b>{formatPrice(o.amount)}</b></td>
                        <td><Pill tone={PAYMENT_TONE[o.payment_status] || "muted"}>{cap(o.payment_status)}</Pill></td>
                        <td><Pill tone={orderTone} icon={orderIcon}>{cap(o.order_status)}</Pill></td>
                        <td className="right"><Link className="ad-btn sm" to={`/orders?order=${o.id}`}>Details</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={5} count={orders.data.count} noun="orders" onChange={setPage} />
          </>
        )}
      </section>
    </>
  );
}

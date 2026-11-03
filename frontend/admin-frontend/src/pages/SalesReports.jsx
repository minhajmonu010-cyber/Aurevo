import { useEffect, useMemo, useState } from "react";
import { getSalesReport } from "../api/admin";
import Icon from "../components/Icon";
import { EmptyState, StatCard } from "../components/ui";

const PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];
const EMPTY_DAILY_SALES = [];

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

export default function SalesReports() {
  const [today] = useState(() => localDateString(new Date()));
  const [start, setStart] = useState(() => dateDaysAgo(29, today));
  const [end, setEnd] = useState(today);
  const [activePresetDays, setActivePresetDays] = useState(30);
  const [report, setReport] = useState(null);
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
    const salesByDate = new Map(dailySales.map((item) => [item.date, Number(item.sales || 0)]));
    const days = [];
    const cursor = new Date(`${report.start_date}T00:00:00`);
    const lastDay = new Date(`${report.end_date}T00:00:00`);

    while (cursor <= lastDay) {
      const date = localDateString(cursor);
      days.push({ date, sales: salesByDate.get(date) || 0 });
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
    };
  }, [dailySales, report, reportDays.length]);

  const maxSales = Math.max(0, ...reportDays.map((day) => day.sales));

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
    const rows = [
      ["Aurevo sales report"],
      ["Date range", report.start_date, report.end_date],
      ["Total paid sales", report.total_sales],
      ["Successful payments", report.payment_count],
      ["Average daily sales", summary.average.toFixed(2)],
      [],
      ["Date", "Sales"],
      ...reportDays.map((item) => [item.date, item.sales.toFixed(2)]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
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
            <span className="ad-eyebrow">Aurevo · Sales report</span>
            <h2>{formatReportDate(report.start_date)} – {formatReportDate(report.end_date)}</h2>
          </header>

          <section className="ad-stats admin-report-stats">
            <StatCard label="Total Paid Sales" value={formatCurrency(report.total_sales)} icon="rupee" accent />
            <StatCard label="Successful Payments" value={report.payment_count ?? 0} icon="check" />
            <StatCard label="Average Daily Sales" value={formatCurrency(summary.average)} icon="bar-chart" />
            <StatCard label="Days With Sales" value={`${summary.activeDays} / ${reportDays.length}`} icon="calendar" />
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
                  <tr><th>Date</th><th>Sales</th><th>Share of total</th></tr>
                </thead>
                <tbody>
                  {[...reportDays].reverse().map((item) => (
                    <tr key={item.date}>
                      <td>{formatReportDate(item.date)}</td>
                      <td>{formatCurrency(item.sales)}</td>
                      <td>{Number(report.total_sales) > 0 ? `${((item.sales / Number(report.total_sales)) * 100).toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                  {reportDays.length === 0 && <tr><td colSpan="3">No days in this date range.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

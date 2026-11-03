
import { useEffect, useState } from "react";
import {
  getAdminWalletOverview,
  getAdminWalletTransactions,
  getAdminWalletCustomers,
} from "../api/admin";
import Icon from "../components/Icon";
import { Pagination, Pill, StatCard } from "../components/ui";
import "../admin.css";

function csvCell(value) {
  const text = String(value ?? "");
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export default function Wallet() {
  const [overview, setOverview] = useState({
    total_balance: 0,
    customer_count: 0,
    total_credited: 0,
    total_debited: 0,
  });

  const [transactions, setTransactions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tab, setTab] = useState("transactions");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const pageSize = 10;

  function exportCurrentPage() {
    const rows = tab === "transactions"
      ? [
          ["Customer", "Email", "Type", "Reference", "Description", "Date", "Amount"],
          ...transactions.map((item) => [
            item.customer_name,
            item.email,
            item.transaction_type,
            item.reference,
            item.description,
            new Date(item.created_at).toLocaleString("en-IN"),
            item.amount,
          ]),
        ]
      : [
          ["Customer", "Email", "Wallet Balance"],
          ...customers.map((customer) => [
            customer.customer_name,
            customer.email,
            customer.balance,
          ]),
        ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `wallet-${tab}-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const money = (value) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(Number(value || 0));

  useEffect(() => {
    getAdminWalletOverview()
      .then((response) => setOverview(response.data))
      .catch(() => setError("Could not load wallet summary."));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const params = {
          search,
          page,
          page_size: pageSize,
        };

        const response =
          tab === "transactions"
            ? await getAdminWalletTransactions({ ...params, type })
            : await getAdminWalletCustomers(params);

        if (cancelled) return;

        setCount(response.data.count);
        if (tab === "transactions") {
          setTransactions(response.data.results);
        } else {
          setCustomers(response.data.results);
        }
      } catch {
        if (!cancelled) {
          setError("Could not load wallet data. Check your admin API.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tab, search, type, page]);

  return (
    <div className="wallet-page">
      <div className="ad-crumbs">Finance / <b>Wallet management</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Wallet Management</h1>
          <p className="ad-sub">
            Monitor customer wallet balances and transaction history.
          </p>
        </div>
      </div>

      <section className="ad-stats">
        <StatCard label="Wallet balance" value={money(overview.total_balance)} icon="wallet" foot="across customer accounts" />
        <StatCard label="Wallet customers" value={overview.customer_count} icon="users" foot="with a wallet account" />
        <StatCard label="Total credited" value={money(overview.total_credited)} icon="trending-up" deltaTone="up" foot="all-time credits" />
        <StatCard label="Total debited" value={money(overview.total_debited)} icon="receipt" deltaTone="down" foot="all-time debits" />
      </section>

      <div className="ad-seg" role="group" aria-label="Wallet data view">
          <button
            type="button"
            className={tab === "transactions" ? "on" : ""}
            aria-pressed={tab === "transactions"}
            onClick={() => {
              setTab("transactions");
              setPage(1);
            }}
          >
            Transactions
          </button>

          <button
            type="button"
            className={tab === "customers" ? "on" : ""}
            aria-pressed={tab === "customers"}
            onClick={() => {
              setTab("customers");
              setPage(1);
            }}
          >
            Customer Wallets
          </button>
      </div>

      <section className="ad-toolbar" aria-label="Wallet filters">
          <div className="ad-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              value={search}
              aria-label={tab === "transactions" ? "Search transactions" : "Search customer wallets"}
              placeholder={tab === "transactions" ? "Search customer, email or reference..." : "Search customer or email..."}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>

          {tab === "transactions" && (
            <label className="ad-select-inline">
              Type
              <select
                className="ad-select"
                value={type}
                aria-label="Transaction type"
                onChange={(event) => {
                  setType(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All transactions</option>
                <option value="credit">Credits</option>
                <option value="debit">Debits</option>
              </select>
            </label>
          )}
          <button
            type="button"
            className="ad-btn"
            onClick={exportCurrentPage}
            disabled={loading || (tab === "transactions" ? transactions.length === 0 : customers.length === 0)}
          >
            <Icon name="download" size={15} />
            Export page CSV
          </button>
      </section>

      {error && <div className="ad-alert" role="alert">{error}</div>}

      <section className="ad-card" aria-label="Wallet records">
        <div className="wallet-table-wrap">
          {tab === "transactions" ? (
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Transaction</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5" className="wallet-empty">
                      Loading transactions...
                    </td>
                  </tr>
                ) : transactions.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="wallet-empty">
                      No transactions found.
                    </td>
                  </tr>
                ) : (
                  transactions.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.customer_name}</strong>
                        <div className="ad-cell-sub">{item.email}</div>
                      </td>
                      <td>
                        <Pill tone={item.transaction_type === "credit" ? "ok" : "bad"}>
                          {item.transaction_type}
                        </Pill>
                        <div className="ad-cell-sub">{item.description || "—"}</div>
                      </td>
                      <td>{item.reference || "—"}</td>
                      <td>
                        {new Date(item.created_at).toLocaleString("en-IN")}
                      </td>
                      <td
                        className={
                          item.transaction_type === "credit"
                            ? "wallet-positive"
                            : "wallet-negative"
                        }
                      >
                        {item.transaction_type === "credit" ? "+" : "−"}
                        {money(item.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="ad-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Email</th>
                  <th>Wallet Balance</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="3" className="wallet-empty">
                      Loading wallets...
                    </td>
                  </tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="wallet-empty">
                      No customer wallets found.
                    </td>
                  </tr>
                ) : (
                  customers.map((customer) => (
                    <tr key={customer.id}>
                      <td>{customer.customer_name}</td>
                      <td>{customer.email}</td>
                      <td>{money(customer.balance)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        <Pagination page={page} pageSize={pageSize} count={count} noun="wallet records" onChange={setPage} />
      </section>
    </div>
  );
}

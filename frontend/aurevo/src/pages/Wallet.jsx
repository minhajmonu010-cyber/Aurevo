
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AccountLayout from "../Components/AccountLayout";
import { getWallet } from "../api/wallet";
import "../styles/wallet.css";

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDate = (value) =>
  new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;

    getWallet()
      .then((response) => {
        if (active) setWallet(response.data);
      })
      .catch((err) => {
        if (active) {
          setError(
            err.response?.data?.detail ||
              "Unable to load your wallet. Please sign in and try again."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const transactions = wallet?.transactions || [];
  const filteredTransactions = transactions.filter((item) => {
    if (filter === "all") return true;
    return item.transaction_type === filter;
  });

  return (
    <AccountLayout>
      <main className="wallet-page">
        <div className="wallet-container">
          <div className="wallet-breadcrumb">
            <Link to="/">Home</Link>
            <span>/</span>
            <span>My Wallet</span>
          </div>

          <header className="wallet-heading">
            <div>
              <p className="wallet-eyebrow">YOUR AUREVO ACCOUNT</p>
              <h1>My Wallet</h1>
              <p className="wallet-subtitle">
                Keep track of your wallet balance and transactions.
              </p>
            </div>
            <div className="wallet-heading-icon" aria-hidden="true">
              ₹
            </div>
          </header>

          {loading && (
            <div className="wallet-message">Loading your wallet...</div>
          )}

          {!loading && error && (
            <div className="wallet-message wallet-error">
              {error}
              <button
                onClick={() => window.location.reload()}
                className="wallet-retry"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && wallet && (
            <>
              <section className="wallet-balance-card">
                <div className="wallet-balance-top">
                  <div>
                    <p className="wallet-card-label">AVAILABLE BALANCE</p>
                    <h2>{money(wallet.balance)}</h2>
                  </div>
                  <span className="wallet-card-symbol">₹</span>
                </div>

                <div className="wallet-card-bottom">
                  <span>
                    <span className="wallet-live-dot" />
                    Wallet active
                  </span>
                  <span>
                    Updated{" "}
                    {wallet.updated_at
                      ? formatDate(wallet.updated_at)
                      : "recently"}
                  </span>
                </div>
              </section>

              <section className="wallet-info-grid">
                <article className="wallet-info-card">
                  <span className="wallet-info-icon credit-icon">↙</span>
                  <div>
                    <p>Total credits</p>
                    <h3>
                      {money(
                        transactions
                          .filter((t) => t.transaction_type === "credit")
                          .reduce(
                            (sum, t) => sum + Number(t.amount || 0),
                            0
                          )
                      )}
                    </h3>
                  </div>
                </article>

                <article className="wallet-info-card">
                  <span className="wallet-info-icon debit-icon">↗</span>
                  <div>
                    <p>Total debits</p>
                    <h3>
                      {money(
                        transactions
                          .filter((t) => t.transaction_type === "debit")
                          .reduce(
                            (sum, t) => sum + Number(t.amount || 0),
                            0
                          )
                      )}
                    </h3>
                  </div>
                </article>
              </section>

              <section className="wallet-transactions">
                <div className="wallet-transactions-heading">
                  <div>
                    <h2>Transaction history</h2>
                    <p>Review the activity in your wallet.</p>
                  </div>

                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    aria-label="Filter transactions"
                  >
                    <option value="all">All transactions</option>
                    <option value="credit">Credits</option>
                    <option value="debit">Debits</option>
                  </select>
                </div>

                {filteredTransactions.length === 0 ? (
                  <div className="wallet-empty">
                    <div className="wallet-empty-icon">₹</div>
                    <h3>No transactions yet</h3>
                    <p>
                      Wallet credits, refunds and eligible wallet activity
                      will appear here.
                    </p>
                    <Link to="/">Explore collection</Link>
                  </div>
                ) : (
                  <div className="wallet-table-wrap">
                    <table className="wallet-table">
                      <thead>
                        <tr>
                          <th>Transaction</th>
                          <th>Date</th>
                          <th>Reference</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTransactions.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <div className="wallet-transaction-name">
                                <span
                                  className={`wallet-transaction-icon ${
                                    item.transaction_type === "credit"
                                      ? "credit-icon"
                                      : "debit-icon"
                                  }`}
                                >
                                  {item.transaction_type === "credit"
                                    ? "↓"
                                    : "↑"}
                                </span>
                                <div>
                                  <strong>{item.description}</strong>
                                  <small>
                                    {item.transaction_type === "credit"
                                      ? "Credit"
                                      : "Debit"}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>{formatDate(item.created_at)}</td>
                            <td>{item.reference || "—"}</td>
                            <td
                              className={
                                item.transaction_type === "credit"
                                  ? "wallet-credit-amount"
                                  : "wallet-debit-amount"
                              }
                            >
                              {item.transaction_type === "credit" ? "+" : "−"}
                              {money(item.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="wallet-mobile-list">
                      {filteredTransactions.map((item) => (
                        <article className="wallet-mobile-item" key={item.id}>
                          <div>
                            <strong>{item.description}</strong>
                            <p>{formatDate(item.created_at)}</p>
                            {item.reference && (
                              <small>Ref: {item.reference}</small>
                            )}
                          </div>
                          <strong
                            className={
                              item.transaction_type === "credit"
                                ? "wallet-credit-amount"
                                : "wallet-debit-amount"
                            }
                          >
                            {item.transaction_type === "credit" ? "+" : "−"}
                            {money(item.amount)}
                          </strong>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </AccountLayout>
  );
}

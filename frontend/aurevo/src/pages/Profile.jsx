import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getOrders } from "../api/orders";
import AccountLayout from "../Components/AccountLayout";
import Avatar from "../Components/Avatar";
import ConfirmDialog from "../Components/ConfirmDialog";
import Icon from "../Components/Icon";
import { useAuth } from "../context/authState";

const money = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const orderDate = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : parsed.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = location.state?.message; // "Profile updated." after saving

  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");

  async function loadShoppingDetails() {
    setOrdersLoading(true);
    setOrdersError("");
    try {
      const { data } = await getOrders();
      setOrders(Array.isArray(data) ? data : data.results || []);
    } catch (error) {
      setOrdersError(
        error.response?.data?.detail ||
          "Shopping details could not be loaded. Please try again."
      );
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadShoppingDetails);
  }, []);

  const handleLogout = async () => {
    setLeaving(true);
    await logout();
    navigate("/", { replace: true });
  };

  const createdAt = new Date(user.created_at);
  const memberSince = Number.isNaN(createdAt.getTime())
    ? "Not available"
    : createdAt.toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
      });
  const accountCreatedOn = Number.isNaN(createdAt.getTime())
    ? "Not available"
    : createdAt.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
  const profileItems = [
    Boolean(user.full_name?.trim()),
    Boolean(user.email?.trim()),
    Boolean(user.phone?.trim()),
    Boolean(user.profile_image),
  ];
  const profileCompletion = Math.round(
    (profileItems.filter(Boolean).length / profileItems.length) * 100
  );
  const placedOrders = orders.filter((order) => order.order_status !== "cancelled");
  const deliveredOrders = orders.filter((order) => order.order_status === "delivered");
  const activeOrders = orders.filter((order) =>
    ["pending", "processing", "shipped"].includes(order.order_status)
  );
  const itemCount = placedOrders.reduce(
    (total, order) =>
      total +
      (order.items || []).reduce(
        (orderTotal, item) => orderTotal + Number(item.quantity || 0),
        0
      ),
    0
  );
  const orderValue = placedOrders.reduce(
    (total, order) => total + Number(order.total_amount || 0),
    0
  );
  const recentOrders = orders.slice(0, 3);

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(user.email);
      setEmailMessage("Email copied to clipboard.");
    } catch {
      setEmailMessage("Could not copy email. Select and copy it manually.");
    }
  };

  return (
    <AccountLayout>
      <section className="profile-card" aria-labelledby="profile-title">
        {notice && (
          <div className="alert success" role="status">
            {notice}
          </div>
        )}

        <div className="profile-header">
          <div className="profile-identity">
            <Avatar user={user} size={88} glow />
            <div>
              <p className="profile-eyebrow">ACCOUNT PROFILE</p>
              <h1 id="profile-title" className="profile-title">
                {user.full_name}
              </h1>
              <p className="member-since">Member since {memberSince}</p>
            </div>
          </div>
          <Link to="/profile/edit" className="act-btn edit">
            <Icon name="pencil" size={16} /> Edit
          </Link>
        </div>

        <div className="info-grid">
          <div className="info-tile">
            <span className="info-label">Name</span>
            <span className="info-value">
              {user.is_verified && <Icon name="badge-check" size={18} />}
              {user.full_name}
            </span>
          </div>
          <div className="info-tile">
            <span className="info-label">Email</span>
            <span className="info-value">
              <Icon name="mail" size={18} />
              {user.email}
              <button
                type="button"
                className="profile-copy-email"
                onClick={copyEmail}
                aria-label="Copy email address"
              >
                Copy
              </button>
            </span>
          </div>
          <div className="info-tile">
            <span className="info-label">Phone</span>
            <span className={`info-value${user.phone ? "" : " is-empty"}`}>
              <Icon name="phone" size={18} />
              {user.phone || "Not added yet"}
            </span>
          </div>
        </div>

        {emailMessage && (
          <p className="profile-email-message" role="status">{emailMessage}</p>
        )}

        <section className="profile-account-details" aria-labelledby="account-details-title">
          <div className="profile-details-heading">
            <div>
              <p className="profile-eyebrow">ACCOUNT</p>
              <h2 id="account-details-title">Account details</h2>
            </div>
          </div>
          <dl className="profile-details-list">
            <div>
              <dt>Account ID</dt>
              <dd>{user.id ? `#${user.id}` : "Not available"}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd className={user.is_verified ? "verified" : "unverified"}>
                <Icon name={user.is_verified ? "badge-check" : "clock"} size={15} />
                {user.is_verified ? "Verified account" : "Verification pending"}
              </dd>
            </div>
            <div>
              <dt>Account created</dt>
              <dd>{accountCreatedOn}</dd>
            </div>
          </dl>
        </section>

        <section className="profile-completion" aria-labelledby="profile-completion-title">
          <div className="profile-completion-header">
            <div>
              <p className="profile-eyebrow">PROFILE SETUP</p>
              <h2 id="profile-completion-title">Profile completeness</h2>
            </div>
            <strong>{profileCompletion}%</strong>
          </div>
          <div
            className="profile-completion-track"
            role="progressbar"
            aria-label="Profile completeness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={profileCompletion}
          >
            <span style={{ width: `${profileCompletion}%` }} />
          </div>
          <div className="profile-completion-checks">
            <span className={profileItems[0] ? "complete" : ""}>
              <Icon name={profileItems[0] ? "badge-check" : "user"} size={14} />
              Name
            </span>
            <span className={profileItems[1] ? "complete" : ""}>
              <Icon name={profileItems[1] ? "badge-check" : "mail"} size={14} />
              Email
            </span>
            <span className={profileItems[2] ? "complete" : ""}>
              <Icon name={profileItems[2] ? "badge-check" : "phone"} size={14} />
              Phone
            </span>
            <span className={profileItems[3] ? "complete" : ""}>
              <Icon name={profileItems[3] ? "badge-check" : "camera"} size={14} />
              Photo
            </span>
          </div>
        </section>

        <div className="profile-actions">
          <Link to="/change-password" className="act-btn security">
            <Icon name="key" size={16} /> Security
          </Link>
          <button type="button" className="act-btn logout" onClick={() => setConfirming(true)}>
            <Icon name="log-out" size={16} /> Logout
          </button>
        </div>
      </section>

      <section className="profile-shopping" aria-labelledby="profile-shopping-title">
        <div className="profile-shopping-heading">
          <div>
            <p className="profile-eyebrow">YOUR ACTIVITY</p>
            <h2 id="profile-shopping-title">Shopping details</h2>
            <p>Your purchases and current order activity.</p>
          </div>
          <button
            type="button"
            className="profile-shopping-refresh"
            onClick={loadShoppingDetails}
            disabled={ordersLoading}
          >
            {ordersLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {ordersError && (
          <div className="profile-shopping-error" role="alert">
            <span>{ordersError}</span>
            <button type="button" onClick={loadShoppingDetails} disabled={ordersLoading}>
              Retry
            </button>
          </div>
        )}

        <div className="profile-shopping-stats">
          <div>
            <span>Total orders</span>
            <strong>{ordersLoading ? "—" : orders.length}</strong>
          </div>
          <div>
            <span>In progress</span>
            <strong>{ordersLoading ? "—" : activeOrders.length}</strong>
          </div>
          <div>
            <span>Delivered</span>
            <strong>{ordersLoading ? "—" : deliveredOrders.length}</strong>
          </div>
          <div>
            <span>Items ordered</span>
            <strong>{ordersLoading ? "—" : itemCount}</strong>
          </div>
          <div>
            <span>Order value*</span>
            <strong>{ordersLoading ? "—" : money(orderValue)}</strong>
          </div>
        </div>
        <p className="profile-shopping-footnote">
          *Total of orders placed, excluding cancelled orders.
        </p>

        <div className="profile-shopping-recent">
          <div className="profile-shopping-recent-heading">
            <h3>Recent orders</h3>
            <Link to="/orders">View order history</Link>
          </div>
          {ordersLoading ? (
            <p className="profile-shopping-empty">Loading your order history...</p>
          ) : recentOrders.length ? (
            <div className="profile-shopping-order-list">
              {recentOrders.map((order) => {
                const products = (order.items || [])
                  .map((item) => `${item.product_name} × ${item.quantity}`)
                  .slice(0, 2);
                return (
                  <Link className="profile-shopping-order" to="/orders" key={order.id}>
                    <span className="profile-shopping-order-icon">
                      <Icon name="package" size={17} />
                    </span>
                    <span className="profile-shopping-order-copy">
                      <strong>{order.order_number}</strong>
                      <small>{orderDate(order.created_at)}</small>
                      <small>{products.join(" · ") || "Order items"}</small>
                    </span>
                    <span className="profile-shopping-order-meta">
                      <strong>{money(order.total_amount)}</strong>
                      <small className={`profile-shopping-status ${order.order_status}`}>
                        {String(order.order_status || "pending").replaceAll("_", " ")}
                      </small>
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="profile-shopping-empty">
              <span>No orders yet.</span>
              <Link to="/categories">Browse products</Link>
            </div>
          )}
        </div>
      </section>

      {confirming && (
        <ConfirmDialog
          title="Log out?"
          text="You will need to sign in again to see your profile."
          confirmLabel="Log out"
          danger
          busy={leaving}
          onConfirm={handleLogout}
          onCancel={() => setConfirming(false)}
        />
      )}
    </AccountLayout>
  );
}
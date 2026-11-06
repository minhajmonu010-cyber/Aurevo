import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { getDashboardOrders, getInventory } from "../api/admin";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { formatWhen, initials } from "../utils/format";
import Icon from "./Icon";
import Logo from "./Logo";
import { Modal } from "./ui";

// sidebar navigation items
const NAV = [
  { to: "/", label: "Dashboard", icon: "layout-dashboard", end: true },
  { to: "/categories", label: "Categories", icon: "shapes" },
  { to: "/products", label: "Products", icon: "hanger" },
  { to:"/inventory",label: "Inventory", icon: "archive"},
  { to:"/orders",label: "Orders", icon: "receipt"},
  { to:"/returns",label: "Returns", icon: "undo"},
  { to:"/customers",label: "Customers", icon: "users"},
  { to:"/coupons",label: "Coupons", icon: "ticket"},
  { to:"/reviews",label: "Reviews", icon: "star"},
  { to:"/wallet",label: "Wallet", icon: "wallet"},
  { to:"/offers",label: "Offers", icon: "tag"},
  { to:"/reports",label: "Reports", icon: "bar-chart"},
  { to:"/profile",label: "Profile", icon: "user"},
];

const TITLES = [
  ["/categories", "Category Taxonomy"],
  ["/products", "Product Catalog"],
  ["/inventory", "Inventory"],
  ["/orders", "Orders"],
  ["/returns", "Returns"],
  ["/coupons", "Coupons"],
  ["/reports", "Sales Reports"],
  ["/profile", "Admin Profile"],
  ["/", "Dashboard"],
];

const THEME_KEY = "aurevo-admin-theme";
const NOTIFICATION_READ_KEY = "aurevo-admin-notifications-read";

function loadReadNotifications() {
  try {
    const value = JSON.parse(localStorage.getItem(NOTIFICATION_READ_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuState, setMenuState] = useState({ path: pathname, open: false });
  const menuOpen = menuState.path === pathname && menuState.open;
  const setMenuOpen = (open) => setMenuState({ path: pathname, open });
  const [userMenu, setUserMenu] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [search, setSearch] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationOrders, setNotificationOrders] = useState([]);
  const [notificationInventory, setNotificationInventory] = useState([]);
  const [notificationError, setNotificationError] = useState("");
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationRefresh, setNotificationRefresh] = useState(0);
  const [readNotifications, setReadNotifications] = useState(loadReadNotifications);
  const notificationsRef = useRef(null);

  const title = (TITLES.find(([prefix]) => (prefix === "/" ? pathname === "/" : pathname.startsWith(prefix))) || [null, "Admin"])[1];

  useEffect(() => localStorage.setItem(THEME_KEY, theme), [theme]);
  useEffect(() => localStorage.setItem(NOTIFICATION_READ_KEY, JSON.stringify(readNotifications)), [readNotifications]);
  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    let active = true;

    async function loadNotifications() {
      setNotificationsLoading(true);
      setNotificationError("");
      try {
        const [orders, inventory] = await Promise.all([
          getDashboardOrders({ page: 1, page_size: 8 }),
        getInventory({ status: "alerts", page: 1, page_size: 12 }),
        ]);
        if (active) {
          setNotificationOrders(orders.results || []);
          setNotificationInventory(inventory.results || []);
        }
      } catch (requestError) {
        if (active) {
          setNotificationError(
            requestError.response?.data?.detail || "Notifications could not be loaded. Check your connection and try again."
          );
        }
      } finally {
        if (active) setNotificationsLoading(false);
      }
    }

    // This effect synchronizes a refresh request with the notifications API.
    void Promise.resolve().then(loadNotifications);
    return () => {
      active = false;
    };
  }, [notificationsOpen, notificationRefresh]);

  const notifications = useMemo(() => {
    const lowStock = notificationInventory
      .filter((item) => item.status === "low" || item.status === "out")
      .map((item) => ({
        id: `stock-${item.id}`,
        type: item.status === "out" ? "out" : "low",
        title: item.status === "out" ? "Out of stock" : "Low stock",
        message: `${item.product_name}${item.size || item.color ? ` · ${[item.size, item.color].filter(Boolean).join(" / ")}` : ""} — ${item.stock} left`,
        when: null,
        to: "/inventory",
      }));
    const recentOrders = notificationOrders.map((order) => ({
      id: `order-${order.id}`,
      type: "order",
      title: `Order #${order.order_number}`,
      message: `${order.customer.name} · ${order.items_count} ${order.items_count === 1 ? "item" : "items"}`,
      when: order.created_at,
      to: "/",
    }));
    return [...recentOrders, ...lowStock].slice(0, 12);
  }, [notificationInventory, notificationOrders]);

  const unreadCount = notifications.filter((item) => !readNotifications.includes(item.id)).length;

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const submitSearch = (e) => {
    e.preventDefault();
    if (search.trim()) navigate(`/products?search=${encodeURIComponent(search.trim())}`);
  };

  function markNotificationRead(id) {
    setReadNotifications((current) => current.includes(id) ? current : [...current, id]);
  }

  function markAllNotificationsRead() {
    setReadNotifications((current) => [...new Set([...current, ...notifications.map((item) => item.id)])]);
  }

  return (
    <div className="ad-app" data-theme={theme}>
      <aside className={`ad-side${menuOpen ? " open" : ""}`}>
        <Link to="/" className="ad-side-brand" aria-label="Dashboard">
          <Logo />
        </Link>
        <div className="ad-nav-label">NAVIGATION</div>
        <nav className="ad-nav" aria-label="Main">
          {NAV.map((item) =>
            item.soon ? (
              <button type="button" key={item.label} className="ad-nav-item soon" onClick={() => toast.show(`${item.label} is coming soon.`)}>
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
                <em>Soon</em>
              </button>
            ) : (
              <NavLink key={item.label} to={item.to} end={item.end} className={({ isActive }) => `ad-nav-item${isActive ? " active" : ""}`}>
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>
        <div className="ad-side-foot">
          <span className={`ad-status${online ? "" : " off"}`}>
            <i /> {online ? "Network online" : "Browser offline"}
          </span>
          <span>v1.0</span>
        </div>
      </aside>
      {menuOpen && <div className="ad-scrim" onClick={() => setMenuOpen(false)} />}

      <div className="ad-main">
        <header className="ad-top">
          <button type="button" className="ad-icon-btn ad-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Icon name="menu" size={18} />
          </button>
          <h2 className="ad-top-title">{title}</h2>
          <form className="ad-top-search" onSubmit={submitSearch} role="search">
            <Icon name="search" size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products by name or SKU…" aria-label="Search products" />
          </form>
          <div className="ad-notifications-wrap" ref={notificationsRef}>
            <button
              type="button"
              className="ad-icon-btn ad-notifications-button"
              onClick={() => setNotificationsOpen((open) => !open)}
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
              aria-expanded={notificationsOpen}
              aria-haspopup="dialog"
            >
              <Icon name="bell" size={17} />
              {unreadCount > 0 && <span className="ad-notifications-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {notificationsOpen && (
              <section className="ad-notifications-panel" role="dialog" aria-label="Notifications">
                <header className="ad-notifications-head">
                  <div>
                    <h3>Notifications</h3>
                    <span>{unreadCount ? `${unreadCount} unread` : "You're all caught up"}</span>
                  </div>
                  <div className="ad-notifications-actions">
                    <button type="button" className="ad-icon-btn" onClick={() => {
                      setNotificationsLoading(true);
                      setNotificationRefresh((value) => value + 1);
                    }} aria-label="Refresh notifications" disabled={notificationsLoading}>
                      <Icon name="refresh" size={15} />
                    </button>
                    {unreadCount > 0 && (
                      <button type="button" className="ad-link" onClick={markAllNotificationsRead}>Mark all read</button>
                    )}
                  </div>
                </header>
                {notificationError && (
                  <div className="ad-notifications-error" role="alert">
                    <span>{notificationError}</span>
                    <button type="button" className="ad-link" onClick={() => {
                      setNotificationsLoading(true);
                      setNotificationRefresh((value) => value + 1);
                    }}>Retry</button>
                  </div>
                )}
                {notificationsLoading && notifications.length === 0 ? (
                  <div className="ad-notifications-empty">Loading notifications...</div>
                ) : notifications.length === 0 && !notificationError ? (
                  <div className="ad-notifications-empty">
                    <Icon name="bell" size={22} />
                    <b>No notifications yet</b>
                    <span>New orders and stock alerts will appear here.</span>
                  </div>
                ) : (
                  <div className="ad-notifications-list">
                    {notifications.map((item) => {
                      const read = readNotifications.includes(item.id);
                      const icon = item.type === "order" ? "receipt" : item.type === "out" ? "alert-triangle" : "archive";
                      return (
                        <button
                          type="button"
                          className={`ad-notification${read ? " read" : ""}`}
                          key={item.id}
                          onClick={() => {
                            markNotificationRead(item.id);
                            setNotificationsOpen(false);
                            navigate(item.to);
                          }}
                        >
                          <span className={`ad-notification-icon ${item.type}`}><Icon name={icon} size={16} /></span>
                          <span className="ad-notification-copy">
                            <b>{item.title}</b>
                            <span>{item.message}</span>
                            {item.when && <small>{formatWhen(item.when)}</small>}
                          </span>
                          {!read && <i className="ad-notification-unread" aria-label="Unread" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                <footer className="ad-notifications-foot">
                  <span>Refresh to check for updates</span>
                  <button type="button" className="ad-link" onClick={() => { setNotificationsOpen(false); navigate("/inventory"); }}>
                    View inventory
                  </button>
                </footer>
              </section>
            )}
          </div>
          <div className="ad-user-wrap">
            <button type="button" className="ad-user" onClick={() => setUserMenu((v) => !v)} aria-expanded={userMenu} aria-haspopup="menu">
              <span className="ad-avatar">{initials(user.full_name || user.email)}</span>
              <span className="ad-user-text">
                <b>{user.full_name || user.email}</b>
                <small>Administrator</small>
              </span>
              <Icon name="chevron-down" size={14} />
            </button>
            {userMenu && (
              <div className="ad-menu" role="menu" onMouseLeave={() => setUserMenu(false)}>
                <div className="ad-menu-email">{user.email}</div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenu(false);
                    setConfirmLogout(true);
                  }}
                >
                  <Icon name="log-out" size={15} /> Log out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="ad-page">
          <Outlet context={{ theme, setTheme }} />
        </main>
      </div>

      {confirmLogout && (
        <Modal title="Log out?" width={420} onClose={() => setConfirmLogout(false)}
          footer={
            <>
              <button type="button" className="ad-btn ghost" onClick={() => setConfirmLogout(false)}>No, stay</button>
              <button type="button" className="ad-btn primary" onClick={logout}>Yes, log out</button>
            </>
          }>
          <p className="ad-modal-text">You will need to sign in again to manage the store.</p>
        </Modal>
      )}
    </div>
  );
}

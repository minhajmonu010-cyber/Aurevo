import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/authState";
import { useToast } from "../context/ToastContext";
import Avatar from "./Avatar";
import Icon from "./Icon";
import Logo from "./Logo";

// Only Profile is built so far. The other pages switch on when their route exists (add `to` and ready: true).
const ITEMS = [
  { label: "Home", to: "/", icon: "aurevo", ready: true, end: true },
  { label: "Profile", to: "/profile", icon: "user", ready: true },
  { label: "Wishlist", to: "/wishlist", icon: "heart", ready: true },
  { label: "Cart", to: "/cart", icon: "cart", ready: true },
  { label: "Address", to: "/address", icon: "map-pin", ready: true },
  { label: "Orders", to: "/orders", icon: "package", ready: true },
  { label: "Wallet", to: "/wallet", icon: "wallet", ready: true },
];

/** Header + side menu shared by the account pages (profile, and later address, orders, wishlist, wallet). */
export default function AccountLayout({ children }) {
  const { user } = useAuth();
  const toast = useToast();

  return (
    <div className="account-page">
      <header className="account-header">
        <Link to="/" aria-label="Back to the store" className="site-logo">
          <Logo />
        </Link>
        <Link to="/profile" aria-label="My profile">
          <Avatar user={user} size={36} />
        </Link>
      </header>

      <div className="account-body">
        <nav className="account-nav" aria-label="Account">
          {ITEMS.map((item) =>
            item.ready ? (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `side-link${isActive ? " active" : ""}`}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </NavLink>
            ) : (
              <button key={item.label} type="button" className="side-link disabled" onClick={() => toast(`${item.label} is coming soon.`)}>
                <Icon name={item.icon} size={18} />
                {item.label}
                <span className="soon">Soon</span>
              </button>
            )
          )}
        </nav>
        <main className="account-main">{children}</main>
      </div>
    </div>
  );
}
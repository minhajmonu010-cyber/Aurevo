import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { getProducts } from "../api/catalog";
import { useAuth } from "../context/authState";
import { useToast } from "../context/ToastContext";
import Avatar from "./Avatar";
import Icon from "./Icon";
import ImageSlot from "./ImageSlot";
import Logo from "./Logo";
import { formatPrice } from "../utils/format";
import { mediaUrl } from "../utils/media";

// ready: false = the page is not built yet, so the link only shows a message
const LINKS = [
  { to: "/", label: "Home", ready: true },
  { to: "/categories", label: "Shop", ready: true },
  { to: "/about", label: "About", ready: true },
  { to: "/contact", label: "Contact", ready: true },
];

// onSearch: the page that wants the words typed in the search box (the home page filters its products with it)
export default function SiteHeader({ onSearch, suggestedCategories = [], onCategorySelect }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [productSearch, setProductSearch] = useState({
    query: "",
    items: [],
    loading: false,
    error: false,
  });
  const toast = useToast();
  const soon = (what) => () => toast(`${what} is coming soon.`);
  const query = text.trim();
  const productSuggestions = productSearch.query === query ? productSearch.items : [];
  const categorySuggestions = query
    ? suggestedCategories
      .filter((category) => category.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5)
    : [];
  const hasSuggestions = productSuggestions.length > 0 || categorySuggestions.length > 0;
  const showSuggestionStatus =
    productSearch.query === query && (productSearch.loading || productSearch.error);

  useEffect(() => {
    if (query.length < 2) return undefined;

    let active = true;
    const timer = window.setTimeout(() => {
      setProductSearch({ query, items: [], loading: true, error: false });
      getProducts({ search: query, page: 1, page_size: 5 })
        .then((response) => {
          if (active) {
            setProductSearch({
              query,
              items: response.results,
              loading: false,
              error: false,
            });
          }
        })
        .catch(() => {
          if (active) {
            setProductSearch({ query, items: [], loading: false, error: true });
          }
        });
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="site-logo" aria-label="Home">
          <Logo />
        </Link>

        <nav className="site-nav" aria-label="Main">
          {LINKS.map((link) =>
            link.ready ? (
              <NavLink key={link.label} to={link.to} end className={({ isActive }) => (isActive ? "active" : "")}>
                {link.label}
              </NavLink>
            ) : (
              <button key={link.label} type="button" className="nav-soon" onClick={soon(link.label)}>
                {link.label}
              </button>
            )
          )}
        </nav>

        <div className="site-tools">
          <div className="search-wrap">
            <form
              className="search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const searchTerm = text.trim();
                if (onSearch) {
                  onSearch(searchTerm);
                } else if (searchTerm) {
                  navigate(`/?search=${encodeURIComponent(searchTerm)}`);
                }
              }}
            >
              <Icon name="search" size={15} />
              <input
                type="search"
                placeholder="Search outfits..."
                aria-label="Search outfits"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={hasSuggestions || showSuggestionStatus}
                aria-controls="product-search-suggestions"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (onSearch && e.target.value === "") onSearch(""); // the little x of the search box
                }}
              />
            </form>
            {(hasSuggestions || showSuggestionStatus) && (
              <div className="search-suggestions" id="product-search-suggestions" role="listbox" aria-label="Search suggestions">
                {productSuggestions.map((product) => (
                  <Link
                    key={product.id}
                    to={`/products/${product.slug}`}
                    role="option"
                    aria-selected="false"
                    className="product-search-suggestion"
                    onClick={() => setText("")}
                  >
                    <ImageSlot
                      src={mediaUrl(product.image)}
                      alt=""
                      className="product-search-suggestion-image"
                    />
                    <span className="product-search-suggestion-copy">
                      <span className="product-search-suggestion-name">{product.name}</span>
                      <span className="product-search-suggestion-details">
                        {product.brand && <span>{product.brand}</span>}
                        <span>{formatPrice(product.price)}</span>
                        <span className={product.in_stock ? "in-stock" : "out-of-stock"}>
                          {product.in_stock ? "In stock" : "Out of stock"}
                        </span>
                      </span>
                    </span>
                  </Link>
                ))}
                {categorySuggestions.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => {
                      onCategorySelect?.(category.slug);
                      setText("");
                    }}
                  >
                    {category.name}
                  </button>
                ))}
                {productSearch.query === query && productSearch.loading && (
                  <div className="search-suggestion-status" role="status">Searching products...</div>
                )}
                {productSearch.query === query && productSearch.error && (
                  <div className="search-suggestion-status" role="status">
                    Product suggestions are unavailable. Press Enter to search.
                  </div>
                )}
              </div>
            )}
          </div>
          <Link to="/wishlist" className="icon-btn" aria-label="Wishlist">
          <Icon name="heart" size={20} />
          </Link>
          <Link to="/cart" className="icon-btn" aria-label="Cart">
           <Icon name="cart" size={20} />
          </Link>
          {user ? (
            <Link to="/profile" className="icon-btn" aria-label="My profile">
              <Avatar user={user} size={30} />
            </Link>
          ) : (
            <Link to="/login" className="icon-btn" aria-label="Log in">
              <Icon name="user" size={20} />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
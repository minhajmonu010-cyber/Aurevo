import { useEffect, useMemo, useRef, useState } from "react";
import {
  addCartItem,
  addWishlistItem,
  getCategories,
  getOffers,
  getProduct,
  getWishlist,
  removeWishlistItem,
} from "../api/catalog";
import Icon from "../Components/Icon";
import ImageSlot from "../Components/ImageSlot";
import ProductRating from "../Components/ProductRating";
import SiteFooter from "../Components/SiteFooter";
import SiteHeader from "../Components/SiteHeader";
import { useToast } from "../context/ToastContext";
import { HERO } from "../data/home";
import { useFetch } from "../hooks/useFetch";
import { useProducts } from "../hooks/useProducts";
import { formatPrice } from "../utils/format";
import "../styles/catalog.css";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/authState";
import { Link } from "react-router-dom";

// a colour behind a picture that has not loaded (or a product without one)
const TINTS = ["#2b3a52", "#33333d", "#4d4436", "#4f4a22", "#2c4258", "#5a2c2f"];
const tintFor = (id) => TINTS[id % TINTS.length];

export default function Home({ catalogOnly = false }) {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const wishlistOwnerId = user?.id ?? null;
  const [wishlistState, setWishlistState] = useState({
    ownerId: null,
    items: {},
  });
  const wishlistItems =
    wishlistState.ownerId === wishlistOwnerId ? wishlistState.items : {};
  const [wishlistBusyIds, setWishlistBusyIds] = useState(() => new Set());
  const [purchaseBusyIds, setPurchaseBusyIds] = useState(() => new Set());
  const wishlistLoading = wishlistOwnerId != null && wishlistState.ownerId !== wishlistOwnerId;

  useEffect(() => {
    let active = true;
    if (wishlistOwnerId == null) return undefined;

    getWishlist()
      .then(({ items }) => {
        if (active) {
          setWishlistState({
            ownerId: wishlistOwnerId,
            items: items.reduce((saved, item) => {
              saved[item.product_id] = item.id;
              return saved;
            }, {}),
          });
        }
      })
      .catch(() => {
        if (active) {
          setWishlistState({
            ownerId: wishlistOwnerId,
            items: {},
          });
          toast("Could not load your wishlist.");
        }
      });

    return () => {
      active = false;
    };
  }, [wishlistOwnerId, toast]);

   const requireLogin = () => {
    if (user) return true;
    toast("Please log in first.");
    navigate("/login");
    return false;
  };

  const toggleWishlist = async (product) => {
    if (!requireLogin()) return;
    if (wishlistBusyIds.has(product.id)) return;

    setWishlistBusyIds((ids) => new Set(ids).add(product.id));
    try {
      const itemId = wishlistItems[product.id];
      if (itemId != null) {
        await removeWishlistItem(itemId);
        setWishlistState((state) => {
          if (state.ownerId !== wishlistOwnerId) return state;
          const items = state.items;
          const nextItems = { ...items };
          delete nextItems[product.id];
          return { ...state, items: nextItems };
        });
        toast(`${product.name} removed from your wishlist.`);
      } else {
        const item = await addWishlistItem(product.id);
        setWishlistState((state) =>
          state.ownerId === wishlistOwnerId
            ? {
                ...state,
                items: { ...state.items, [product.id]: item.id },
              }
            : state
        );
        toast(`${product.name} added to your wishlist.`);
      }
    } catch (error) {
      toast(
        error.response?.data?.detail ||
          `Could not ${wishlistItems[product.id] != null ? "remove from" : "add to"} wishlist.`
      );
    } finally {
      setWishlistBusyIds((ids) => {
        const nextIds = new Set(ids);
        nextIds.delete(product.id);
        return nextIds;
      });
    }
  };

  const addToCart = async (product) => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (purchaseBusyIds.has(product.id)) return;

    setPurchaseBusyIds((ids) => new Set(ids).add(product.id));
    try {
      const details = await getProduct(product.slug);
      const variant = details.variants.find(
        (option) => option.in_stock && option.stock > 0
      );

      if (!variant) {
        toast("This product is out of stock.");
        return;
      }

      await addCartItem(variant.id, 1);
      toast(`${product.name} added to your cart.`);
    } catch (error) {
      toast(
        error.response?.data?.quantity?.[0] ||
          error.response?.data?.detail ||
          "Could not add to cart."
      );
    } finally {
      setPurchaseBusyIds((ids) => {
        const nextIds = new Set(ids);
        nextIds.delete(product.id);
        return nextIds;
      });
    }
  };

  const buyNow = async (product) => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (purchaseBusyIds.has(product.id)) return;

    setPurchaseBusyIds((ids) => new Set(ids).add(product.id));
    try {
      const details = await getProduct(product.slug);
      const variant = details.variants.find(
        (option) => option.in_stock && option.stock > 0
      );

      if (!variant) {
        toast("This product is out of stock.");
        return;
      }

      navigate("/checkout", {
        state: {
          buyNow: {
            variant_id: variant.id,
            quantity: 1,
            name: details.name,
            image: details.image || product.image,
            size: variant.size,
            color: variant.color,
            price: variant.price,
            line_total: Number(variant.price),
          },
        },
      });
    } catch (error) {
      toast(
        error.response?.data?.detail ||
          "Could not start checkout. Please try again."
      );
    } finally {
      setPurchaseBusyIds((ids) => {
        const nextIds = new Set(ids);
        nextIds.delete(product.id);
        return nextIds;
      });
    }
  };

  const [category, setCategory] = useState(null); // a category slug, or null for everything
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") || "";
  const [ordering, setOrdering] = useState("featured");
  const productsSection = useRef(null);

  const categories = useFetch(
    () => getCategories(),
    [catalogOnly]
  );
  const offers = useFetch(
    () => (catalogOnly ? Promise.resolve([]) : getOffers()),
    [catalogOnly]
  );
  const products = useProducts({
    category,
    search,
    ordering,
    pageSize: catalogOnly ? 48 : 8,
    autoLoad: catalogOnly,
  });

  // featured categories first, the rest keep the order set in the admin
  const sorted = useMemo(() => [...(categories.data || [])].sort((a, b) => Number(b.is_featured) - Number(a.is_featured)), [categories.data]);
  const shownCategories = useMemo(() => {
    const featured = sorted.filter((item) => item.is_featured);
    if (featured.length >= 3) return featured;
    return [...featured, ...sorted.filter((item) => !item.is_featured).slice(0, 3 - featured.length)];
  }, [sorted]);
  const suggestedCategories = sorted.filter((item) => item.in_search_suggest);
  const showCategories = !catalogOnly && (categories.loading || sorted.length > 0);
  const categoryName = sorted.find((c) => c.slug === category)?.name;

  const goToProducts = () => requestAnimationFrame(() => productsSection.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const pickCategory = (slug) => {
    setCategory(slug);
    setSearchParams({});
    goToProducts();
  };
  const applySearch = (text) => {
    setSearchParams(text ? { search: text } : {}, { replace: true });
    if (text) {
      setCategory(null);
      goToProducts();
    }
  };
  const clearFilters = () => {
    setCategory(null);
    setSearchParams({});
  };
  const filtering = Boolean(category || search);

  return (
    <div className="store">
      <SiteHeader onSearch={applySearch} suggestedCategories={suggestedCategories} onCategorySelect={pickCategory} />

      <main>
        {/* big banner */}
        {!catalogOnly && (
          <section className="hero" aria-labelledby="hero-title">
            <ImageSlot src={HERO.image} tint={HERO.tint} className="hero-bg" />
            <div className="hero-shade" />
            <div className="hero-content">
              <p className="eyebrow">{}</p>
              <h1 id="hero-title">{HERO.title}</h1>
            </div>
          </section>
        )}

        {!catalogOnly && offers.data?.length > 0 && (
          <section className="home-offers" aria-labelledby="home-offers-title">
            <div className="home-offers-heading">
              <p className="eyebrow">AUREVO OFFERS</p>
              <h2 id="home-offers-title">Offers for your next find</h2>
            </div>
            <div className="home-offers-grid">
              {offers.data.map((offer) => {
                const targets = offer.target_names || [];
                const targetLabel = offer.applies_to === "products" ? "Selected products" : "Selected categories";
                const scope = offer.applies_to === "all"
                  ? "Across the collection"
                  : targets.length
                    ? `${targetLabel}: ${targets.slice(0, 3).join(", ")}${targets.length > 3 ? ` +${targets.length - 3} more` : ""}`
                    : targetLabel;
                return (
                  <article className="home-offer" key={offer.id}>
                    <div className="home-offer-value">
                      {offer.discount_type === "percentage"
                        ? `${Number(offer.discount_value)}%`
                        : formatPrice(offer.discount_value)}
                      <span>OFF</span>
                    </div>
                    <div className="home-offer-copy">
                      <h3>{offer.name}</h3>
                      <p>{offer.description || scope}</p>
                      {offer.description && <small>{scope}</small>}
                      <small>Ends {new Date(offer.end_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small>
                    </div>
                    <button type="button" className="home-offer-link" onClick={goToProducts}>
                      Shop <Icon name="arrow-right" size={15} />
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* categories: the featured ones from the admin */}
        {showCategories && (
          <section className="section" aria-labelledby="categories-title" id="categories">
            <div className="section-head">
              <div>
                <h2 id="categories-title">Trending Categories</h2>
                <p className="section-sub">Pick your favourite category to explore the latest drops.</p>
              </div>
              {sorted.length > 3 && (
                <button type="button" className="text-link" onClick={() => navigate("/categories")}>
                  View All Categories <Icon name="arrow-right" size={16} />
                </button>
              )}
            </div>
            <div className="cat-grid">
              {categories.loading
                ? [0, 1, 2].map((n) => (
                    <article key={n} className="cat-card is-skeleton" aria-hidden="true">
                      <div className="image-slot skeleton" />
                    </article>
                  ))
                : shownCategories.map((c) => (
                    <article key={c.id} className="cat-card">
                      <ImageSlot src={c.image} tint={tintFor(c.id)} alt={c.name} />
                      <div className="cat-shade" />
                      <div className="cat-text">
                        <h3>{c.name}</h3>
                        <p>{c.description || `${c.product_count} ${c.product_count === 1 ? "item" : "items"}`}</p>
                      </div>
                      <button type="button" className="btn-light" onClick={() => pickCategory(c.slug)}>
                        Shop Collection
                      </button>
                    </article>
                  ))}
            </div>
          </section>
        )}

        {/* products: what the admin added */}
        <section className={`section${catalogOnly ? " collections-section" : ""}`} aria-labelledby="products-title" id="products" ref={productsSection}>
          <div className="section-head">
            <div>
              <h2 id="products-title">{catalogOnly ? "All Products" : "Trending Products"}</h2>
              <p className="section-sub">
                {catalogOnly
                  ? "Browse the complete Aurevo collection."
                  : "Discover the hottest items selected just for you."}
              </p>
            </div>
            {catalogOnly && (
              <div className="collection-filters" aria-label="Filter and sort products">
                <label className="collection-filter">
                  <span>Category</span>
                  <select
                    value={category || ""}
                    onChange={(event) => setCategory(event.target.value || null)}
                    aria-label="Filter by category"
                  >
                    <option value="">All categories</option>
                    {sorted.map((item) => (
                      <option key={item.id} value={item.slug}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label className="collection-filter">
                  <span>Sort by</span>
                  <select
                    value={ordering}
                    onChange={(event) => setOrdering(event.target.value)}
                    aria-label="Sort products"
                  >
                    <option value="featured">Featured</option>
                    <option value="newest">Newest</option>
                    <option value="price_asc">Price: low to high</option>
                    <option value="price_desc">Price: high to low</option>
                  </select>
                </label>
              </div>
            )}
            {filtering && (
              <button type="button" className="btn-ghost" onClick={catalogOnly ? clearFilters : () => navigate("/categories")}>
                View All
              </button>
            )}
          </div>

          {filtering && (
            <div className="filter-row" role="status">
              <span>
                Showing{" "}
                {category && <b>{categoryName || "this category"}</b>}
                {category && search && " · "}
                {search && <>results for <b>“{search}”</b></>}
                {!products.loading && !products.error && <> ({products.count})</>}
              </span>
              <button type="button" className="text-link" onClick={clearFilters}>
                Clear
              </button>
            </div>
          )}

          <div className="product-grid">
            {products.loading ? (
              [0, 1, 2, 3].map((n) => (
                <div key={n} className="product-skeleton" aria-hidden="true">
                  <div className="media skeleton" />
                  <div className="line skeleton" />
                  <div className="line short skeleton" />
                </div>
              ))
            ) : products.error ? (
              <div className="state-box" role="alert">
                <h3>We couldn't load the products</h3>
                <p>{products.error.response ? "Something went wrong on our side." : "Can't reach the server. Check your connection."}</p>
                <button type="button" className="btn-ghost" onClick={products.reload}>
                  Try again
                </button>
              </div>
            ) : products.items.length === 0 ? (
              <div className="state-box">
                <h3>{filtering ? "Nothing matches" : "No products yet"}</h3>
                <p>{filtering ? "Try another category or a different word." : "New pieces will appear here as soon as they are added."}</p>
                {filtering && (
                  <button type="button" className="btn-ghost" onClick={clearFilters}>
                    Show everything
                  </button>
                )}
              </div>
            ) : (
              products.items.map((product) => (
                <article key={product.id} className="product-card">
                  <div className="product-media">
                    <Link to={`/products/${product.slug}`} aria-label={`View details for ${product.name}`}>
                      <ImageSlot src={product.image} tint={tintFor(product.id)} alt={product.name} />
                    </Link>
                    {product.discount_percent > 0 && <span className="badge-discount">-{product.discount_percent}%</span>}
                    {!product.in_stock && <span className="badge-soldout">Sold out</span>}
                    <button
                      type="button"
                      className={`wish-btn${wishlistItems[product.id] != null ? " is-active" : ""}`}
                      aria-label={`${wishlistItems[product.id] != null ? "Remove" : "Add"} ${product.name} ${wishlistItems[product.id] != null ? "from" : "to"} wishlist`}
                      aria-pressed={wishlistItems[product.id] != null}
                      aria-busy={wishlistBusyIds.has(product.id)}
                      disabled={wishlistLoading || wishlistBusyIds.has(product.id)}
                      onClick={() => toggleWishlist(product)}
                    >
                      <Icon name="heart" size={16} />
                    </button>
                    {catalogOnly && (
                      <button type="button" className="cart-btn" aria-label={`Add ${product.name} to cart`} disabled={!product.in_stock || purchaseBusyIds.has(product.id)} onClick={() => addToCart(product)}>
                        <Icon name="cart" size={16} />
                      </button>
                    )}
                  </div>
                  <div className="product-info">
                    <span className="product-cat">{product.category.name}</span>
                    <h3>
                      {product.name}
                    </h3> 
                    <ProductRating
                      averageRating={product.average_rating}
                      reviewCount={product.review_count}
                    />
                    <p className="price">
                      <strong>{formatPrice(product.price)}</strong>
                      {product.original_price && <s>{formatPrice(product.original_price)}</s>}
                    </p>
                    {catalogOnly && (
                      <button
                        type="button"
                        className="product-buy-now"
                        disabled={!product.in_stock || purchaseBusyIds.has(product.id)}
                        onClick={() => buyNow(product)}
                      >
                        {purchaseBusyIds.has(product.id) ? "Loading…" : "Buy now"}
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>

          {catalogOnly && products.loadingMore && (
            <p className="load-more-status" role="status">Loading remaining products…</p>
          )}
          {!catalogOnly && products.hasMore && (
            <div className="load-more">
              <button type="button" className="btn-ghost" onClick={products.loadMore} disabled={products.loadingMore}>
                {products.loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
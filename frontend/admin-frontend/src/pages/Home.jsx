import { useToast } from "../../../aurevo/src/context/ToastContext";
import Icon from "../components/Icon";
import ImageSlot from "../../../aurevo/src/Components/ImageSlot";
import SiteFooter from "../../../aurevo/src/Components/SiteFooter";
import SiteHeader from "../../../aurevo/src/Components/SiteHeader";
import { CATEGORIES, HERO, PRODUCTS } from "../../../aurevo/src/data/home";
import { discountPercent, formatPrice } from "../../../aurevo/src/utils/format";

export default function Home() {
  const toast = useToast();
  const soon = (what) => () => toast(`${what} is coming soon.`);

  return (
    <div className="store">
      <SiteHeader />

      <main>
        {/* big banner */}
        <section className="hero" aria-labelledby="hero-title">
          <ImageSlot src={HERO.image} tint={HERO.tint} className="hero-bg" />
          <div className="hero-shade" />
          <div className="hero-content">
            <p className="eyebrow">{HERO.tag}</p>
            <h1 id="hero-title">{HERO.title}</h1>
          </div>
          <ul className="hero-stats">
            {HERO.stats.map((stat) => (
              <li key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* categories */}
        <section className="section" aria-labelledby="categories-title">
          <div className="section-head">
            <div>
              <h2 id="categories-title">Trending Categories</h2>
              <p className="section-sub">Pick your favourite category to explore the latest drops.</p>
            </div>
            <button type="button" className="text-link" onClick={soon("Categories")}>
              View All Categories <Icon name="arrow-right" size={16} />
            </button>
          </div>
          <div className="cat-grid">
            {CATEGORIES.map((category) => (
              <article key={category.id} className="cat-card">
                <ImageSlot src={category.image} tint={category.tint} alt={category.name} />
                <div className="cat-shade" />
                <div className="cat-text">
                  <h3>{category.name}</h3>
                  <p>{category.text}</p>
                </div>
                <button type="button" className="btn-light" onClick={soon("Collections")}>
                  Shop Collection
                </button>
              </article>
            ))}
          </div>
        </section>

        {/* products */}
        <section className="section" aria-labelledby="products-title">
          <div className="section-head">
            <div>
              <h2 id="products-title">Trending Products</h2>
              <p className="section-sub">Discover the hottest items selected just for you.</p>
            </div>
            <button type="button" className="btn-ghost" onClick={soon("The product list")}>
              View All
            </button>
          </div>
          <div className="product-grid">
            {PRODUCTS.map((product) => {
              const off = discountPercent(product.price, product.originalPrice);
              return (
                <article key={product.id} className="product-card">
                  <div className="product-media">
                    <ImageSlot src={product.image} tint={product.tint} alt={product.name} />
                    {off > 0 && <span className="badge-discount">-{off}%</span>}
                    <button type="button" className="wish-btn" aria-label={`Add ${product.name} to wishlist`} onClick={soon("Wishlist")}>
                      <Icon name="heart" size={16} />
                    </button>
                    <button type="button" className="cart-btn" aria-label={`Add ${product.name} to cart`} onClick={soon("Cart")}>
                      <Icon name="cart" size={16} />
                    </button>
                  </div>
                  <div className="product-info">
                    <span className="product-cat">{product.category}</span>
                    <h3>{product.name}</h3>
                    <p className="price">
                      <strong>{formatPrice(product.price)}</strong>
                      {product.originalPrice > product.price && <s>{formatPrice(product.originalPrice)}</s>}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
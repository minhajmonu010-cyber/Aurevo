import { useEffect, useState } from "react";
import {
  addCartItem,
  getProduct,
  getWishlist,
  removeWishlistItem,
} from "../api/catalog";
import AccountLayout from "../Components/AccountLayout";
import Icon from "../Components/Icon";
import { formatPrice } from "../utils/format";
import { useToast } from "../context/ToastContext";
import "../styles/catalog.css";

export default function Wishlist() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [addingItemId, setAddingItemId] = useState(null);
  const toast = useToast();

  async function refresh() {
    try {
      const result = await getWishlist();
      setItems(result.items);
      setError("");
    } catch {
      setError("Could not load your wishlist.");
    }
  }

  useEffect(() => {
    let active = true;
    getWishlist()
      .then((result) => {
        if (active) {
          setItems(result.items);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("Could not load your wishlist.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function remove(id) {
    try {
      await removeWishlistItem(id);
      await refresh();
    } catch {
      setError("Could not remove this item.");
    }
  }

  async function addToCart(item) {
    setAddingItemId(item.id);
    try {
      let variantId = item.variant_id;
      if (variantId == null) {
        const product = await getProduct(item.slug);
        const variant = product.variants.find(
          (option) => option.in_stock && option.stock > 0
        );
        if (!variant) {
          toast("This product is out of stock.");
          return;
        }
        variantId = variant.id;
      }

      await addCartItem(variantId, 1);
      toast(`${item.name} added to your cart.`);
    } catch (err) {
      toast(
        err.response?.data?.quantity?.[0] ||
          err.response?.data?.detail ||
          "Could not add to cart."
      );
    } finally {
      setAddingItemId(null);
    }
  }

  return (
    <AccountLayout>
      <section className="section cart-page account-store-page">
        <div className="cart-heading">
          <h1>Your Wishlist</h1>
          {items.length > 0 && (
            <span>{items.length} {items.length === 1 ? "item" : "items"}</span>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {items.length === 0 ? (
          <div className="state-box">
            <h2>Your wishlist is empty</h2>
            <p>Save products here to find them later.</p>
          </div>
        ) : (
          <div className="cart-layout wishlist-layout">
            <div className="shop-list" aria-label="Saved products">
              {items.map((item) => (
                <article className="shop-row wishlist-row" key={item.id}>
                  {item.image && <img src={item.image} alt={item.name} />}
                  <div className="shop-row-info">
                    <h2>{item.name}</h2>
                    <div className="shop-item-meta">
                      <span>{item.price ? formatPrice(item.price) : "Unavailable"}</span>
                      {(item.color || item.size) && (
                        <span>{[item.color, item.size].filter(Boolean).join(" · ")}</span>
                      )}
                      <span>{item.in_stock ? "In stock" : "Currently unavailable"}</span>
                    </div>
                  </div>
                  <div className="shop-row-end">
                    <button
                      type="button"
                      className="btn-solid wishlist-add-btn"
                      onClick={() => addToCart(item)}
                      disabled={!item.in_stock || addingItemId !== null}
                    >
                      <Icon name="cart" size={14} />
                      {addingItemId === item.id ? "Adding..." : "Add to cart"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => remove(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <aside className="cart-summary" aria-label="Wishlist summary">
              <h2>Saved for later</h2>
              <div className="cart-summary-line">
                <span>Saved items</span>
                <span>{items.length}</span>
              </div>
              <p>Prices and availability may change over time.</p>
            </aside>
          </div>
        )}
      </section>
    </AccountLayout>
  );
}
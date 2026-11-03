import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getCart,
  removeCartItem,
  updateCartItem,
} from "../api/catalog";
import AccountLayout from "../Components/AccountLayout";
import Icon from "../Components/Icon";
import { formatPrice } from "../utils/format";
import "../styles/catalog.css";

export default function Cart() {
  const navigate = useNavigate();
  const [cart, setCart] = useState({ items: [], subtotal: "0.00" });
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setCart(await getCart());
      setError("");
    } catch {
      setError("Could not load your cart.");
    }
  }

  useEffect(() => {
    let active = true;
    getCart()
      .then((data) => {
        if (active) {
          setCart(data);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("Could not load your cart.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function changeQuantity(item, quantity) {
    try {
      await updateCartItem(item.id, quantity);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.quantity?.[0] || "Could not update quantity.");
    }
  }

  async function remove(itemId) {
    try {
      await removeCartItem(itemId);
      await refresh();
    } catch {
      setError("Could not remove this item.");
    }
  }

  return (
    <AccountLayout>
      <section className="section cart-page account-store-page">
        <div className="cart-heading">
          <h1>Your Cart</h1>
          {cart.items.length > 0 && (
            <span>{cart.items.length} {cart.items.length === 1 ? "item" : "items"}</span>
          )}
        </div>
        {error && <p role="alert">{error}</p>}

        {cart.items.length === 0 ? (
          <div className="state-box">
            <h2>Your cart is empty</h2>
            <p>Browse the collections and add something you love.</p>
          </div>
        ) : (
          <>
            <div className="cart-layout">
              <div className="shop-list" aria-label="Items in your cart">
                {cart.items.map((item) => (
                  <article className="shop-row" key={item.id}>
                    {item.image && <img src={item.image} alt={item.name} />}
                    <div className="shop-row-info">
                      <h2>{item.name}</h2>
                      <div className="shop-item-meta">
                        <span>{item.color} · Size {item.size}</span>
                        <span>{formatPrice(item.price)} each</span>
                      </div>
                      <div className="shop-quantity" role="group" aria-label={`Quantity for ${item.name}`}>
                        <span>Qty</span>
                        <button
                          type="button"
                          className="quantity-step"
                          aria-label={`Decrease quantity of ${item.name}`}
                          disabled={item.quantity <= 1}
                          onClick={() => changeQuantity(item, item.quantity - 1)}
                        >
                          <Icon name="minus" size={14} />
                        </button>
                        <output aria-live="polite">{item.quantity}</output>
                        <button
                          type="button"
                          className="quantity-step"
                          aria-label={`Increase quantity of ${item.name}`}
                          disabled={item.quantity >= item.stock}
                          onClick={() => changeQuantity(item, item.quantity + 1)}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="shop-row-end">
                      {Number(item.original_price) > Number(item.price) && (
                        <del className="shop-original-price">
                          {formatPrice(item.original_line_total)}
                        </del>
                      )}
                      <strong>{formatPrice(item.line_total)}</strong>
                      <button type="button" className="btn-ghost" onClick={() => remove(item.id)}>
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <aside className="cart-summary" aria-label="Order summary">
                <h2>Order summary</h2>
                <div className="cart-summary-line">
                  <span>Items</span>
                  <span>{cart.items.length}</span>
                </div>
                {Number(cart.discount_total) > 0 && (
                  <>
                    <div className="cart-summary-line cart-original">
                      <span>Original subtotal</span>
                      <del>{formatPrice(cart.original_subtotal)}</del>
                    </div>
                    <div className="cart-summary-line cart-savings">
                      <span>You save</span>
                      <strong>-{formatPrice(cart.discount_total)}</strong>
                    </div>
                  </>
                )}
                <div className="cart-summary-line cart-subtotal">
                  <span>{Number(cart.discount_total) > 0 ? "Discounted total" : "Subtotal"}</span>
                  <strong>{formatPrice(cart.subtotal)}</strong>
                </div>
                <p>Cash on Delivery is available for this order.</p>
                <button
                  type="button"
                  className="cart-buy-now"
                  onClick={() => navigate("/checkout")}
                >
                  Buy Now
                </button>
              </aside>
            </div>
          </>
        )}
      </section>
    </AccountLayout>
  );
}
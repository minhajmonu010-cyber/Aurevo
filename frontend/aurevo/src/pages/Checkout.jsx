import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getAddresses } from "../api/addresses";
import { getCart } from "../api/catalog";
import AccountLayout from "../Components/AccountLayout";
import { cancelPayment, createOrder, getAvailableCoupons, getCheckoutOptions, verifyPayment } from "../api/orders";
import { getWallet } from "../api/wallet";
import { useAuth } from "../context/authState";
import { formatPrice } from "../utils/format";
import "../styles/checkout.css";

function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existingScript = document.getElementById("razorpay-checkout-script");
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(true), { once: true });
      existingScript.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "razorpay-checkout-script";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

async function downloadInvoice(order) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 18;
  const right = pageWidth - 18;
  const amount = (value) => `INR ${Number(value || 0).toFixed(2)}`;
  const address = order.shipping_address || {};
  const items = order.items || [];
  let y = 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.setTextColor(20, 35, 43);
  doc.text("AUREVO", left, y);
  doc.setFontSize(13);
  doc.text("INVOICE", right, y, { align: "right" });

  y += 8;
  doc.setDrawColor(52, 180, 166);
  doc.setLineWidth(0.8);
  doc.line(left, y, right, y);

  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 95);
  doc.text(`Order: ${order.order_number || "-"}`, left, y);
  doc.text(
    `Date: ${order.created_at ? new Date(order.created_at).toLocaleDateString("en-IN") : "-"}`,
    right,
    y,
    { align: "right" }
  );

  y += 12;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 35, 43);
  doc.text("DELIVER TO", left, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(75, 85, 95);
  const addressLines = [
    address.full_name,
    address.address_line1,
    address.address_line2,
    [address.city, address.district, address.state, address.postal_code]
      .filter(Boolean)
      .join(", "),
    address.country,
    address.phone,
  ].filter(Boolean);
  const wrappedAddress = doc.splitTextToSize(addressLines.join("\n") || "Address unavailable", 82);
  doc.text(wrappedAddress, left, y);

  y = Math.max(y + wrappedAddress.length * 5 + 11, 93);
  const drawTableHeading = () => {
    doc.setFillColor(240, 246, 245);
    doc.rect(left, y - 5, right - left, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(20, 35, 43);
    doc.text("ITEM", left + 3, y + 1);
    doc.text("QTY", 125, y + 1, { align: "right" });
    doc.text("PRICE", 157, y + 1, { align: "right" });
    doc.text("TOTAL", right - 3, y + 1, { align: "right" });
    y += 10;
  };

  drawTableHeading();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(55, 65, 75);
  items.forEach((item) => {
    const nameLines = doc.splitTextToSize(item.product_name || "Product", 83);
    const details = [item.sku, item.color, item.size].filter(Boolean).join(" · ");
    const detailLines = details ? doc.splitTextToSize(details, 83) : [];
    const rowHeight = Math.max(10, (nameLines.length + detailLines.length) * 4.5 + 3);

    if (y + rowHeight > pageHeight - 45) {
      doc.addPage();
      y = 22;
      drawTableHeading();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(55, 65, 75);
    }

    doc.text(nameLines, left + 3, y);
    if (detailLines.length) {
      doc.setFontSize(7.5);
      doc.setTextColor(110, 120, 130);
      doc.text(detailLines, left + 3, y + nameLines.length * 4.5);
      doc.setFontSize(9);
      doc.setTextColor(55, 65, 75);
    }
    doc.text(String(item.quantity || 0), 125, y, { align: "right" });
    doc.text(amount(item.price), 157, y, { align: "right" });
    doc.text(amount(item.total_price), right - 3, y, { align: "right" });
    y += rowHeight;
    doc.setDrawColor(225, 231, 232);
    doc.setLineWidth(0.2);
    doc.line(left, y - 2, right, y - 2);
  });

  if (y + 40 > pageHeight - 18) {
    doc.addPage();
    y = 22;
  }
  y += 5;
  const totalLine = (label, value, emphasize = false) => {
    doc.setFont("helvetica", emphasize ? "bold" : "normal");
    doc.setFontSize(emphasize ? 11 : 9);
    doc.setTextColor(20, 35, 43);
    doc.text(label, 124, y);
    doc.text(amount(value), right - 3, y, { align: "right" });
    y += emphasize ? 8 : 6;
  };
  totalLine("Discount", order.discount_amount);
  totalLine("Shipping", order.shipping_charge);
  totalLine("Order total", order.total_amount, true);

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 95);
  doc.text(`Payment method: ${(order.payment_method || "-").replaceAll("_", " ").toUpperCase()}`, left, y);

  doc.save(`Aurevo-Invoice-${order.order_number || order.id}.pdf`);
}

export default function Checkout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const buyNow = location.state?.buyNow;

  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [paymentOptions, setPaymentOptions] = useState({ online_payment_enabled: false, key_id: "" });
  const [walletBalance, setWalletBalance] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("cash_on_delivery");
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [availableCoupons, setAvailableCoupons] = useState([]);
  const [couponsOpen, setCouponsOpen] = useState(false);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [error, setError] = useState("");
  const [order, setOrder] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCheckout() {
      setLoading(true);
      setError("");

      try {
        const [addressResponse, cartData, paymentResponse, walletResponse] = await Promise.all([
          getAddresses(),
          buyNow ? Promise.resolve(null) : getCart(),
          getCheckoutOptions(),
          getWallet().catch(() => null),
        ]);

        if (cancelled) return;

        const savedAddresses = addressResponse.data || [];
        setAddresses(savedAddresses);
        setSelectedAddressId(
          String(savedAddresses.find((address) => address.is_default)?.id || savedAddresses[0]?.id || "")
        );
        setCart(cartData);
        setPaymentOptions(paymentResponse.data);
        setWalletBalance(walletResponse ? Number(walletResponse.data.balance) : 0);
      } catch {
        if (!cancelled) setError("Unable to load checkout. Please try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCheckout();
    return () => {
      cancelled = true;
    };
  }, [buyNow]);

  const items = buyNow ? [buyNow] : cart?.items || [];
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.line_total ?? Number(item.price) * item.quantity),
    0
  );
  const couponDiscount = couponApplied && appliedCoupon
    ? Number(appliedCoupon.discount_amount)
    : 0;
  const orderTotal = Math.max(subtotal - couponDiscount, 0);
  const walletCanPay = walletBalance !== null && walletBalance >= orderTotal;

  async function loadAvailableCoupons() {
    setCouponsOpen(true);
    setCouponsLoading(true);
    setCouponError("");
    try {
      const response = await getAvailableCoupons({ subtotal });
      setAvailableCoupons(response.data.results || []);
    } catch (requestError) {
      setCouponError(requestError.response?.data?.detail || "Unable to load available coupons.");
    } finally {
      setCouponsLoading(false);
    }
  }

  async function handleCouponApply(code = couponCode) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      setCouponError("Enter a coupon code or choose one from available coupons.");
      setCouponApplied(false);
      setAppliedCoupon(null);
      return;
    }

    setApplyingCoupon(true);
    setCouponError("");
    try {
      const response = await getAvailableCoupons({ subtotal });
      const coupons = response.data.results || [];
      setAvailableCoupons(coupons);
      const coupon = coupons.find((item) => item.code.toUpperCase() === normalized);
      if (!coupon) {
        setCouponError("This coupon is invalid, expired, or unavailable.");
        setCouponApplied(false);
        setAppliedCoupon(null);
      } else if (!coupon.eligible) {
        setCouponError(`Add ${formatPrice(coupon.minimum_remaining)} more to use this coupon.`);
        setCouponApplied(false);
        setAppliedCoupon(null);
      } else {
        setCouponCode(coupon.code);
        setAppliedCoupon(coupon);
        setCouponApplied(true);
        setCouponError("");
      }
    } catch (requestError) {
      setCouponError(requestError.response?.data?.detail || "Unable to validate this coupon.");
    } finally {
      setApplyingCoupon(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!selectedAddressId) {
      setError("Choose a delivery address before placing your order.");
      return;
    }
    if (!items.length) {
      setError("Your cart is empty.");
      return;
    }

    try {
      setPlacingOrder(true);
      const response = await createOrder({
        address_id: Number(selectedAddressId),
        payment_method: paymentMethod,
        coupon_code: couponCode.trim(),
        ...(buyNow && {
          items: [{ variant_id: buyNow.variant_id, quantity: buyNow.quantity }],
        }),
      });

      if (paymentMethod === "cash_on_delivery" || paymentMethod === "wallet") {
        setOrder(response.data);
        return;
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        await cancelPayment({ local_order_id: response.data.local_order_id });
        setError("Online checkout could not be loaded. Please try again or choose Cash on Delivery.");
        return;
      }

      let paymentHandled = false;
      const selectedAddress = addresses.find((address) => String(address.id) === selectedAddressId);
      const checkout = new window.Razorpay({
        key: response.data.razorpay.key_id,
        amount: response.data.razorpay.amount,
        currency: response.data.razorpay.currency,
        order_id: response.data.razorpay.order_id,
        name: "Aurevo",
        description: "Order payment",
        prefill: {
          name: selectedAddress?.full_name || user?.full_name,
          email: user?.email,
          contact: selectedAddress?.phone || user?.phone,
        },
        theme: { color: "#34d3c2" },
        handler: async (result) => {
          paymentHandled = true;
          try {
            const verified = await verifyPayment({
              local_order_id: response.data.local_order_id,
              ...result,
            });
            setOrder(verified.data);
          } catch (verificationError) {
            const data = verificationError.response?.data;
            setError(data?.detail || "Payment confirmation is delayed. Contact support before retrying.");
          } finally {
            setPlacingOrder(false);
          }
        },
        modal: {
          ondismiss: async () => {
            if (!paymentHandled) {
              try {
                await cancelPayment({ local_order_id: response.data.local_order_id });
              } catch {
                // The payment attempt remains available in order history for follow-up.
              }
              setError("Payment was cancelled. You can try again.");
              setPlacingOrder(false);
            }
          },
        },
      });

      checkout.on("payment.failed", () => {
        setError("Payment failed. You can retry in the secure checkout window.");
      });
      checkout.open();
    } catch (requestError) {
      const data = requestError.response?.data;
      setError(
        data?.detail ||
          (data && typeof data === "object" ? Object.values(data).flat().join(" ") : "") ||
          "Unable to place your order. Please try again."
      );
    } finally {
      setPlacingOrder(false);
    }
  }

  return order ? (
    <main className="checkout-success-page">
      <section className="checkout-confirmation" aria-labelledby="checkout-confirmation-title">
        <span className="checkout-success-mark" aria-hidden="true" />
        <p className="checkout-eyebrow">ORDER CONFIRMED</p>
        <h1 id="checkout-confirmation-title">Thank you for your order.</h1>
        <p>
          Order <strong>{order.order_number}</strong> is confirmed.
          {order.payment_method === "cash_on_delivery"
            ? ` Pay ${formatPrice(order.total_amount)} on delivery.`
            : order.payment_method === "wallet"
              ? " Paid from your Aurevo wallet."
              : " Your payment is confirmed."}
        </p>
        <div className="checkout-confirmation-actions">
          <button
            type="button"
            className="checkout-secondary-link checkout-invoice-button"
            onClick={() => downloadInvoice(order)}
          >
            Download invoice PDF
          </button>
          <Link to="/orders" className="checkout-primary-link">View orders</Link>
          <Link to="/categories" className="checkout-secondary-link">Continue shopping</Link>
        </div>
      </section>
    </main>
  ) : (
    <AccountLayout>
      <main className="checkout-page">
        <>
            <header className="checkout-heading">
              <p className="checkout-eyebrow">SECURE CHECKOUT</p>
              <h1>Complete your order</h1>
              <p>Review your delivery address and order summary.</p>
            </header>

            {error && <p className="checkout-error" role="alert">{error}</p>}

            {loading ? (
              <p className="checkout-message">Loading checkout...</p>
            ) : (
              <form className="checkout-layout" onSubmit={handleSubmit}>
                <div className="checkout-main">
                  <section className="checkout-section" aria-labelledby="delivery-title">
                    <div className="checkout-section-heading">
                      <span>01</span>
                      <h2 id="delivery-title">Delivery address</h2>
                    </div>

                    {addresses.length ? (
                      <div className="checkout-address-list">
                        {addresses.map((address) => (
                          <label
                            className={`checkout-address${String(address.id) === selectedAddressId ? " selected" : ""}`}
                            key={address.id}
                          >
                            <input
                              type="radio"
                              name="delivery_address"
                              value={address.id}
                              checked={String(address.id) === selectedAddressId}
                              onChange={() => setSelectedAddressId(String(address.id))}
                            />
                            <span className="checkout-address-copy">
                              <strong>{address.full_name}</strong>
                              <span>{address.phone}</span>
                              <span>
                                {address.address_line1}{address.address_line2 ? `, ${address.address_line2}` : ""}
                              </span>
                              <span>
                                {[address.city, address.district, address.state, address.postal_code, address.country]
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            </span>
                            {address.is_default && <span className="checkout-default">DEFAULT</span>}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="checkout-no-address">
                        <p>Add a delivery address before placing your order.</p>
                        <Link to="/address">Manage addresses</Link>
                      </div>
                    )}
                  </section>

                  <section className="checkout-section" aria-labelledby="payment-title">
                    <div className="checkout-section-heading">
                      <span>02</span>
                      <h2 id="payment-title">Payment</h2>
                    </div>
                    <div className="checkout-payment-options">
                      <label className={`checkout-payment-option${paymentMethod === "cash_on_delivery" ? " selected" : ""}`}>
                        <input
                          type="radio"
                          name="payment_method"
                          value="cash_on_delivery"
                          checked={paymentMethod === "cash_on_delivery"}
                          onChange={() => setPaymentMethod("cash_on_delivery")}
                        />
                        <span>
                          <strong>Cash on Delivery</strong>
                          <small>Pay when your order arrives</small>
                        </span>
                      </label>
                      <label className={`checkout-payment-option${paymentMethod === "wallet" ? " selected" : ""}${walletCanPay ? "" : " unavailable"}`}>
                        <input
                          type="radio"
                          name="payment_method"
                          value="wallet"
                          checked={paymentMethod === "wallet"}
                          onChange={() => setPaymentMethod("wallet")}
                          disabled={!walletCanPay}
                        />
                        <span>
                          <strong>Pay with wallet</strong>
                          <small>
                            {walletBalance === null
                              ? "Loading wallet balance..."
                              : walletCanPay
                                ? `${formatPrice(walletBalance)} available`
                                : `Need ${formatPrice(Math.max(orderTotal - walletBalance, 0))} more`}
                          </small>
                        </span>
                      </label>
                      <label className={`checkout-payment-option${paymentMethod === "razorpay" ? " selected" : ""}${paymentOptions.online_payment_enabled ? "" : " unavailable"}`}>
                        <input
                          type="radio"
                          name="payment_method"
                          value="razorpay"
                          checked={paymentMethod === "razorpay"}
                          onChange={() => setPaymentMethod("razorpay")}
                          disabled={!paymentOptions.online_payment_enabled}
                        />
                        <span>
                          <strong>Razorpay</strong>
                          <small>{paymentOptions.online_payment_enabled ? "UPI, cards, and other available methods" : "Currently unavailable"}</small>
                        </span>
                      </label>
                    </div>
                    {!paymentOptions.online_payment_enabled && (
                      <p className="checkout-payment-unavailable">
                        Online payments are unavailable until Razorpay test keys are configured.
                      </p>
                    )}
                  </section>
                </div>

                <aside className="checkout-summary" aria-labelledby="checkout-summary-title">
                  <h2 id="checkout-summary-title">Order summary</h2>
                  <div className="checkout-items">
                    {items.map((item, index) => (
                      <div className="checkout-item" key={item.variant_id || item.id || index}>
                        {item.image && <img src={item.image} alt="" />}
                        <div className="checkout-item-copy">
                          <strong>{item.name}</strong>
                          {(item.color || item.size) && (
                            <span>{item.color}{item.color && item.size ? " · " : ""}{item.size ? `Size ${item.size}` : ""}</span>
                          )}
                          <span>Qty {item.quantity}</span>
                        </div>
                        <strong>{formatPrice(item.line_total ?? Number(item.price) * item.quantity)}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="checkout-coupon">
                    <label htmlFor="coupon-code">Coupon code</label>
                    <div className="checkout-coupon-row">
                      <input
                        id="coupon-code"
                        type="text"
                        value={couponCode}
                        onChange={(event) => {
                          setCouponCode(event.target.value);
                          if (couponApplied) {
                            setCouponApplied(false);
                            setAppliedCoupon(null);
                          }
                          if (couponError) setCouponError("");
                        }}
                        placeholder="Enter coupon code"
                      />
                      <button type="button" onClick={() => handleCouponApply()} disabled={applyingCoupon}>
                        {applyingCoupon ? "Checking..." : "Apply"}
                      </button>
                    </div>
                    <button type="button" className="checkout-coupons-link" onClick={loadAvailableCoupons}>
                      View available coupons
                    </button>
                    {couponsOpen && (
                      <div className="checkout-available-coupons" aria-live="polite">
                        {couponsLoading ? (
                          <p>Loading available coupons...</p>
                        ) : availableCoupons.length ? (
                          availableCoupons.map((coupon) => (
                            <article
                              className={`checkout-available-coupon${couponApplied && appliedCoupon?.code === coupon.code ? " applied" : ""}`}
                              key={coupon.code}
                            >
                              <div>
                                <strong>{coupon.code}</strong>
                                <small>{coupon.description || (coupon.discount_type === "percentage" ? `${coupon.discount_value}% off` : `${formatPrice(coupon.discount_value)} off`)}</small>
                                <small>
                                  {coupon.eligible
                                    ? `Save ${formatPrice(coupon.discount_amount)}`
                                    : `Minimum order ${formatPrice(coupon.minimum_order_amount)}`}
                                </small>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleCouponApply(coupon.code)}
                                disabled={!coupon.eligible || applyingCoupon}
                              >
                                {couponApplied && appliedCoupon?.code === coupon.code ? "Applied" : "Apply"}
                              </button>
                            </article>
                          ))
                        ) : (
                          <p>No coupons are currently available.</p>
                        )}
                      </div>
                    )}
                    {couponError && <small className="checkout-coupon-error">{couponError}</small>}
                    {couponApplied && <small className="checkout-coupon-success">{appliedCoupon?.code} applied · save {formatPrice(couponDiscount)}</small>}
                  </div>
                  {couponApplied && (
                    <div className="checkout-discount">
                      <span>Discount</span>
                      <strong>-{formatPrice(couponDiscount)}</strong>
                    </div>
                  )}
                  <div className="checkout-total">
                    <span>Total</span>
                    <strong>{formatPrice(orderTotal)}</strong>
                  </div>
                  <p className="checkout-cod-note">
                    {paymentMethod === "cash_on_delivery"
                      ? "Cash on Delivery · Shipping included"
                      : paymentMethod === "wallet"
                        ? `Wallet balance after payment: ${formatPrice(Math.max(walletBalance - orderTotal, 0))}`
                        : "Secure payment with Razorpay · Shipping included"}
                  </p>
                  <button
                    className="checkout-place-order"
                    type="submit"
                    disabled={placingOrder || !items.length || !addresses.length || (paymentMethod === "wallet" && !walletCanPay)}
                  >
                    {placingOrder
                      ? paymentMethod === "razorpay" ? "Opening secure checkout..." : "Placing order..."
                      : paymentMethod === "cash_on_delivery"
                        ? "Place COD order"
                        : paymentMethod === "wallet"
                          ? `Pay ${formatPrice(orderTotal)} with wallet`
                          : "Continue with Razorpay"}
                  </button>
                  <button
                    className="checkout-back"
                    type="button"
                    onClick={() => navigate(buyNow ? -1 : "/cart")}
                  >
                    {buyNow ? "Back to product" : "Back to cart"}
                  </button>
                </aside>
              </form>
            )}
        </>
      </main>
    </AccountLayout>
  );
}
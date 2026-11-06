import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createAddress, getAddresses } from "../api/addresses";
import { getCart } from "../api/catalog";
import AccountLayout from "../Components/AccountLayout";
import { cancelPayment, createOrder, getAvailableCoupons, getCheckoutOptions, verifyPayment } from "../api/orders";
import { getWallet } from "../api/wallet";
import { useAuth } from "../context/authState";
import { formatPrice } from "../utils/format";
import "../styles/checkout.css";

const EMPTY_CHECKOUT_ADDRESS = {
  full_name: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  district: "",
  state: "",
  postal_code: "",
  country: "India",
  address_type: "home",
  is_default: false,
};

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

function formatOrderDate(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Just now"
    : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function OrderSuccessImage({ src, name }) {
  const [failed, setFailed] = useState(!src);

  return (
    <div className="checkout-success-item-image">
      {!failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <span aria-label={`${name} image unavailable`}>
          {name?.trim().charAt(0)?.toUpperCase() || "A"}
        </span>
      )}
    </div>
  );
}

export default function Checkout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const buyNow = location.state?.buyNow;

  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressForm, setAddressForm] = useState(EMPTY_CHECKOUT_ADDRESS);
  const [addressFormError, setAddressFormError] = useState("");
  const [addressFieldErrors, setAddressFieldErrors] = useState({});
  const [savingAddress, setSavingAddress] = useState(false);
  const addressFormContainer = useRef(null);
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
  const [copyMessage, setCopyMessage] = useState("");

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
        setShowAddressForm(savedAddresses.length === 0);
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
  const offerSavings = items.reduce(
    (sum, item) => sum + Number(item.offer_line_discount || 0),
    0
  );
  const couponDiscount = couponApplied && appliedCoupon
    ? Number(appliedCoupon.discount_amount)
    : 0;
  const orderTotal = Math.max(subtotal - couponDiscount, 0);
  const walletCanPay = walletBalance !== null && walletBalance >= orderTotal;

  function handleAddressFieldChange(event) {
    const { name, value, checked, type } = event.target;
    setAddressForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setAddressFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
    setAddressFormError("");
  }

  async function handleAddressSubmit() {
    const invalidField = addressFormContainer.current?.querySelector(":invalid");
    if (invalidField) {
      invalidField.reportValidity();
      invalidField.focus();
      return;
    }

    setSavingAddress(true);
    setAddressFormError("");
    setAddressFieldErrors({});

    try {
      const response = await createAddress({
        ...addressForm,
        full_name: addressForm.full_name.trim(),
        phone: addressForm.phone.trim(),
        address_line1: addressForm.address_line1.trim(),
        address_line2: addressForm.address_line2.trim(),
        city: addressForm.city.trim(),
        district: addressForm.district.trim(),
        state: addressForm.state.trim(),
        postal_code: addressForm.postal_code.trim(),
        country: addressForm.country.trim(),
      });
      const savedAddress = response.data;
      setAddresses((current) => [savedAddress, ...current]);
      setSelectedAddressId(String(savedAddress.id));
      setAddressForm(EMPTY_CHECKOUT_ADDRESS);
      setShowAddressForm(false);
    } catch (requestError) {
      const data = requestError.response?.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const fieldErrors = Object.fromEntries(
          Object.entries(data)
            .filter(([name]) => name in EMPTY_CHECKOUT_ADDRESS)
            .map(([name, messages]) => [
              name,
              Array.isArray(messages) ? messages[0] : messages,
            ])
        );
        setAddressFieldErrors(fieldErrors);
        const otherErrors = Object.entries(data)
          .filter(([name]) => !(name in EMPTY_CHECKOUT_ADDRESS))
          .flatMap(([, messages]) => Array.isArray(messages) ? messages : [messages]);
        setAddressFormError(
          otherErrors.length
            ? otherErrors.join(" ")
            : Object.keys(fieldErrors).length
              ? ""
              : "Could not save this address. Check the details and try again."
        );
      } else {
        setAddressFormError("Could not save this address. Please try again.");
      }
    } finally {
      setSavingAddress(false);
    }
  }

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

  async function copyOrderNumber() {
    try {
      await navigator.clipboard.writeText(order.order_number);
      setCopyMessage("Order number copied.");
    } catch {
      setCopyMessage("Could not copy the order number. Please copy it manually.");
    }
  }

  const orderItems = order?.items || [];
  const deliveryAddress = order?.shipping_address || {};
  const payment = order?.payments?.[0];
  const orderSteps = [
    { status: "pending", label: "Order placed" },
    { status: "processing", label: "Processing" },
    { status: "shipped", label: "On the way" },
    { status: "delivered", label: "Delivered" },
  ];
  const orderStepIndex = {
    pending: 0,
    processing: 1,
    shipped: 2,
    delivered: 3,
    returned: 3,
  }[order?.order_status] ?? 0;
  const orderSubtotal = orderItems.reduce(
    (sum, item) => sum + Number(item.total_price || 0),
    0
  );
  const originalOrderValue = Math.max(
    Number(order?.total_amount || 0) +
      Number(order?.discount_amount || 0) -
      Number(order?.shipping_charge || 0),
    orderSubtotal
  );

  return order ? (
    <main className="checkout-success-page">
      <div className="checkout-success-content">
        <section className="checkout-confirmation" aria-labelledby="checkout-confirmation-title">
          <div className="checkout-success-heading">
            <span className="checkout-success-mark" aria-hidden="true" />
            <div>
              <p className="checkout-eyebrow">ORDER CONFIRMED</p>
              <h1 id="checkout-confirmation-title">Thank you for your order.</h1>
              <p>
                {order.payment_method === "cash_on_delivery"
                  ? `Your order is placed. Pay ${formatPrice(order.total_amount)} when it arrives.`
                  : order.payment_method === "wallet"
                    ? "Your order is placed and paid from your Aurevo wallet."
                    : "Your payment is confirmed and your order is placed."}
              </p>
            </div>
          </div>

          <div className="checkout-order-reference">
            <div>
              <span>ORDER NUMBER</span>
              <strong>{order.order_number}</strong>
            </div>
            <button type="button" onClick={copyOrderNumber}>Copy</button>
            <span className="checkout-copy-message" role="status" aria-live="polite">
              {copyMessage}
            </span>
          </div>

          <div className="checkout-order-meta">
            <div>
              <span>Placed on</span>
              <strong>{formatOrderDate(order.created_at)}</strong>
            </div>
            <div>
              <span>Order status</span>
              <strong className="checkout-status-badge">
                {(order.order_status || "pending").replaceAll("_", " ")}
              </strong>
            </div>
            <div>
              <span>Payment</span>
              <strong>
                {(order.payment_method || "Payment").replaceAll("_", " ")}
                {payment?.payment_status
                  ? ` · ${payment.payment_status.replaceAll("_", " ")}`
                  : ""}
              </strong>
            </div>
          </div>

          {order.order_status === "cancelled" ? (
            <p className="checkout-order-status-note">
              This order has been cancelled. Visit your orders page for more details.
            </p>
          ) : (
            <ol className="checkout-order-progress" aria-label="Order progress">
              {orderSteps.map((step, index) => (
                <li
                  key={step.status}
                  className={index <= orderStepIndex ? "complete" : ""}
                  aria-current={index === orderStepIndex ? "step" : undefined}
                >
                  <span>{index < orderStepIndex ? "✓" : index + 1}</span>
                  <small>{step.label}</small>
                </li>
              ))}
            </ol>
          )}

        <div className="checkout-success-details">
          <section className="checkout-success-card" aria-labelledby="success-items-title">
            <div className="checkout-success-card-heading">
              <h2 id="success-items-title">What you ordered</h2>
              <span>
                {orderItems.reduce((sum, item) => sum + item.quantity, 0)} items
              </span>
            </div>
            <div className="checkout-success-items">
              {orderItems.map((item) => (
                <article className="checkout-success-item" key={item.id}>
                  <OrderSuccessImage src={item.image} name={item.product_name} />
                  <div className="checkout-success-item-copy">
                    <strong>{item.product_name}</strong>
                    <span>
                      {[item.color, item.size && `Size ${item.size}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span>Quantity {item.quantity} · {formatPrice(item.price)} each</span>
                  </div>
                  <strong>{formatPrice(item.total_price)}</strong>
                </article>
              ))}
            </div>
          </section>

          <div className="checkout-success-side">
            <section className="checkout-success-card" aria-labelledby="success-delivery-title">
              <h2 id="success-delivery-title">Delivering to</h2>
              <address>
                <strong>{deliveryAddress.full_name}</strong>
                {deliveryAddress.address_line1 && <span>{deliveryAddress.address_line1}</span>}
                {deliveryAddress.address_line2 && <span>{deliveryAddress.address_line2}</span>}
                <span>
                  {[deliveryAddress.city, deliveryAddress.district, deliveryAddress.state, deliveryAddress.postal_code]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {deliveryAddress.country && <span>{deliveryAddress.country}</span>}
                {deliveryAddress.phone && <span>{deliveryAddress.phone}</span>}
              </address>
            </section>

            <section className="checkout-success-card" aria-labelledby="success-total-title">
              <h2 id="success-total-title">Payment summary</h2>
              <div className="checkout-success-total-line">
                <span>Original item value</span>
                <span>{formatPrice(originalOrderValue)}</span>
              </div>
              {Number(order.discount_amount) > 0 && (
                <div className="checkout-success-total-line savings">
                  <span>Savings applied</span>
                  <span>-{formatPrice(order.discount_amount)}</span>
                </div>
              )}
              {Number(order.shipping_charge) > 0 && (
                <div className="checkout-success-total-line">
                  <span>Shipping</span>
                  <span>{formatPrice(order.shipping_charge)}</span>
                </div>
              )}
              <div className="checkout-success-grand-total">
                <strong>Total paid{order.payment_method === "cash_on_delivery" ? " on delivery" : ""}</strong>
                <strong>{formatPrice(order.total_amount)}</strong>
              </div>
            </section>
          </div>
        </div>

        <div className="checkout-confirmation-actions">
          <Link to="/orders" className="checkout-primary-link">View orders</Link>
          <button
            type="button"
            className="checkout-secondary-link checkout-invoice-button"
            onClick={() => downloadInvoice(order)}
          >
            Download invoice PDF
          </button>
          <Link to="/categories" className="checkout-secondary-link">Continue shopping</Link>
        </div>
        </section>
      </div>
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

                    {addresses.length > 0 && (
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
                              onChange={() => {
                                setSelectedAddressId(String(address.id));
                                if (error === "Choose a delivery address before placing your order.") {
                                  setError("");
                                }
                              }}
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
                    )}
                    <button
                      type="button"
                      className="checkout-add-address-toggle"
                      onClick={() => {
                        setShowAddressForm((open) => !open);
                        setAddressFormError("");
                      }}
                    >
                      {showAddressForm ? "Cancel adding address" : "+ Add a new address"}
                    </button>
                    {showAddressForm && (
                      <div className="checkout-new-address" ref={addressFormContainer}>
                        {addressFormError && <p className="checkout-address-error" role="alert">{addressFormError}</p>}
                        <div className="checkout-new-address-grid">
                          {[
                            ["full_name", "Full name"],
                            ["phone", "Phone number"],
                            ["address_line1", "Address line 1"],
                            ["address_line2", "Address line 2 (optional)"],
                            ["city", "City"],
                            ["district", "District"],
                            ["state", "State"],
                            ["postal_code", "Postal code"],
                            ["country", "Country"],
                          ].map(([name, label]) => (
                            <label key={name} className={name === "address_line1" || name === "address_line2" ? "wide" : ""}>
                              {label}
                              <input
                                name={name}
                                value={addressForm[name]}
                                onChange={handleAddressFieldChange}
                                required={!addresses.length && name !== "address_line2"}
                                maxLength={
                                  name === "full_name"
                                    ? 150
                                    : name === "phone"
                                      ? 20
                                      : ["address_line1", "address_line2"].includes(name)
                                        ? 255
                                        : name === "postal_code"
                                          ? 12
                                          : 100
                                }
                                autoComplete={{
                                  full_name: "name",
                                  phone: "tel",
                                  address_line1: "address-line1",
                                  address_line2: "address-line2",
                                  city: "address-level2",
                                  district: "address-level3",
                                  state: "address-level1",
                                  postal_code: "postal-code",
                                  country: "country-name",
                                }[name]}
                                aria-invalid={Boolean(addressFieldErrors[name])}
                              />
                              {addressFieldErrors[name] && (
                                <span className="checkout-address-error" role="alert">{addressFieldErrors[name]}</span>
                              )}
                            </label>
                          ))}
                          <label>
                            Address type
                            <select
                              name="address_type"
                              value={addressForm.address_type}
                              onChange={handleAddressFieldChange}
                            >
                              <option value="home">Home</option>
                              <option value="work">Work</option>
                              <option value="other">Other</option>
                            </select>
                          </label>
                          <label className="checkout-address-default">
                            <input
                              type="checkbox"
                              name="is_default"
                              checked={addressForm.is_default}
                              onChange={handleAddressFieldChange}
                            />
                            Set as default address
                          </label>
                        </div>
                        <button
                          className="checkout-save-address"
                          type="button"
                          onClick={handleAddressSubmit}
                          disabled={savingAddress}
                        >
                          {savingAddress ? "Saving address..." : "Save and use this address"}
                        </button>
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
                          {item.offer_name && (
                            <span className="checkout-offer-applied">
                              {item.offer_name} · save {formatPrice(item.offer_line_discount)}
                            </span>
                          )}
                        </div>
                        <strong>{formatPrice(item.line_total ?? Number(item.price) * item.quantity)}</strong>
                      </div>
                    ))}
                  </div>
                  {offerSavings > 0 && (
                    <div className="checkout-discount">
                      <span>Offer savings</span>
                      <strong>-{formatPrice(offerSavings)}</strong>
                    </div>
                  )}
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
                                {coupon.max_discount_amount && (
                                 <small>Maximum saving {formatPrice(coupon.max_discount_amount)}</small>
                                )}
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
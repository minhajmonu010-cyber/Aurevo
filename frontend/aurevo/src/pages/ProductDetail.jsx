
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  addCartItem,
  addWishlistItem,
  getProduct,
  getProducts,
  getProductReviews,
  getWishlist,
  removeWishlistItem,
} from "../api/catalog";
import Icon from "../Components/Icon";
import ImageSlot from "../Components/ImageSlot";
import ProductRating from "../Components/ProductRating";
import SiteFooter from "../Components/SiteFooter";
import SiteHeader from "../Components/SiteHeader";
import { useAuth } from "../context/authState";
import { useToast } from "../context/ToastContext";
import "../styles/product-detail.css";

const formatPrice = (price) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(price || 0));

const RELATED_TINTS = ["#2b3a52", "#33333d", "#4d4436", "#2c4258"];

export default function ProductDetail() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const requireVariantSelection = Boolean(
    location.state?.requireVariantSelection
  );
  const { user } = useAuth();
  const toast = useToast();
  const wishlistOwnerId = user?.id ?? null;

  const [product, setProduct] = useState(null);
  const [relatedProductsState, setRelatedProductsState] = useState({ slug: null, items: [] });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const [reviewState, setReviewState] = useState({
    requestKey: null,
    count: 0,
    averageRating: 0,
    ratingDistribution: {},
    results: [],
    error: "",
  });
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState("");
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [selectedSizeChoice, setSelectedSizeChoice] = useState("");
  const [selectedColorChoice, setSelectedColorChoice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  const [addingToCart, setAddingToCart] = useState(false);
  const [addingToWishlist, setAddingToWishlist] = useState(false);
  const [wishlistState, setWishlistState] = useState({
    ownerId: null,
    productId: null,
    itemId: null,
  });
  const wishlistItemId =
    wishlistState.ownerId === wishlistOwnerId &&
    wishlistState.productId === product?.id
      ? wishlistState.itemId
      : null;
  const loadingWishlist =
    wishlistOwnerId != null &&
    product != null &&
    (wishlistState.ownerId !== wishlistOwnerId ||
      wishlistState.productId !== product.id);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const imagePreviewTrigger = useRef(null);
  const imagePreviewClose = useRef(null);
  const relatedProducts = relatedProductsState.slug === slug ? relatedProductsState.items : [];
  const reviewRequestKey = `${slug}:${reviewAttempt}`;
  const productReviews =
    reviewState.requestKey === reviewRequestKey
      ? reviewState
      : {
          count: 0,
          averageRating: 0,
          ratingDistribution: {},
          results: [],
          error: "",
        };
  const reviewsLoading =
    Boolean(product) && reviewState.requestKey !== reviewRequestKey;
  const changeImage = useCallback((direction) => {
    const images = product?.images?.length
      ? product.images
      : product?.image
        ? [{ id: product.id, image: product.image }]
        : [];
    if (images.length < 2) return;

    setSelectedImage((currentImage) => {
      const currentIndex = images.findIndex(
        (image) => image.image === currentImage
      );
      const nextIndex =
        ((currentIndex < 0 ? 0 : currentIndex) + direction + images.length) %
        images.length;
      return images[nextIndex].image;
    });
  }, [product]);

  useEffect(() => {
    let cancelled = false;

    async function loadProduct() {
      setLoading(true);
      setError("");
      setProduct(null);
      setSelectedVariant(null);
      setSelectedSizeChoice("");
      setSelectedColorChoice("");
      setSelectedImage("");
      setQuantity(1);
      setImagePreviewOpen(false);

      try {
        const data = await getProduct(slug);

        if (cancelled) return;

        setProduct(data);
        setSelectedImage(
          data.images?.[0]?.image || data.image || ""
        );

        const availableVariant = data.variants?.find(
          (variant) => variant.in_stock
        );

        const initialVariant = availableVariant || data.variants?.[0] || null;
        const hasSelectableOptions = data.variants?.some(
          (variant) => variant.size || variant.color
        );
        const mustChooseVariant =
          requireVariantSelection && hasSelectableOptions;
        setSelectedVariant(mustChooseVariant ? null : initialVariant);
        if (!mustChooseVariant && initialVariant) {
          setSelectedSizeChoice(initialVariant.size || "");
          setSelectedColorChoice(initialVariant.color || "");
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.status === 404
              ? "This product could not be found or is no longer available."
              : "We couldn't load this product. Please try again."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProduct();

    return () => {
      cancelled = true;
    };
  }, [slug, loadAttempt, requireVariantSelection]);

  useEffect(() => {
    let active = true;
    if (!product?.id || wishlistOwnerId == null) return undefined;

    getWishlist()
      .then(({ items }) => {
        if (active) {
          setWishlistState({
            ownerId: wishlistOwnerId,
            productId: product.id,
            itemId:
              items.find((item) => item.product_id === product.id)?.id ?? null,
          });
        }
      })
      .catch(() => {
        if (active) {
          setWishlistState({
            ownerId: wishlistOwnerId,
            productId: product.id,
            itemId: null,
          });
          toast("Could not load your wishlist.");
        }
      });

    return () => {
      active = false;
    };
  }, [product?.id, wishlistOwnerId, toast]);

  useEffect(() => {
    let active = true;
    if (!product?.id) return undefined;

    getProductReviews(slug, { page: 1 })
      .then((data) => {
        if (active) {
          setReviewState({
            requestKey: reviewRequestKey,
            count: data.count,
            averageRating: data.average_rating,
            ratingDistribution: data.rating_distribution,
            results: data.results,
            error: "",
          });
        }
      })
      .catch(() => {
        if (active) {
          setReviewState({
            requestKey: reviewRequestKey,
            count: 0,
            averageRating: 0,
            ratingDistribution: {},
            results: [],
            error: "Could not load product reviews.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [product?.id, reviewRequestKey, slug]);

  useEffect(() => {
    const categorySlug = product?.category?.slug;
    if (!categorySlug) return undefined;

    let cancelled = false;

    getProducts({
      category: categorySlug,
      ordering: "featured",
      page: 1,
      page_size: 5,
    })
      .then((data) => {
        if (!cancelled) {
          setRelatedProductsState({
            slug,
            items: (data.results || [])
              .filter((item) => item.id !== product.id)
              .slice(0, 4),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setRelatedProductsState({ slug, items: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [slug, product?.category?.slug, product?.id]);

  useEffect(() => {
    if (!imagePreviewOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setImagePreviewOpen(false);
        imagePreviewTrigger.current?.focus();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        changeImage(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        changeImage(-1);
      }
    };

    document.body.style.overflow = "hidden";
    imagePreviewClose.current?.focus();
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [imagePreviewOpen, changeImage]);

  function closeImagePreview() {
    setImagePreviewOpen(false);
    imagePreviewTrigger.current?.focus();
  }

  if (loading) {
    return (
      <>
        <SiteHeader />
        <main className="product-detail-page">
          <div className="pd-loading" role="status" aria-label="Loading product">
            <div className="pd-loading-image" />
            <div className="pd-loading-copy">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  if (error || !product) {
    return (
      <>
        <SiteHeader />
        <main className="product-detail-page">
          <div className="product-detail-message">
            <span className="pd-error-mark" aria-hidden="true">!</span>
            <h1>Product unavailable</h1>
            <p>{error || "We couldn't find this product."}</p>
            <Link className="pd-back-link" to="/">
              Back to shopping
            </Link>
            <button
              className="pd-retry"
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              Try again
            </button>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const variants = product.variants || [];
  const images = product.images?.length
    ? product.images
    : product.image
      ? [{ id: product.id, image: product.image }]
      : [];
  const selectedImageIndex = images.findIndex(
    (image) => image.image === selectedImage
  );
  const sizes = [...new Set(variants.map((v) => v.size))];
  const colors = [...new Set(variants.map((v) => v.color))];

  const selectedSize = requireVariantSelection
    ? selectedSizeChoice
    : selectedVariant?.size;
  const selectedColor = requireVariantSelection
    ? selectedColorChoice
    : selectedVariant?.color;

  const matchingVariant = (size, color) =>
    variants.find((v) => v.size === size && v.color === color);

  function chooseSize(size) {
    if (requireVariantSelection) {
      const color = selectedColorChoice;
      setSelectedSizeChoice(size);
      const complete =
        (!sizes.length || Boolean(size)) &&
        (!colors.length || Boolean(color));
      const match = complete ? matchingVariant(size, color) : null;
      if (match?.in_stock) selectVariant(match);
      else setSelectedVariant(null);
      setNotice("");
      return;
    }

    const currentCombination = matchingVariant(size, selectedColor);
    const match =
      (currentCombination?.in_stock && currentCombination) ||
      variants.find((variant) => variant.size === size && variant.in_stock) ||
      currentCombination ||
      variants.find((v) => v.size === size);

    if (match) selectVariant(match);
    setNotice("");
  }

  function chooseColor(color) {
    if (requireVariantSelection) {
      const size = selectedSizeChoice;
      setSelectedColorChoice(color);
      const complete =
        (!sizes.length || Boolean(size)) &&
        (!colors.length || Boolean(color));
      const match = complete ? matchingVariant(size, color) : null;
      if (match?.in_stock) selectVariant(match);
      else setSelectedVariant(null);
      setNotice("");
      return;
    }

    const currentCombination = matchingVariant(selectedSize, color);
    const match =
      (currentCombination?.in_stock && currentCombination) ||
      variants.find((variant) => variant.color === color && variant.in_stock) ||
      currentCombination ||
      variants.find((v) => v.color === color);

    if (match) selectVariant(match);
    setNotice("");
  }

  function selectVariant(variant) {
    setSelectedVariant(variant);
    setSelectedSizeChoice(variant.size || "");
    setSelectedColorChoice(variant.color || "");
    setQuantity((current) =>
      variant.stock > 0 ? Math.min(current, variant.stock) : 1
    );
  }

  const currentPrice = selectedVariant?.price ?? product.price;
  const originalPrice =
    selectedVariant?.original_price ?? product.original_price;

  const available = Boolean(selectedVariant?.in_stock && selectedVariant.stock > 0);
  const lineTotal = Number(currentPrice || 0) * quantity;
  const availableVariants = variants.filter((variant) => variant.in_stock);
  const availableSizes = [...new Set(
    availableVariants.map((variant) => variant.size).filter(Boolean)
  )];
  const availableColors = [...new Set(
    availableVariants.map((variant) => variant.color).filter(Boolean)
  )];
  const productHighlights = [
    product.category?.name && {
      label: "Category",
      value: product.category.name,
    },
    product.collection && {
      label: "Collection",
      value: product.collection,
    },
    product.brand && {
      label: "Brand",
      value: product.brand,
    },
    availableColors.length > 0 && {
      label: "Available colors",
      value: availableColors.join(", "),
    },
    availableSizes.length > 0 && {
      label: "Available sizes",
      value: availableSizes.join(", "),
    },
    product.discount_percent > 0 && {
      label: "Offer",
      value: `${product.discount_percent}% off`,
    },
  ].filter(Boolean);

  function requireLogin() {
    if (user) return true;
    toast("Please log in first.");
    navigate("/login");
    return false;
  }

  async function handleAddToCart() {
    if (!requireLogin() || !selectedVariant || !available) return;

    try {
      setAddingToCart(true);
      await addCartItem(selectedVariant.id, quantity);
      toast(
        `${quantity > 1 ? `${quantity} × ` : ""}${product.name} added to your cart.`
      );
    } catch (error) {
      toast(
        error.response?.data?.quantity?.[0] ||
          error.response?.data?.detail ||
          "Could not add to cart."
      );
    } finally {
      setAddingToCart(false);
    }
  }

  function handleBuyNow() {
    if (!requireLogin() || !selectedVariant || !available) return;

    navigate("/checkout", {
      state: {
        buyNow: {
          variant_id: selectedVariant.id,
          quantity,
          name: product.name,
          image: selectedImage || product.image,
          size: selectedSize,
          color: selectedColor,
          price: currentPrice,
          line_total: lineTotal,
        },
      },
    });
  }

  async function handleLoadMoreReviews() {
    if (loadingMoreReviews) return;
    setLoadingMoreReviews(true);
    try {
      const page = Math.floor(productReviews.results.length / 5) + 1;
      const data = await getProductReviews(slug, { page });
      setReviewState((state) => {
        if (state.requestKey !== reviewRequestKey) return state;
        return {
          ...state,
          results: [...state.results, ...data.results],
        };
      });
    } catch {
      toast("Could not load more reviews.");
    } finally {
      setLoadingMoreReviews(false);
    }
  }

  async function handleWishlist() {
    if (!requireLogin()) return;

    try {
      setAddingToWishlist(true);
      if (wishlistItemId != null) {
        await removeWishlistItem(wishlistItemId);
        setWishlistState({
          ownerId: wishlistOwnerId,
          productId: product.id,
          itemId: null,
        });
        toast(`${product.name} removed from your wishlist.`);
      } else {
        const item = await addWishlistItem(product.id);
        setWishlistState({
          ownerId: wishlistOwnerId,
          productId: product.id,
          itemId: item.id,
        });
        toast(`${product.name} added to your wishlist.`);
      }
    } catch (error) {
      toast(
        error.response?.data?.detail ||
          `Could not ${wishlistItemId != null ? "remove from" : "add to"} wishlist.`
      );
    } finally {
      setAddingToWishlist(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="product-detail-page">
      <nav className="pd-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <span>{product.category?.name || "Products"}</span>
        <span>/</span>
        <span>{product.name}</span>
      </nav>

      <section className="pd-layout">
        <div className="pd-gallery">
          <div className="pd-main-image">
            {selectedImage ? (
              <button
                ref={imagePreviewTrigger}
                className="pd-image-open"
                type="button"
                onClick={() => setImagePreviewOpen(true)}
                aria-label={`Preview ${product.name} image`}
              >
                <img src={selectedImage} alt={product.name} />
                <span className="pd-image-zoom" aria-hidden="true">
                  <Icon name="search" size={18} />
                </span>
              </button>
            ) : (
              <div className="pd-no-image">No image available</div>
            )}

            <button
              type="button"
              className={`pd-wishlist pd-image-wishlist${wishlistItemId != null ? " is-active" : ""}`}
              onClick={handleWishlist}
              aria-label={`${wishlistItemId != null ? "Remove" : "Add"} ${product.name} ${wishlistItemId != null ? "from" : "to"} wishlist`}
              aria-pressed={wishlistItemId != null}
              disabled={addingToWishlist || loadingWishlist}
              aria-busy={addingToWishlist}
            >
              <Icon name="heart" size={20} />
            </button>

            {product.discount_percent > 0 && (
              <span className="pd-discount">
                -{product.discount_percent}% OFF
              </span>
            )}
            {images.length > 1 && (
              <span className="pd-image-count" aria-live="polite">
                {Math.max(selectedImageIndex + 1, 1)} / {images.length}
              </span>
            )}
          </div>

          {images.length > 1 && (
            <div className="pd-thumbnails">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  className={
                    selectedImage === image.image
                      ? "pd-thumbnail active"
                      : "pd-thumbnail"
                  }
                  onClick={() => setSelectedImage(image.image)}
                  aria-label={`View image ${index + 1} of ${images.length}`}
                  aria-pressed={selectedImage === image.image}
                >
                  <img src={image.image} alt={`${product.name}, view ${index + 1}`} />
                </button>
              ))}
            </div>
          )}
          {images.length > 1 && (
            <p className="pd-gallery-hint">Select a photo to view it larger</p>
          )}
        </div>

        <div className="pd-details">
          <div>
            <p className="pd-category">
              {product.category?.name || "AUREVO COLLECTION"}
            </p>
            <h1>{product.name}</h1>
          </div>

          {product.brand && (
            <p className="pd-brand">By {product.brand}</p>
          )}

          <div className="pd-prices">
            <strong>{formatPrice(currentPrice)}</strong>

            {originalPrice &&
              Number(originalPrice) > Number(currentPrice) && (
                <>
                  <del>{formatPrice(originalPrice)}</del>
                  <span className="pd-save">
                    Save{" "}
                    {Math.round(
                      ((Number(originalPrice) - Number(currentPrice)) /
                        Number(originalPrice)) *
                        100
                    )}
                    %
                  </span>
                </>
              )}
          </div>

          <p className={available ? "pd-stock in-stock" : "pd-stock out-stock"} aria-live="polite">
            <span />
            {available
              ? selectedVariant.stock <= 5
                ? `Only ${selectedVariant.stock} left in stock`
                : `${selectedVariant.stock} available`
              : "Currently unavailable"}
          </p>

          <div className="pd-divider" />

          <section className="pd-option">
            <div className="pd-option-heading">
              <h2>Color</h2>
              <span>{selectedColor || "Choose a color"}</span>
            </div>

            <div className="pd-choice-list">
              {colors.length ? colors.map((color) => {
                const variant = matchingVariant(selectedSize, color) ||
                  variants.find((v) => v.color === color);
                const colorAvailable = variants.some(
                  (v) => v.color === color && v.in_stock
                );

                return (
                  <button
                    key={color}
                    type="button"
                    className={`pd-choice pd-color-choice${selectedColor === color ? " active" : ""}`}
                    onClick={() => chooseColor(color)}
                    disabled={!variant || !colorAvailable}
                    aria-pressed={selectedColor === color}
                    aria-label={`${color}${colorAvailable ? "" : ", sold out"}`}
                    title={colorAvailable ? color : `${color} - sold out`}
                  >
                    <span
                      className="pd-color-swatch"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span>{color}</span>
                    {!colorAvailable && " (Sold out)"}
                  </button>
                );
              }) : <p className="pd-option-empty">No color options required.</p>}
            </div>
          </section>

          <section className="pd-option">
            <div className="pd-option-heading">
              <h2>Size</h2>
              <span>{selectedSize || "Choose a size"}</span>
            </div>

            <div className="pd-choice-list">
              {sizes.length ? sizes.map((size) => {
                const variant =
                  matchingVariant(size, selectedColor) ||
                  variants.find((v) => v.size === size);

                const sizeAvailable = variants.some(
                  (v) => v.size === size && v.in_stock
                );

                return (
                  <button
                    key={size}
                    type="button"
                    className={
                      selectedSize === size
                        ? "pd-choice pd-size active"
                        : "pd-choice pd-size"
                    }
                    onClick={() => chooseSize(size)}
                    disabled={!variant || !sizeAvailable}
                    aria-pressed={selectedSize === size}
                    title={sizeAvailable ? size : `${size} - sold out`}
                  >
                    {size}
                    {!sizeAvailable && " ×"}
                  </button>
                );
              }) : <p className="pd-option-empty">No size options required.</p>}
            </div>
          </section>

          {requireVariantSelection && !selectedVariant && (
            <p className="pd-selection-prompt" role="status">
              {selectedSize && selectedColor
                ? "That size and color combination is unavailable. Choose another option."
                : `Choose ${[
                    sizes.length && !selectedSize ? "a size" : null,
                    colors.length && !selectedColor ? "a color" : null,
                  ]
                    .filter(Boolean)
                    .join(" and ")} to continue.`}
            </p>
          )}

          <div className="pd-purchase-row">
            <div className="pd-quantity">
              <span className="pd-quantity-label">Quantity</span>
              <div className="pd-quantity-control" role="group" aria-label="Choose quantity">
                <button
                  type="button"
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  disabled={!available || quantity <= 1}
                  aria-label="Decrease quantity"
                >
                  <Icon name="minus" size={15} />
                </button>
                <output aria-live="polite">{quantity}</output>
                <button
                  type="button"
                  onClick={() => setQuantity((value) => Math.min(selectedVariant.stock, value + 1))}
                  disabled={!available || quantity >= selectedVariant.stock}
                  aria-label="Increase quantity"
                >
                  <Icon name="plus" size={15} />
                </button>
              </div>
            </div>
            <p className="pd-line-total">
              <span>Subtotal</span>
              <strong>{formatPrice(lineTotal)}</strong>
            </p>
          </div>

          <section className="pd-delivery" aria-label="Delivery information">
            <div className="pd-delivery-item">
              <Icon name="package" size={18} />
              <div>
                <strong>Free delivery</strong>
                <span>Shipping is free on this order.</span>
              </div>
            </div>
            <div className="pd-delivery-item">
              <Icon name="history" size={18} />
              <div>
                <strong>Delivery updates</strong>
                <span>
                  Check your delivery status and date in{" "}
                  <Link to={user ? "/orders" : "/login"}>My Orders</Link>
                  {" "}after placing your order.
                </span>
              </div>
            </div>
            <div className="pd-delivery-item">
              <Icon name="badge-check" size={18} />
              <div>
                <strong>Payment choice</strong>
                <span>Cash on delivery is available at checkout.</span>
              </div>
            </div>
          </section>

          {notice && (
            <p className="pd-notice" role="status">
              {notice}
            </p>
          )}

          {product.description?.trim() && (
            <div className="pd-description">
              <h2>Product details</h2>
              <p>{product.description}</p>
            </div>
          )}

          {productHighlights.length > 0 && (
            <section className="pd-highlights" aria-labelledby="pd-highlights-title">
              <h2 id="pd-highlights-title">Product highlights</h2>
              <ul>
                {productHighlights.map((highlight) => (
                  <li key={highlight.label}>
                    <span>{highlight.label}</span>
                    <strong>{highlight.value}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="pd-meta">
            <h2>Product information</h2>
            <dl>
              <div>
                <dt>Category</dt>
                <dd>{product.category?.name || "—"}</dd>
              </div>
              {product.collection && (
                <div>
                  <dt>Collection</dt>
                  <dd>{product.collection}</dd>
                </div>
              )}
            {product.brand && (
                <div>
                  <dt>Brand</dt>
                  <dd>{product.brand}</dd>
                </div>
              )}
              {product.sku && (
                <div>
                  <dt>Product SKU</dt>
                  <dd>{product.sku}</dd>
                </div>
              )}
              {selectedVariant && (
                <div>
                  <dt>Selected option</dt>
                  <dd>{[selectedVariant.color, selectedVariant.size].filter(Boolean).join(" · ") || "Standard"}</dd>
                </div>
              )}
              {selectedVariant?.sku && (
                <div>
                  <dt>Variant SKU</dt>
                  <dd>{selectedVariant.sku}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="pd-actions">
            <button
              type="button"
              className="pd-buy-now"
              onClick={handleBuyNow}
              disabled={!available || addingToCart}
            >
              Buy now
            </button>
            <button
              type="button"
              className="pd-add-cart"
              onClick={handleAddToCart}
              disabled={!available || addingToCart}
            >
              {addingToCart
                ? "Adding..."
                : available
                  ? "Add to cart"
                  : "Out of stock"}
            </button>
          </div>
        </div>
      </section>

      <section className="pd-reviews" aria-labelledby="pd-reviews-title">
        <div className="pd-reviews-heading">
          <div>
            <p className="pd-category">CUSTOMER FEEDBACK</p>
            <h2 id="pd-reviews-title">Reviews</h2>
          </div>
          {!reviewsLoading && !productReviews.error && (
            <span className="pd-review-count">
              {productReviews.count} {productReviews.count === 1 ? "review" : "reviews"}
            </span>
          )}
        </div>

        {reviewsLoading ? (
          <p className="pd-reviews-state" role="status">Loading customer reviews...</p>
        ) : productReviews.error ? (
          <div className="pd-reviews-state" role="alert">
            <p>{productReviews.error}</p>
            <button
              type="button"
              className="pd-review-retry"
              onClick={() => setReviewAttempt((attempt) => attempt + 1)}
            >
              Try again
            </button>
          </div>
        ) : productReviews.count === 0 ? (
          <div className="pd-reviews-empty">
            <span aria-hidden="true">☆</span>
            <h3>No reviews yet</h3>
            <p>Customer reviews will appear here after they have been approved.</p>
          </div>
        ) : (
          <div className="pd-reviews-content">
            <aside className="pd-rating-summary" aria-label="Customer rating summary">
              <div className="pd-rating-overall">
                <strong>{Number(productReviews.averageRating).toFixed(1)}</strong>
                <span className="pd-stars" aria-label={`${productReviews.averageRating} out of 5 stars`}>
                  {"★".repeat(Math.round(productReviews.averageRating))}
                  {"☆".repeat(5 - Math.round(productReviews.averageRating))}
                </span>
                <span>{productReviews.count} verified customer {productReviews.count === 1 ? "review" : "reviews"}</span>
              </div>
              <div className="pd-rating-bars">
                {[5, 4, 3, 2, 1].map((rating) => {
                  const ratingCount = productReviews.ratingDistribution[String(rating)] || 0;
                  const percentage = (ratingCount / productReviews.count) * 100;
                  return (
                    <div className="pd-rating-row" key={rating}>
                      <span>{rating} <span aria-hidden="true">★</span></span>
                      <div
                        className="pd-rating-track"
                        role="meter"
                        aria-label={`${rating} star reviews`}
                        aria-valuemin={0}
                        aria-valuemax={productReviews.count}
                        aria-valuenow={ratingCount}
                      >
                        <span style={{ width: `${percentage}%` }} />
                      </div>
                      <span>{ratingCount}</span>
                    </div>
                  );
                })}
              </div>
            </aside>

            <div className="pd-review-list" aria-label="Customer reviews">
              {productReviews.results.map((review) => (
                <article className="pd-review-card" key={review.id}>
                  <div className="pd-review-card-heading">
                    <div>
                      <h3>{review.customer_name}</h3>
                      <span className="pd-review-date">
                        {new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "medium",
                        }).format(new Date(review.created_at))}
                      </span>
                    </div>
                    <span className="pd-review-stars" aria-label={`${review.rating} out of 5 stars`}>
                      {"★".repeat(review.rating)}
                      {"☆".repeat(5 - review.rating)}
                    </span>
                  </div>
                  {review.comment && <p>{review.comment}</p>}
                  <span className="pd-verified-label">
                    <Icon name="badge-check" size={14} />
                    Verified purchase
                  </span>
                </article>
              ))}
              {productReviews.results.length < productReviews.count && (
                <button
                  type="button"
                  className="pd-review-more"
                  onClick={handleLoadMoreReviews}
                  disabled={loadingMoreReviews}
                >
                  {loadingMoreReviews ? "Loading..." : "Load more reviews"}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {relatedProducts.length > 0 && (
        <section className="pd-related" aria-labelledby="pd-related-title">
          <div className="pd-related-heading">
            <div>
              <p className="pd-category">MORE FROM THE COLLECTION</p>
              <h2 id="pd-related-title">You may also like</h2>
            </div>
          </div>
          <div className="product-grid pd-related-grid">
            {relatedProducts.map((item) => (
              <article className="product-card pd-related-card" key={item.id}>
                <div className="product-media">
                  <Link
                    to={`/products/${item.slug}`}
                    aria-label={`View details for ${item.name}`}
                  >
                    <ImageSlot
                      src={item.image}
                      tint={RELATED_TINTS[item.id % RELATED_TINTS.length]}
                      alt={item.name}
                    />
                  </Link>
                  {item.discount_percent > 0 && (
                    <span className="badge-discount">
                      -{item.discount_percent}%
                    </span>
                  )}
                </div>
                <div className="product-info">
                  <span className="product-cat">{item.category.name}</span>
                  <h3>{item.name}</h3>
                  <ProductRating
                    averageRating={item.average_rating}
                    reviewCount={item.review_count}
                  />
                  <p className="price">
                    <strong>{formatPrice(item.price)}</strong>
                    {item.original_price && (
                      <s>{formatPrice(item.original_price)}</s>
                    )}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {imagePreviewOpen && selectedImage && (
        <div
          className="pd-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${product.name} image preview`}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeImagePreview();
          }}
        >
          <button
            ref={imagePreviewClose}
            className="pd-lightbox-close"
            type="button"
            onClick={closeImagePreview}
            aria-label="Close image preview"
          >
            <Icon name="x" size={22} />
          </button>
          <img
            className="pd-lightbox-image"
            src={selectedImage}
            alt={`${product.name} enlarged`}
          />
          {images.length > 1 && (
            <>
              <button
                className="pd-lightbox-nav pd-lightbox-prev"
                type="button"
                onClick={() => changeImage(-1)}
                aria-label="Previous product image"
              >
                <Icon name="arrow-left" size={20} />
              </button>
              <button
                className="pd-lightbox-nav pd-lightbox-next"
                type="button"
                onClick={() => changeImage(1)}
                aria-label="Next product image"
              >
                <Icon name="arrow-right" size={20} />
              </button>
              <p className="pd-lightbox-count">
                {selectedImageIndex + 1} / {images.length}
              </p>
            </>
          )}
        </div>
      )}
    </main>
      <SiteFooter />
    </>
  );
}

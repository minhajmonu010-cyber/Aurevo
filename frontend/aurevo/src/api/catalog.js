import api from "./axios";

// The shop's public API: anyone can read it, nobody can change anything through it.
const data = (promise) => promise.then((response) => response.data);
const PUBLIC_CACHE_TTL = 15_000;
const publicCache = new Map();
const publicRequests = new Map();

function cachedPublicRequest(key, request) {
  const cached = publicCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value);
  }

  const pending = publicRequests.get(key);
  if (pending) return pending;

  const requestPromise = request()
    .then(({ data: responseData }) => {
      publicCache.set(key, {
        value: responseData,
        expiresAt: Date.now() + PUBLIC_CACHE_TTL,
      });
      return responseData;
    })
    .finally(() => publicRequests.delete(key));
  publicRequests.set(key, requestPromise);
  return requestPromise;
}

function queryKey(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => query.set(key, String(value)));
  return query.toString();
}

// -> [{ id, name, slug, description, image, is_featured, in_search_suggest, product_count }]
// Includes every active category; product_count may be zero.
export const getCategories = () =>
  cachedPublicRequest("categories", () => api.get("/catalog/categories/"));

// -> [{ id, name, description, discount_type, discount_value, applies_to, target_names, end_date }]
export const getOffers = () =>
  cachedPublicRequest("offers", () => api.get("/catalog/offers/"));

// params: category (slug), search, featured ("true"), ordering (featured | newest | price_asc | price_desc), page, page_size
// -> { count, next, previous, results: [{ id, name, slug, category, brand, image, price, original_price, discount_percent, in_stock, is_featured, average_rating, review_count }] }
export const getProducts = (params = {}) => {
  const key = queryKey(params);
  return cachedPublicRequest(`products:${key}`, () =>
    api.get("/catalog/products/", { params })
  );
};

export const getProduct = (slug) => data(api.get(`/catalog/products/${slug}/`));
export const getProductReviews = (slug, params = {}) =>
  data(api.get(`/catalog/products/${slug}/reviews/`, { params }));
export const getCart = () => data(api.get("/shop/cart/"));
export const addCartItem = (variantId, quantity = 1) =>
  data(api.post("/shop/cart/", { variant_id: variantId, quantity }));
export const updateCartItem = (id, quantity) =>
  data(api.patch(`/shop/cart/${id}/`, { quantity }));
export const removeCartItem = (id) =>
  data(api.delete(`/shop/cart/${id}/`));

export const getWishlist = () => data(api.get("/shop/wishlist/"));
export const addWishlistItem = (productId) =>
  data(api.post("/shop/wishlist/", { product_id: productId }));
export const removeWishlistItem = (id) =>
  data(api.delete(`/shop/wishlist/${id}/`));
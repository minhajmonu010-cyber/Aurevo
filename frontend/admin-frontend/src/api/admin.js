import api from "./axios";
//import api from "./client";

const data = (promise) => promise.then((response) => response.data);

// ---- dashboard
export const getDashboard = (range) => data(api.get("/admin/dashboard/", { params: { range } }));
export const getDashboardOrders = (params) => data(api.get("/admin/dashboard/orders/", { params }));

// ---- categories (send FormData when there is a picture)
export const listCategories = (params) => data(api.get("/admin/catalog/categories/", { params }));
export const categoryStats = () => data(api.get("/admin/catalog/categories/stats/"));
export const getCategory = (id) => data(api.get(`/admin/catalog/categories/${id}/`));
export const createCategory = (body) => data(api.post("/admin/catalog/categories/", body));
export const updateCategory = (id, body) => data(api.patch(`/admin/catalog/categories/${id}/`, body));
export const deleteCategory = (id) => data(api.delete(`/admin/catalog/categories/${id}/`));
export const reorderCategories = (order) => data(api.post("/admin/catalog/categories/reorder/", { order }));

// ---- products
export const listProducts = (params) => data(api.get("/admin/catalog/products/", { params }));
export const productStats = () => data(api.get("/admin/catalog/products/stats/"));
export const getProduct = (id) => data(api.get(`/admin/catalog/products/${id}/`));
export const createProduct = (body) => data(api.post("/admin/catalog/products/", body));
export const updateProduct = (id, body) => data(api.patch(`/admin/catalog/products/${id}/`, body));
export const deleteProduct = (id) => data(api.delete(`/admin/catalog/products/${id}/`));
export const listBrands = () => data(api.get("/admin/catalog/brands/", { params: { page_size: 100 } }));

// ---- variants, stock and pictures of one product
export const addVariant = (productId, body) => data(api.post(`/admin/catalog/products/${productId}/variants/`, body));
export const updateVariant = (id, body) => data(api.patch(`/admin/catalog/variants/${id}/`, body));
export const deleteVariant = (id) => api.delete(`/admin/catalog/variants/${id}/`);
export const adjustStock = (id, body) => data(api.post(`/admin/catalog/variants/${id}/stock/`, body));
export const uploadImage = (productId, file, isPrimary = false) => {
  const form = new FormData();
  form.append("image", file);
  if (isPrimary) form.append("is_primary", "true");
  return data(api.post(`/admin/catalog/products/${productId}/images/`, form));
};
export const updateImage = (id, body) => {
  const payload = body.image instanceof File ? toFormData(body) : body;
  return data(api.patch(`/admin/catalog/images/${id}/`, payload));
};
export const deleteImage = (id) => api.delete(`/admin/catalog/images/${id}/`);

// Turns a plain object into FormData (true/false as text, null as an empty value, files as they are).
export function toFormData(values) {
  const form = new FormData();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) return;
    form.append(key, value === null ? "" : typeof value === "boolean" ? String(value) : value);
  });
  return form;
}
export const getInventory = async (params = {}) => {
  const response = await api.get("/admin/auth/inventory/", {
    params,
  });

  return response.data;
};

export const getSalesReport = async (params = {}) => {
  const response = await api.get("/admin/dashboard/sales-report/", {
    params,
  });

  return response.data;
};

export const getAdminProfile = async () => {
  const response = await api.get("/admin/auth/me/");
  return response.data;
};

export const updateAdminProfile = async (body) => {
  const response = await api.patch("/admin/auth/me/", body);
  return response.data;
};
// Add to your existing src/api/admin.js

export const getAdminOrders = async (params = {}) => {
  const response = await api.get("/admin/auth/orders/", { params });
  return response.data;
};

export const getAdminOrder = async (orderId) => {
  const response = await api.get(`/admin/auth/orders/${orderId}/`);
  return response.data;
};

export const updateAdminOrderStatus = async (orderId, update) => {
  const response = await api.patch(
    `/admin/auth/orders/${orderId}/status/`,
    typeof update === "string" ? { status: update } : update
  );

  return response.data;
};
export const checkAdminOrderRefundStatus = async (orderId) => {
  const response = await api.post(`/admin/auth/orders/${orderId}/refund-status/`);
  return response.data;
};

export const creditAdminOrderRefundToWallet = async (orderId) => {
  const response = await api.post(`/admin/auth/orders/${orderId}/wallet-refund/`);
  return response.data;
};

// src/api/admin.js

export const getAdminCustomers = async (params = {}) => {
  const response = await api.get("/admin/auth/customers/", {
    params,
  });

  return response.data;
};

export const getAdminCustomer = async (customerId) => {
  const response = await api.get(
    `/admin/auth/customers/${customerId}/`
  );

  return response.data;
};

export const updateAdminCustomer = async (customerId, body) => {
  const response = await api.patch(`/admin/auth/customers/${customerId}/`, body);
  return response.data;
};
export const getAdminReturns = async (params = {}) => {
  const response = await api.get("/admin/auth/returns/", {
    params,
  });

  return response.data;
};

export const updateAdminReturnStatus = async (returnId, newStatus) => {
  const response = await api.patch(
    `/admin/auth/returns/${returnId}/status/`,
    { status: newStatus }
  );

  return response.data;
};
export const getAdminCoupons = (params = {}) =>
  api.get("/admin/auth/coupons/", { params });

export const createAdminCoupon = (data) =>
  api.post("/admin/auth/coupons/", data);

export const updateAdminCoupon = (id, data) =>
  api.patch(`/admin/auth/coupons/${id}/`, data);

export const deleteAdminCoupon = (id) =>
  api.delete(`/admin/auth/coupons/${id}/`);
export const getAdminWalletOverview = () =>
  api.get("/admin/auth/wallet/overview/");

export const getAdminWalletTransactions = (params = {}) =>
  api.get("/admin/auth/wallet/transactions/", { params });

export const getAdminWalletCustomers = (params = {}) =>
  api.get("/admin/auth/wallet/customers/", { params });
export const getAdminOffers = (params = {}) =>
  api.get("/admin/auth/offers/", { params });

export const createAdminOffer = (data) =>
  api.post("/admin/auth/offers/", data);

export const updateAdminOffer = (id, data) =>
  api.patch(`/admin/auth/offers/${id}/`, data);

export const deleteAdminOffer = (id) =>
  api.delete(`/admin/auth/offers/${id}/`);

export const getAdminReviews = async (params = {}) => {
  const response = await api.get("/admin/auth/reviews/", { params });
  return response.data;
};

export const updateAdminReview = async (id, isApproved) => {
  const response = await api.patch(`/admin/auth/reviews/${id}/`, {
    is_approved: isApproved,
  });
  return response.data;
};

export const deleteAdminReview = (id) =>
  api.delete(`/admin/auth/reviews/${id}/`);
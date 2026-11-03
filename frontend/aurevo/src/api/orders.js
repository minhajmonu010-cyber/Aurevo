import api from "./axios";

// These endpoints must be registered in Django before use.
export const getOrders = () => api.get("/orders/");

export const getOrder = (id) => api.get(`/orders/${id}/`);
export const createOrder = (data) => api.post("/orders/checkout/", data);
export const getCheckoutOptions = () => api.get("/orders/checkout/");
export const getAvailableCoupons = (params = {}) => api.get("/orders/checkout/coupons/", { params });
export const verifyPayment = (data) => api.post("/orders/checkout/verify/", data);
export const cancelPayment = (data) => api.post("/orders/checkout/cancel/", data);

export const cancelOrder = (id) =>
  api.post(`/orders/${id}/cancel/`);

export const returnOrder = (id, reason) =>
  api.post(`/orders/${id}/return/`, { reason });

export const submitOrderItemReview = (orderId, itemId, data) =>
  api.post(`/orders/${orderId}/items/${itemId}/review/`, data);

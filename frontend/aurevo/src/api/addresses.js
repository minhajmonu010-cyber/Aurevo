import api from "./axios";

export const getAddresses = () => api.get("/addresses/");

export const createAddress = (data) => api.post("/addresses/", data);

export const updateAddress = (id, data) =>
  api.patch(`/addresses/${id}/`, data);

export const deleteAddress = (id) =>
  api.delete(`/addresses/${id}/`);
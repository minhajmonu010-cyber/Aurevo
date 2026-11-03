import api from "./axios";

export const getWallet = () => api.get("/wallet/");
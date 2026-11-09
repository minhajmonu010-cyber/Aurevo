import axios from "axios";

export const API_URL = import.meta.env.VITE_API_URL || "https://api.minhaj.website/api";

// different keys from the user app, so the two apps never share a session
const ACCESS_KEY = "outfito_admin_access";
const REFRESH_KEY = "outfito_admin_refresh";

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access, refresh) {
    if (access) localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

const api = axios.create({ baseURL: API_URL });

// attach the access token to every request
api.interceptors.request.use((config) => {
  const token = tokens.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// on 401, try to get a new access token once, then repeat the request
let refreshing = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const url = original?.url || "";
    const isAuthCall = url.includes("/admin/auth/login/") || url.includes("/admin/auth/token/refresh/");

    if (error.response?.status === 401 && !original._retry && tokens.refresh && !isAuthCall) {
      original._retry = true;
      try {
        refreshing =
          refreshing ||
          axios
            .post(`${API_URL}/admin/auth/token/refresh/`, { refresh: tokens.refresh })
            .finally(() => {
              refreshing = null;
            });
        const { data } = await refreshing;
        tokens.set(data.access, data.refresh); // refresh tokens rotate
        original.headers.Authorization = `Bearer ${data.access}`;
        return api(original);
      } catch (refreshError) {
        tokens.clear();
        window.dispatchEvent(new Event("auth:logout"));
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
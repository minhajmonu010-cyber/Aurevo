import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { tokens } from "../api/axios";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // restore the session on page load; the server decides whether it is still an admin
  useEffect(() => {
    let active = true;

    async function restore() {
      if (!tokens.access && !tokens.refresh) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await api.get("/admin/auth/me/");
        if (active) setUser(data);
      } catch {
        tokens.clear(); // expired, or this account is no longer an admin
      } finally {
        if (active) setLoading(false);
      }
    }

    restore();
    const onForcedLogout = () => setUser(null);
    window.addEventListener("auth:logout", onForcedLogout);
    return () => {
      active = false;
      window.removeEventListener("auth:logout", onForcedLogout);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post("/admin/auth/login/", { email, password });
    tokens.set(data.access, data.refresh);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      if (tokens.refresh) await api.post("/admin/auth/logout/", { refresh: tokens.refresh });
    } catch {
      /* the server may be unreachable; still clear the local session */
    }
    tokens.clear();
    setUser(null);
  }, []);

  const updateUser = useCallback((updates) => setUser((current) => current ? { ...current, ...updates } : current), []);
  const value = useMemo(() => ({ user, loading, login, logout, updateUser }), [user, loading, login, logout, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
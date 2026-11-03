import { useCallback, useEffect, useMemo, useState } from "react";
import api, { tokens } from "../api/axios";
import { AuthContext } from "./authState";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const updateUser =useCallback((next)=>setUser(next),[]);

  // restore the session on page load
  useEffect(() => {
    let active = true;

    async function restore() {
      if (!tokens.access && !tokens.refresh) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await api.get("/auth/me/");
        if (active) setUser(data);
      } catch {
        tokens.clear();
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
    const { data } = await api.post("/auth/login/", { email, password });
    tokens.set(data.access, data.refresh);
    setUser(data.user);
    return data.user;
  }, []);

  const loginWithGoogle = useCallback(async (credential) => {
    const { data } = await api.post("/auth/google/", { credential });
    tokens.set(data.access, data.refresh);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      if (tokens.refresh) await api.post("/auth/logout/", { refresh: tokens.refresh });
    } catch {
      /* the server may be unreachable; still clear the local session */
    }
    tokens.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, loginWithGoogle,updateUser, logout }),
    [user, loading, login, loginWithGoogle,updateUser, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// The login page is not for admins who are already signed in.
export default function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="splash">Loading...</div>;
  if (user) {
    const requestedLocation = location.state?.from;
    const redirectTo =
      requestedLocation?.pathname?.startsWith("/") &&
      !requestedLocation.pathname.startsWith("//")
        ? `${requestedLocation.pathname}${requestedLocation.search || ""}${requestedLocation.hash || ""}`
        : "/";
    return <Navigate to={redirectTo} replace />;
  }
  return children;
}
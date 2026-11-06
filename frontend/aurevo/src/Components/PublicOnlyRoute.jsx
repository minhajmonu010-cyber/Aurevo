import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/authState";

// Login, signup and password pages are not for people who are already signed in.
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
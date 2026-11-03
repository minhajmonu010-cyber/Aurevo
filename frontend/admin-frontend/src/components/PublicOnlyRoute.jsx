import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// The login page is not for admins who are already signed in.
export default function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="splash">Loading...</div>;
  if (user) return <Navigate to={location.state?.from?.pathname || "/"} replace />;
  return children;
}
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Only signed-in admins. (The real protection is on the server: every admin API checks is_staff.)
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="splash">Loading...</div>;
  if (!user || !user.is_staff) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}
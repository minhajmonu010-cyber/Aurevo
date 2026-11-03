import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/authState";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="splash">Loading...</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}
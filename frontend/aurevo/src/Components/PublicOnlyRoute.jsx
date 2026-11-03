import { Navigate } from "react-router-dom";
import { useAuth } from "../context/authState";

// Login, signup and password pages are not for people who are already signed in.
export default function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="splash">Loading...</div>;
  if (user) return <Navigate to="/" replace />;
  return children;
}
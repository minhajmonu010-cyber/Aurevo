import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./Components/ProtectedRoute";
import PublicOnlyRoute from "./Components/PublicOnlyRoute";
import { ToastProvider } from "./context/ToastContext";

const Signup = lazy(() => import("./pages/Signup"));
const Login = lazy(() => import("./pages/Login"));
const VerifyOtp = lazy(() => import("./pages/VerifyOtp"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const Home = lazy(() => import("./pages/Home"));
const Profile = lazy(() => import("./pages/Profile"));
const EditProfile = lazy(() => import("./pages/EditProfile"));
const Categories = lazy(() => import("./pages/Categories"));
const Cart = lazy(() => import("./pages/Cart"));
const Wishlist = lazy(() => import("./pages/Wishlist"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const Address = lazy(() => import("./pages/Address"));
const Orders = lazy(() => import("./pages/Orders"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const NotFound = lazy(() => import("./pages/NotFound"));

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const guest = (page) => <PublicOnlyRoute>{page}</PublicOnlyRoute>;
const page = (Component) => (
  <Suspense fallback={<div className="route-loading" role="status">Loading page...</div>}>
    <Component />
  </Suspense>
);

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function Routing() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/signup" element={guest(page(Signup))} />
          <Route path="/login" element={guest(page(Login))} />
          <Route path="/verify-otp" element={guest(page(VerifyOtp))} />
          <Route path="/forgot-password" element={guest(page(ForgotPassword))} />
          <Route path="/reset-password" element={guest(page(ResetPassword))} />

          <Route path="/" element={page(Home)} />
          <Route path="/categories" element={page(Categories)} />
          <Route path="/about" element={page(About)} />
          <Route path="/contact" element={page(Contact)} />
          <Route path="/terms" element={page(Terms)} />
          <Route path="/privacy" element={page(Privacy)} />
          <Route path="/products/:slug" element={page(ProductDetail)} />
          <Route path="/cart" element={<ProtectedRoute>{page(Cart)}</ProtectedRoute>} />
          <Route path="/address" element={<ProtectedRoute>{page(Address)}</ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute>{page(Orders)}</ProtectedRoute>} />
          <Route path="/wallet" element={<ProtectedRoute>{page(Wallet)}</ProtectedRoute>} />
          <Route path="/checkout" element={<ProtectedRoute>{page(Checkout)}</ProtectedRoute>} />
          <Route path="/wishlist" element={<ProtectedRoute>{page(Wishlist)}</ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute>{page(Profile)}</ProtectedRoute>} />
          <Route path="/profile/edit" element={<ProtectedRoute>{page(EditProfile)}</ProtectedRoute>} />
          <Route path="/change-password" element={<ProtectedRoute>{page(ChangePassword)}</ProtectedRoute>} />
          <Route path="*" element={page(NotFound)} />

        </Routes>
       </ToastProvider>
      </AuthProvider>
      
    </BrowserRouter>
  );
}

export default function App() {
  // The Google script is only loaded when a Client ID is configured
  return GOOGLE_CLIENT_ID ? (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <Routing />
    </GoogleOAuthProvider>
  ) : (
    <Routing />
  );
}
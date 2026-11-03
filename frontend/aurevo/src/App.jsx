import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./Components/ProtectedRoute";
import PublicOnlyRoute from "./Components/PublicOnlyRoute";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import VerifyOtp from "./pages/VerifyOtp";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ChangePassword from "./pages/ChangePassword";
import Home from "./pages/Home";
import Profile from "./pages/Profile";
import EditProfile from "./pages/EditProfile";
import { ToastProvider } from "./context/ToastContext";
import Categories from "./pages/Categories";
import Cart from "./pages/Cart";
import Wishlist from "./pages/Wishlist";
import About from "./pages/About";
import Contact from "./pages/Contact";
import ProductDetail from "./pages/ProductDetail";
import Address from "./pages/Address";
import Orders from "./pages/Orders";
import Checkout from "./pages/Checkout";
import Wallet from "./pages/Wallet";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import NotFound from "./pages/NotFound";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const guest = (page) => <PublicOnlyRoute>{page}</PublicOnlyRoute>;

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
          <Route path="/signup" element={guest(<Signup />)} />
          <Route path="/login" element={guest(<Login />)} />
          <Route path="/verify-otp" element={guest(<VerifyOtp />)} />
          <Route path="/forgot-password" element={guest(<ForgotPassword />)} />
          <Route path="/reset-password" element={guest(<ResetPassword />)} />

          <Route path="/" element={<Home/>} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/products/:slug" element={<ProductDetail />} />
          <Route path="/cart" element={<ProtectedRoute><Cart /></ProtectedRoute>} />
          <Route path="/address"element={<ProtectedRoute><Address /></ProtectedRoute>}/>
          <Route path="/orders"element={<ProtectedRoute><Orders /></ProtectedRoute>}/>
          <Route path="/wallet"element={<ProtectedRoute><Wallet /></ProtectedRoute>}/>
          <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
          <Route path="/wishlist" element={<ProtectedRoute><Wishlist /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile/></ProtectedRoute>}/>
          <Route path="/profile/edit" element={<ProtectedRoute><EditProfile /></ProtectedRoute>} />
          <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />

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
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import AdminLayout from "./components/AdminLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import PublicOnlyRoute from "./components/PublicOnlyRoute";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Categories = lazy(() => import("./pages/Categories"));
const CategoryEdit = lazy(() => import("./pages/CategoryEdit"));
const Products = lazy(() => import("./pages/Products"));
const ProductEditor = lazy(() => import("./pages/ProductEditor"));
const Inventory = lazy(() => import("./pages/Inventory"));
const SalesReports = lazy(() => import("./pages/SalesReports"));
const AdminProfile = lazy(() => import("./pages/AdminProfile"));
const Orders = lazy(() => import("./pages/Orders"));
const Customers = lazy(() => import("./pages/Customers"));
const Returns = lazy(() => import("./pages/Returns"));
const Coupons = lazy(() => import("./pages/Coupons"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Offers = lazy(() => import("./pages/Offers"));
const Reviews = lazy(() => import("./pages/Reviews"));
const page = (Component) => (
  <Suspense fallback={<div role="status" style={{ padding: 32, textAlign: "center" }}>Loading page...</div>}>
    <Component />
  </Suspense>
);

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<PublicOnlyRoute>{page(Login)}</PublicOnlyRoute>} />
            <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
              <Route path="/" element={page(Dashboard)} />
              <Route path="/categories" element={page(Categories)} />
              <Route path="/categories/:id/edit" element={page(CategoryEdit)} />
              <Route path="/products" element={page(Products)} />
              <Route path="/products/new" element={page(ProductEditor)} />
              <Route path="/products/:id/edit" element={page(ProductEditor)} />
              <Route path="/inventory" element={page(Inventory)} />
              <Route path="/returns" element={page(Returns)} />
              <Route path="/orders" element={page(Orders)} />
              <Route path="/coupons" element={page(Coupons)} />
              <Route path="/customers" element={page(Customers)} />
              <Route path="/reports" element={page(SalesReports)} />
              <Route path="/profile" element={page(AdminProfile)} />
              <Route path="/wallet" element={page(Wallet)} />
              <Route path="/offers" element={page(Offers)} />
              <Route path="/reviews" element={page(Reviews)} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

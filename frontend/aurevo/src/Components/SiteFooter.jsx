import { useState } from "react";
import { Link } from "react-router-dom";
import Logo, { BRAND_NAME } from "./Logo";

const COLUMNS = [
  {
    title: "Shop",
    description: "Find your next favorite pieces for everyday wear and special occasions.",
    items: [
      { label: "Shirts", to: "/categories" },
      { label: "T-shirts", to: "/categories" },
      { label: "Jerseys", to: "/categories" },
      { label: "Pants", to: "/categories" },
      { label: "New Arrivals", to: "/categories" },
    ],
  },
  {
    title: "Customer Support",
    description: "Need help with an order? Visit your account or get in touch with our team.",
    items: [
      { label: "Contact Us", to: "/contact" },
      { label: "Track Order", to: "/orders" },
      { label: "Returns & Refunds", to: "/orders" },
      { label: "FAQs", to: "/contact" },
      { label: "Shipping Info", to: "/contact" },
    ],
  },
  {
    title: "Company",
    description: "Get to know Aurevo, our approach to style, and the policies behind your visit.",
    items: [
      { label: "About Us", to: "/about" },
      { label: "Privacy Policy", to: "/privacy" },
      { label: "Terms of Service", to: "/terms" },
    ],
  },
];

export default function SiteFooter() {
  const [year] = useState(() => new Date().getFullYear());
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand">
          <Logo />
          <p>Premium clothing for the modern you. Casual, formal and everyday pieces, made to last.</p>
        </div>
        {COLUMNS.map((column) => (
          <div className="footer-column" key={column.title}>
            <h3>{column.title}</h3>
            <p className="footer-column-description">{column.description}</p>
            <ul>
              {column.items.map((item) => (
                <li key={item.label}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="footer-copy">
        &copy; {year} {BRAND_NAME}. All rights reserved.
      </p>
    </footer>
  );
}
import { API_URL } from "../api/axios";

// "/media/products/a.jpg" -> "http://localhost:8000/media/products/a.jpg" (full addresses are left alone)
export const mediaUrl = (path) => (!path ? null : /^https?:/.test(path) ? path : `${new URL(API_URL).origin}${path}`);

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const moneyShort = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export const formatPrice = (value) => (value === null || value === undefined || value === "" ? "-" : money.format(Number(value)));
export const formatPriceShort = (value) => moneyShort.format(Number(value || 0));

export function changeText(change) {
  if (change === null || change === undefined || !Number.isFinite(Number(change))) return null;
  const value = Number(change);
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

// 12500 -> 12.5k, 3400000 -> 34 L (compact numbers for chart axes)
export function compact(value) {
  const n = Number(value || 0);
  if (n >= 10000000) return `${+(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `${+(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export const formatNumber = (n) => new Intl.NumberFormat("en-IN").format(Number(n || 0));

export function formatDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// "Today, 14:24" / "Yesterday, 21:05" / "12 Oct, 09:30"
export function formatWhen(iso) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}, ${time}`;
}

export function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export const initials = (name = "") =>
  name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

// "Old Money" -> "old-money"
export const slugify = (text) =>
  text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

// Download rows as a CSV file. rows = array of arrays (the first row is the header).
export function downloadCsv(filename, rows) {
  const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Sample content for the home page. Replace with data from the API when the products backend exists.
// Pictures go in public/images/ (see the README.txt there). A missing picture shows the colour instead.

export const HERO = {
  tag: "New collection 2026",
  title: "It's not a product, it's an identity.",
  image: "/images/hero.jpg",
  tint: "#1d2a44",
  stats: [
    { value: "1.5k+", label: "New arrivals" },
    { value: "10k+", label: "Happy customers" },
  ],
};

export const CATEGORIES = [
  {
    id: "old-money",
    name: "Old Money",
    text: "Timeless tailoring in the quiet style of old money.",
    image: "/images/cat-old-money.jpg",
    tint: "#4a4130",
  },
  {
    id: "free-style",
    name: "Free Style",
    text: "Loose, bold streetwear made to stand out.",
    image: "/images/cat-free-style.jpg",
    tint: "#2c4258",
  },
  {
    id: "retro-jerseys",
    name: "Retro Jerseys",
    text: "Wear the jerseys of the legends.",
    image: "/images/cat-retro-jerseys.jpg",
    tint: "#5a2c2f",
  },
];

export const PRODUCTS = [
  { id: 1, name: "Handcrafted Denim", category: "Pant", price: 7499, originalPrice: 9999, image: "/images/product-1.jpg", tint: "#2b3a52" },
  { id: 2, name: "Graphic Oversized Tee", category: "Tees", price: 1999, originalPrice: 2499, image: "/images/product-2.jpg", tint: "#33333d" },
  { id: 3, name: "Patchwork Edition", category: "Shirt", price: 2199, originalPrice: 2999, image: "/images/product-3.jpg", tint: "#4d4436" },
  { id: 4, name: "Retro Football Jersey", category: "Tees", price: 1299, originalPrice: 1999, image: "/images/product-4.jpg", tint: "#4f4a22" },
  { id: 5, name:"Jersey", category: "Tees", price: 1299, originalPrice: 1999, image: "/images/product-5.jpg", tint: "#32224f" },
  { id: 6, name: "Retro Football Jersey", category: "Tees", price: 1299, originalPrice: 1999, image: "/images/product-4.jpg", tint: "#d7d2c9" },
  { id: 7, name: "Retro Football Jersey", category: "Tees", price: 1299, originalPrice: 1999, image: "/images/product-4.jpg", tint: "#0c9060" },
  { id: 8, name: "Retro Football Jersey", category: "Tees", price: 1299, originalPrice: 1999, image: "/images/product-4.jpg", tint: "#b73e4c" },
];
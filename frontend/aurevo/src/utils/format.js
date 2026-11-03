export const formatPrice = (amount) =>
  `₹${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const discountPercent = (price, originalPrice) =>
  originalPrice > price ? Math.round((1 - price / originalPrice) * 100) : 0;
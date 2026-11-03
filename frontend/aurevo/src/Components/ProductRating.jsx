export default function ProductRating({ averageRating, reviewCount }) {
  if (!reviewCount) {
    return <p className="product-rating product-rating-empty">No reviews yet</p>;
  }

  const rating = Number(averageRating).toFixed(1);
  const reviewLabel = reviewCount === 1 ? "review" : "reviews";

  return (
    <p
      className="product-rating"
      aria-label={`${rating} out of 5 from ${reviewCount} ${reviewLabel}`}
    >
      <span className="product-rating-star" aria-hidden="true">★</span>
      <span>{rating}</span>
      <span className="product-rating-count">({reviewCount})</span>
    </p>
  );
}

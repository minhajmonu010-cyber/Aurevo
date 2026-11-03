
import { useCallback, useEffect, useState } from "react";
import {
  deleteAdminReview,
  getAdminReviews,
  updateAdminReview,
} from "../api/admin";
import ConfirmationDialog from "../components/ConfirmationDialog";
import Icon from "../components/Icon";
import { EmptyState, Pagination, Pill, StatCard } from "../components/ui";
import "../admin.css";

export default function Reviews() {
  const [data, setData] = useState({
    total: 0,
    approved: 0,
    pending: 0,
    average_rating: 0,
    results: [],
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [reviewToDelete, setReviewToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const pageSize = 8;

  const loadReviews = useCallback(async () => {
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (statusFilter !== "all") params.status = statusFilter;
      if (ratingFilter !== "all") params.rating = ratingFilter;

      setData(await getAdminReviews(params));
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        "Unable to load reviews. Check your admin login and API."
      );
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, ratingFilter]);

  useEffect(() => {
    // This effect synchronizes filter changes with an asynchronous API request.
    void Promise.resolve().then(loadReviews);
  }, [loadReviews]);

  async function updateReview(id, isApproved) {
    try {
      setActionId(id);
      setError("");
      await updateAdminReview(id, isApproved);

      await loadReviews();
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        "Could not update the review."
      );
    } finally {
      setActionId(null);
    }
  }

  async function confirmDeleteReview() {
    if (!reviewToDelete) return;
    try {
      setActionId(reviewToDelete.id);
      setDeleteError("");
      await deleteAdminReview(reviewToDelete.id);
      setReviewToDelete(null);
      await loadReviews();
    } catch (err) {
      setDeleteError(
        err.response?.data?.detail ||
        "Could not delete the review."
      );
    } finally {
      setActionId(null);
    }
  }

  const reviews = data.results || [];
  const visibleReviews = reviews.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  return (
    <div className="reviews-page">
      <div className="ad-crumbs">Commerce / <b>Customer reviews</b></div>
      <div className="ad-head">
        <div>
          <h1 className="ad-h1">Customer Reviews</h1>
          <p className="ad-sub">Moderate customer feedback and keep product ratings useful.</p>
        </div>

        <button
          type="button"
          className="ad-btn"
          onClick={loadReviews}
          disabled={loading}
        >
          <Icon name="refresh" size={15} /> {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="ad-alert" role="alert">{error}</div>}

      <section className="ad-stats">
        <StatCard label="Total reviews" value={data.total} icon="star" foot="all customer feedback" />
        <StatCard label="Approved" value={data.approved} icon="circle-check" foot="visible to shoppers" />
        <StatCard label="Pending" value={data.pending} icon="clock" deltaTone="warn" foot="awaiting moderation" />
        <StatCard label="Average rating" value={`${Number(data.average_rating).toFixed(1)} / 5`} icon="star" foot="across all reviews" />
      </section>

      <section className="ad-toolbar" aria-label="Review filters">
        <div className="ad-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            placeholder="Search customer, product or comment..."
            aria-label="Search reviews"
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
        </div>

        <label className="ad-select-inline">
          Status
          <select className="ad-select" value={statusFilter} onChange={(event) => {
            setPage(1);
            setStatusFilter(event.target.value);
          }} aria-label="Review status">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
          </select>
        </label>

        <label className="ad-select-inline">
          Rating
          <select className="ad-select" value={ratingFilter} onChange={(event) => {
            setPage(1);
            setRatingFilter(event.target.value);
          }} aria-label="Review rating">
            <option value="all">All ratings</option>
            {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} stars</option>)}
          </select>
        </label>
      </section>

      <section className="ad-card" aria-label="Customer reviews">
        <div className="ad-card-pad">
          <div className="ad-card-head">
            <div>
              <h3>Review moderation</h3>
              <p className="ad-hint">{reviews.length.toLocaleString("en-IN")} matching reviews</p>
            </div>
            <Pill tone="purple">Customer feedback</Pill>
          </div>
        </div>
        {loading ? (
          <div className="ad-card-pad ad-muted">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <EmptyState icon="star" title="No reviews found">Try changing the search or filters.</EmptyState>
        ) : (
        <div className="ad-table-wrap">
        <table className="ad-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Product</th>
              <th>Rating</th>
              <th>Comment</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {visibleReviews.map((review) => (
              <tr key={review.id}>
                <td>{review.customer_name}</td>
                <td>{review.product_name}</td>

                <td>
                  <span className="review-stars" aria-label={`${review.rating} out of 5 stars`}>
                    {"★".repeat(review.rating)}
                    {"☆".repeat(5 - review.rating)}
                  </span>
                  <small>{review.rating}/5</small>
                </td>

                <td className="review-comment">
                  {review.comment}
                </td>

                <td>
                  <Pill tone={review.is_approved ? "ok" : "warn"}>
                    {review.is_approved
                      ? "Approved"
                      : "Pending"}
                  </Pill>
                </td>

                <td>
                  <div className="ad-row-actions">
                    <button
                      type="button"
                      className="ad-btn sm"
                      disabled={actionId === review.id}
                      onClick={() =>
                        updateReview(
                          review.id,
                          !review.is_approved
                        )
                      }
                    >
                      <Icon name={review.is_approved ? "ban" : "circle-check"} size={13} />
                      {review.is_approved ? "Hide" : "Approve"}
                    </button>

                    <button
                      type="button"
                      className="ad-btn sm outline-danger"
                      disabled={actionId === review.id}
                      onClick={() => {
                        setDeleteError("");
                        setReviewToDelete(review);
                      }}
                    >
                      <Icon name="trash" size={13} />
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}

          </tbody>
        </table>
        </div>
        )}
        <Pagination page={page} pageSize={pageSize} count={reviews.length} noun="reviews" onChange={setPage} />
      </section>
      {reviewToDelete && (
        <ConfirmationDialog
          title="Delete review?"
          message="Permanently delete this customer review? This action cannot be undone."
          confirmLabel="Delete review"
          busy={actionId === reviewToDelete.id}
          error={deleteError}
          onConfirm={confirmDeleteReview}
          onClose={() => {
            setReviewToDelete(null);
            setDeleteError("");
          }}
        />
      )}
    </div>
  );
}

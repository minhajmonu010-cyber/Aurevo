// Aurevo logo (an "A" that is also a clothes hanger) with an ADMIN tag, so the two apps are easy to tell apart.
const BRAND_NAME = "Aurevo";

export default function Logo() {
  return (
    <div className="brand-logo">
      <span className="brand-mark">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 9.5V7.7a2.2 2.2 0 1 0-2.2-2.2" />
          <path d="M5 19 12 9.5 19 19" />
          <path d="M8.3 14.5h7.4" />
        </svg>
      </span>
      <span className="brand-name">{BRAND_NAME.toUpperCase()}</span>
      <span className="brand-tag">ADMIN</span>
    </div>
  );
}
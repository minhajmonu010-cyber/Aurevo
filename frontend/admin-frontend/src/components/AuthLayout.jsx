import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";
import Logo from "./Logo";

/**
 * Shared shell for every auth page: photo panel on the left, glass card on the right.
 *
 * image     path to the photo in /public/images (optional, falls back to a dark gradient)
 * imageOnly the photo already has the logo and text on it: hide our logo and headline on desktop
 * headline  big text on the photo (use <span className="accent"> for the coloured word)
 * copyAt    "bottom" or "middle": where the text sits on the photo
 * icon      icon name for the tile at the top of the card
 * glow      cyan glowing title (login only)
 * align     "center" or "left" card heading
 */
export default function AuthLayout({
  title,
  subtitle,
  icon,
  glow = false,
  align = "center",
  plainLabels = false,
  image,
  imageOnly = false,
  headline,
  serif = false,
  copy,
  copyAt = "bottom",
  joined = false,
  backTo,
  below,
  footer,
  children,
}) {
  const [year] = useState(() => new Date().getFullYear());
  return (
    <div className="auth-page">
      <aside
        className={`auth-brand at-${copyAt}${imageOnly ? " image-only" : ""}`}
        style={image ? { "--photo": `url(${image})` } : undefined}
      >
        <Logo />

        <div className="brand-copy">
          <h2 className={serif ? "serif" : ""}>{headline}</h2>
          {copy && <p>{copy}</p>}
          {joined && (
            <div className="joined">
              <span className="avatars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                Joined by <b>12k+</b> shoppers this month.
              </span>
            </div>
          )}
        </div>

        {copyAt === "middle" && (
          <small className="brand-foot">&copy; {year} Aurevo. All rights reserved.</small>
        )}
      </aside>

      <main className="auth-main">
        {backTo && (
          <Link className="back-top" to={backTo.to}>
            <Icon name="arrow-left" size={14} /> {backTo.label}
          </Link>
        )}

        <section
          className={`auth-card align-${align}${plainLabels ? " plain-labels" : ""}`}
          aria-labelledby="auth-title"
        >
          {icon && (
            <div className="icon-tile">
              <Icon name={icon} size={22} />
            </div>
          )}
          <h1 id="auth-title" className={`auth-title${glow ? " glow" : ""}`}>
            {title}
          </h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </section>

        {below && <p className="below-card">{below}</p>}
      </main>
    </div>
  );
}
import { Link } from "react-router-dom";
import SiteFooter from "../Components/SiteFooter";
import SiteHeader from "../Components/SiteHeader";
import Icon from "../Components/Icon";

export default function NotFound() {
  return (
    <div className="store">
      <SiteHeader />
      <main className="not-found-page">
        <div className="not-found-content">
          <p className="not-found-eyebrow">AUREVO · NOT IN THE COLLECTION</p>
          <p className="not-found-code" aria-hidden="true">404</p>
          <h1>This look isn’t in the collection.</h1>
          <p className="not-found-copy">
            The page you’re looking for may have moved. Discover a new favorite
            in our collections or head back to the Aurevo homepage.
          </p>
          <div className="not-found-actions">
            <Link to="/" className="not-found-home">
              <Icon name="arrow-left" size={16} /> Back to Aurevo
            </Link>
            <Link to="/categories" className="not-found-shop">
              Discover the collection <Icon name="arrow-right" size={16} />
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

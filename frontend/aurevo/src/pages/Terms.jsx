import { Link } from "react-router-dom";
import SiteFooter from "../Components/SiteFooter";
import SiteHeader from "../Components/SiteHeader";
import "../styles/legal.css";

export default function Terms() {
  return (
    <div className="store">
      <SiteHeader />
      <main className="legal-page">
        <p className="legal-eyebrow">AUREVO POLICIES</p>
        <h1>Terms of Service</h1>
        <p className="legal-intro">
          These terms explain the basic rules for using the Aurevo online store.
          By creating an account or placing an order, you agree to use the service
          lawfully and provide accurate information.
        </p>

        <section>
          <h2>Accounts</h2>
          <p>
            Keep your sign-in details secure and make sure your account contact
            and delivery information is accurate. You are responsible for
            activity carried out through your account.
          </p>
        </section>
        <section>
          <h2>Products and availability</h2>
          <p>
            Product descriptions, images, prices, sizes, colours and stock are
            shown as accurately as we can. Availability is based on the selected
            variant and may change before an order is placed.
          </p>
        </section>
        <section>
          <h2>Orders and payment</h2>
          <p>
            An order is subject to product availability and successful payment
            or confirmation of the selected payment method. Order status and
            payment updates are shown in your account when available.
          </p>
        </section>
        <section>
          <h2>Cancellations, returns and refunds</h2>
          <p>
            Online cancellation is available for pending orders. Return requests
            can be submitted for delivered orders and are reviewed before a
            refund is issued. Approved refunds are credited to the customer
            wallet. For help, <Link to="/contact">contact Aurevo</Link> with
            your order number.
          </p>
        </section>
        <section>
          <h2>Contact</h2>
          <p>
            Questions about these terms? Use our <Link to="/contact">Contact
            Us</Link> page. These store terms are a general summary and do not
            replace applicable consumer rights or laws.
          </p>
        </section>
        <p className="legal-note">
          Please have these terms reviewed for your business and applicable
          jurisdiction before relying on them as a formal legal agreement.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

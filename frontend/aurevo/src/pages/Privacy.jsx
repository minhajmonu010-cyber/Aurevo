import { Link } from "react-router-dom";
import SiteFooter from "../Components/SiteFooter";
import SiteHeader from "../Components/SiteHeader";
import "../styles/legal.css";

export default function Privacy() {
  return (
    <div className="store">
      <SiteHeader />
      <main className="legal-page">
        <p className="legal-eyebrow">AUREVO POLICIES</p>
        <h1>Privacy Policy</h1>
        <p className="legal-intro">
          This page describes the information Aurevo uses to provide account,
          shopping, order and customer-support features on this website.
        </p>

        <section>
          <h2>Information used on the store</h2>
          <p>
            Depending on the features you use, the store may process account
            details such as your name, email address, phone number and profile
            image; saved addresses; cart and wishlist contents; order items,
            delivery details and payment status; and messages submitted through
            the contact form.
          </p>
        </section>
        <section>
          <h2>How information is used</h2>
          <p>
            This information supports sign-in and account security, order
            placement and fulfilment, customer-requested returns and refunds,
            shopping features, and responses to customer enquiries.
          </p>
        </section>
        <section>
          <h2>Payments</h2>
          <p>
            The website records order and payment status for checkout and order
            history. Payment processing may involve the payment method or
            provider selected at checkout. Do not send full card or payment
            credentials through the contact form.
          </p>
        </section>
        <section>
          <h2>Access and questions</h2>
          <p>
            Use your account to review available profile, address, order,
            wishlist and wallet information. To ask a privacy question, visit
            <Link to="/contact"> Contact Us</Link> and include enough detail for
            us to understand your request.
          </p>
        </section>
        <section>
          <h2>Updates to this notice</h2>
          <p>
            This notice may be updated when store features or information
            practices change. Please review this page periodically.
          </p>
        </section>
        <p className="legal-note">
          This notice is a general description, not a complete legal privacy
          disclosure. Confirm your actual data practices, service providers,
          retention periods and local legal requirements before publishing it
          as a final policy.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

import { useState } from "react";
import api from "../api/axios";
import Icon from "../Components/Icon";
import SiteHeader from "../Components/SiteHeader";
import "../styles/contact.css";

const initialForm = {
  name: "",
  email: "",
  subject: "",
  message: "",
};

const FAQs = [
  {
    question: "How can I check my order status?",
    answer:
      "Open Orders from your account to see the latest order status, tracking ID when available, and delivery details.",
  },
  {
    question: "Can I cancel an order?",
    answer:
      "You can request cancellation online while an order is pending. If it has moved to another status, contact us with your order number.",
  },
  {
    question: "How do I request a return?",
    answer:
      "Open your delivered order in Orders and choose Return order. You will be asked to provide a reason for the request.",
  },
  {
    question: "Where can I see delivery information?",
    answer:
      "Your order details show the delivery date when available, along with a tracking ID when one has been added.",
  },
  {
    question: "What payment methods are available?",
    answer:
      "Available payment options are shown during checkout and may vary depending on your order and current payment configuration.",
  },
];

export default function Contact() {
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({
    type: "",
    message: "",
  });

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ type: "", message: "" });

    if (form.message.trim().length < 10) {
      setStatus({
        type: "error",
        message: "Please enter at least 10 characters in your message.",
      });
      return;
    }

    try {
      setLoading(true);

      await api.post("/contact/", {
        name: form.name.trim(),
        email: form.email.trim(),
        subject: form.subject.trim(),
        message: form.message.trim(),
      });

      setForm(initialForm);
      setStatus({
        type: "success",
        message: "Your message has been sent successfully!",
      });
    } catch (error) {
      const data = error.response?.data;
      let message = "Unable to send your message. Please try again.";

      if (data && typeof data === "object") {
        message =
          data.detail ||
          data.message ||
          Object.values(data).flat().join(" ") ||
          message;
      }

      setStatus({
        type: "error",
        message,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="contact-page">
      <section className="contact-heading">
        <p className="contact-eyebrow">WE'RE HERE FOR YOU</p>
        <h1>Let's talk.</h1>
        <p>
          Have a question about Aurevo, your order, or our products?
          Send us a message and we'll be happy to help.
        </p>
      </section>

      <section className="contact-layout">
        <aside className="contact-info">
          <p className="contact-eyebrow">GET IN TOUCH</p>
          <h2>We'd love to hear from you.</h2>

          <p>
            Send your question through the form. Please include your
            order number in your message if your enquiry is about an
            existing order.
          </p>

          <div className="contact-info-item">
            <span>01</span>
            <div>
              <h3>Product enquiries</h3>
              <p>Ask us about styles, sizes and availability.</p>
            </div>
          </div>

          <div className="contact-info-item">
            <span>02</span>
            <div>
              <h3>Order support</h3>
              <p>Contact us about an existing purchase.</p>
            </div>
          </div>

          <div className="contact-channels" aria-label="Other ways to contact us">
            <p className="contact-eyebrow">MORE WAYS TO REACH US</p>
            <a
              className="contact-channel"
              href="https://wa.me/919447276034"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="phone" size={18} />
              <span>
                <strong>WhatsApp</strong>
                <small>Chat with our team</small>
              </span>
              <span className="contact-channel-arrow" aria-hidden="true">↗</span>
            </a>
            <a
              className="contact-channel"
              href="https://mail.google.com/mail/?view=cm&fs=1&to=minhajmonu010%40gmail.com"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="mail" size={18} />
              <span>
                <strong>Email</strong>
                <small>minhajmonu010@gmail.com</small>
              </span>
              <span className="contact-channel-arrow" aria-hidden="true">↗</span>
            </a>
            <a
              className="contact-channel"
              href="https://www.instagram.com/minhaaa_jj/"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="camera" size={18} />
              <span>
                <strong>Instagram</strong>
                <small>@minhaaa_jj</small>
              </span>
              <span className="contact-channel-arrow" aria-hidden="true">↗</span>
            </a>
          </div>
        </aside>

        <form className="contact-form" onSubmit={handleSubmit}>
          <h2>Send us a message</h2>

          <div className="contact-form-row">
            <label>
              Full name
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Your name"
                maxLength={100}
                autoComplete="name"
                required
              />
            </label>

            <label>
              Email address
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
          </div>

          <label>
            Subject
            <input
              type="text"
              name="subject"
              value={form.subject}
              onChange={handleChange}
              placeholder="What can we help you with?"
              maxLength={150}
              required
            />
          </label>

          <label>
            Message
            <textarea
              name="message"
              value={form.message}
              onChange={handleChange}
              placeholder="Write your message here..."
              rows={6}
              minLength={10}
              required
            />
          </label>

          {status.message && (
            <p
              className={`contact-status ${status.type}`}
              role="status"
            >
              {status.message}
            </p>
          )}

          <button
            className="contact-submit"
            type="submit"
            disabled={loading}
          >
            {loading ? "Sending..." : "Send message"}
            {!loading && <span aria-hidden="true"> ↗</span>}
          </button>

          <p className="contact-privacy">
            Your details will be used to respond to your enquiry.
          </p>
        </form>
      </section>

      <section className="contact-faq" aria-labelledby="contact-faq-title">
        <div className="contact-faq-heading">
          <p className="contact-eyebrow">QUICK ANSWERS</p>
          <h2 id="contact-faq-title">Frequently asked questions</h2>
          <p>Find help with orders, returns, delivery, and payments.</p>
        </div>
        <div className="contact-faq-list">
          {FAQs.map((faq) => (
            <details className="contact-faq-item" key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
      </main>
    </>
  );
}
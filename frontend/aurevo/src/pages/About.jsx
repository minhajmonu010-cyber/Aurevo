import "../styles/about.css";
import SiteHeader from "../Components/SiteHeader";
import Icon from "../Components/Icon";

export default function About() {
  return (
    <>
      <SiteHeader />
      <main className="about-page">
        <section className="about-hero">
          <div className="about-hero-copy">
            <p className="about-eyebrow">STORY OF AUREVO</p>
            <h1>
              IT'S NOT JUST FASHION.
              <br />
              IT'S AN <em>IDENTITY.</em>
            </h1>
            <p className="about-intro">
              Aurevo is built for people who express themselves through
              what they wear. Discover everyday essentials with a modern,
              confident point of view.
            </p>
            <a
              className="about-instagram"
              href="https://www.instagram.com/minhaaa_jj/"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="camera" size={16} />
              Follow us on Instagram
              <span aria-hidden="true">↗</span>
            </a>
          </div>

          <figure className="about-hero-visual">
            <img src="/images/about.jpg" alt="Aurevo contemporary fashion collection" />
            <figcaption>AUREVO <span>EST. 2026</span></figcaption>
          </figure>
        </section>

        <section className="about-story">
          <div className="about-story-text">
            <p className="about-eyebrow">WHO WE ARE</p>
            <h2>Style that speaks for you.</h2>

            <p>
              We believe clothing is more than fabric. It is a way to
              express your personality, confidence and individuality.
            </p>

            <p>
              Aurevo brings together contemporary style, versatile
              clothing and a carefully considered shopping experience
              to help you find pieces that feel like you.
            </p>
          </div>

          <div className="about-story-panel">
            <span>Aurevo</span>
            <p>YOUR STYLE. YOUR STORY.</p>
          </div>
        </section>

        <section className="about-values">
          <p className="about-eyebrow">WHAT DEFINES US</p>
          <h2>More than what you wear.</h2>

          <div className="about-values-grid">
            <article className="about-value-card">
              <span>01</span>
              <h3>Individuality</h3>
              <p>
                Find styles that reflect your personality instead of
                following every trend.
              </p>
            </article>

            <article className="about-value-card">
              <span>02</span>
              <h3>Everyday Style</h3>
              <p>
                Explore versatile clothing for everyday moments and
                special occasions.
              </p>
            </article>

            <article className="about-value-card">
              <span>03</span>
              <h3>Customer First</h3>
              <p>
                Enjoy a straightforward shopping experience designed
                around your needs.
              </p>
            </article>
            <article className="about-value-card">
              <span>04</span>
              <h3>Fashion is a Passion</h3>
              <p>
                Every man can't wer costumes properly.But only some of 
                you can.
              </p>
            </article>
            <article className="about-value-card">
              <span>05</span>
              <h3>Fashion is Permanent</h3>
              <p>
                Your fashion is your identity to identify in a big 
                crowd
              </p>
            </article>
            <article className="about-value-card">
              <span>06</span>
              <h3>Priority</h3>
              <p>
                Our customer is our first priority.We are honourable
                to serve for you.
              </p>
            </article>
          </div>
        </section>
      </main>
    </>
  );
}
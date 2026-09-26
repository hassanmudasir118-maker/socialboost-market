import React, { useState } from "react";
import { Menu, X, ArrowUpRight, ShieldCheck, CheckCircle2, Megaphone, Handshake, Moon, Sun, Bell } from "lucide-react";
import { PLATFORM_ICONS, PLATFORM_LABELS, PLATFORM_COLORS } from "./shared";

export function Logo() {
  return (
    <div className="brand">
      <div className="brand-mark">S</div>
      SocialBoost Market
    </div>
  );
}

export function Nav({ onGo, session, onLogout, theme, onToggleTheme }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nav">
      <div className="wrap nav-inner">
        <a href="#" onClick={(e) => { e.preventDefault(); onGo("home"); }}><Logo /></a>
        <div className="nav-links">
          <a className="nav-link" href="#platforms" onClick={(e) => { e.preventDefault(); onGo("home"); }}>Platforms</a>
          <a className="nav-link" href="#how" onClick={(e) => { e.preventDefault(); onGo("home"); }}>How it works</a>
          <a className="nav-link" href="#roles" onClick={(e) => { e.preventDefault(); onGo("home"); }}>For advertisers &amp; creators</a>
          <a className="nav-link" href="#help" onClick={(e) => { e.preventDefault(); onGo("help"); }}>Help</a>
        </div>
        <div className="nav-actions">
          <button className="theme-btn desktop-only" onClick={onToggleTheme} title="Toggle theme">{theme === "light" ? <Moon size={15} /> : <Sun size={15} />}</button>
          {session ? (
            <>
              <button className="btn btn-ghost btn-sm desktop-only" onClick={() => onGo("dashboard")}>Dashboard</button>
              <button className="btn btn-primary btn-sm desktop-only" onClick={onLogout}>Log out</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm desktop-only" onClick={() => onGo("login")}>Log in</button>
              <button className="btn btn-primary btn-sm desktop-only" onClick={() => onGo("signup")}>Get started</button>
            </>
          )}
          <button className="nav-burger" onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>
      <div className={`mnav ${open ? "open" : ""}`}>
        <a href="#" onClick={() => { setOpen(false); onGo("help"); }}>Help</a>
        <button onClick={onToggleTheme}>{theme === "light" ? "Switch to dark mode" : "Switch to light mode"}</button>
        {session ? (
          <>
            <button onClick={() => { setOpen(false); onGo("dashboard"); }}>Dashboard</button>
            <button onClick={() => { setOpen(false); onLogout(); }}>Log out</button>
          </>
        ) : (
          <>
            <button onClick={() => { setOpen(false); onGo("login"); }}>Log in</button>
            <button onClick={() => { setOpen(false); onGo("signup"); }}>Get started</button>
          </>
        )}
      </div>
    </div>
  );
}

export function Homepage({ onGo }) {
  return (
    <>
      <section className="hero">
        <div className="hero-glow" />
        <div className="wrap">
          <div className="eyebrow-row">
            <span className="eyebrow-dot" />
            <span className="eyebrow-text">No fake followers. No bots. No purchased engagement — ever.</span>
          </div>
          <h1>Real creators. Real audiences. Promotion that actually moves the needle.</h1>
          <p className="hero-sub">
            SocialBoost Market connects advertisers with vetted creators on YouTube, TikTok, Instagram and Facebook
            for sponsored posts, shoutouts and collaborations — built on authentic reach, not manipulated metrics.
          </p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={() => onGo("signup", "ADVERTISER")}>
              Launch a campaign <ArrowUpRight size={16} />
            </button>
            <button className="btn btn-ghost" onClick={() => onGo("signup", "CREATOR")}>
              Apply as a creator
            </button>
          </div>

          <div className="platforms" id="platforms">
            {Object.entries(PLATFORM_ICONS).filter(([k]) => k !== "OTHER").map(([key, Icon]) => (
              <div className="plat-chip" key={key}>
                <Icon size={16} style={{ color: PLATFORM_COLORS[key] }} />
                {PLATFORM_LABELS[key]}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="trust">
        <div className="wrap">
          <div className="section-head">
            <div className="section-tag">Our standards</div>
            <h2>Authentic reach is the only kind we sell.</h2>
          </div>
          <div className="trust-banner">
            <ShieldCheck size={26} style={{ color: "#4ADE94", flexShrink: 0, marginTop: 2 }} />
            <div>
              <h3>Every creator on this platform is a real person with a real, organically-grown audience.</h3>
              <p>
                We prohibit fake followers, bots, artificial views or likes, and any form of engagement manipulation.
                Social account stats are self-reported until platform OAuth verification is connected — the interface
                clearly separates verified from self-reported data everywhere it appears.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <div className="section-tag">How it works</div>
            <h2>From brief to published post, in three steps.</h2>
          </div>
          <div className="steps">
            <div className="step-card">
              <div className="step-num mono">01</div>
              <h3>Post or browse</h3>
              <p>Advertisers publish a campaign brief with budget and goals. Creators browse open opportunities that fit their niche.</p>
            </div>
            <div className="step-card">
              <div className="step-num mono">02</div>
              <h3>Match and agree</h3>
              <p>Both sides review profiles and rates, then agree on deliverables before anything is produced.</p>
            </div>
            <div className="step-card">
              <div className="step-num mono">03</div>
              <h3>Publish and get paid</h3>
              <p>The creator submits proof of the published work; once approved, payment releases automatically.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="roles">
        <div className="wrap">
          <div className="section-head">
            <div className="section-tag">Built for both sides</div>
            <h2>Whichever side of the table you're on.</h2>
          </div>
          <div className="role-grid">
            <div className="role-card">
              <div className="role-icon" style={{ background: "var(--coral-dim)" }}><Megaphone size={20} style={{ color: "var(--coral)" }} /></div>
              <h3>For advertisers</h3>
              <p>Find creators, launch campaigns, and only pay out once you've approved the delivered work.</p>
              <div className="role-list">
                <div className="role-list-item"><CheckCircle2 size={15} style={{ color: "var(--mint)" }} /> Searchable creator directory</div>
                <div className="role-list-item"><CheckCircle2 size={15} style={{ color: "var(--mint)" }} /> Campaign briefs and applicant review</div>
                <div className="role-list-item"><CheckCircle2 size={15} style={{ color: "var(--mint)" }} /> Secure escrow-based payments</div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => onGo("signup", "ADVERTISER")}>
                Sign up as an advertiser
              </button>
            </div>
            <div className="role-card">
              <div className="role-icon" style={{ background: "var(--mint-dim)" }}><Handshake size={20} style={{ color: "var(--mint)" }} /></div>
              <h3>For creators</h3>
              <p>Get discovered, apply to paid collaborations, and build a verified track record of completed work.</p>
              <div className="role-list">
                <div className="role-list-item"><CheckCircle2 size={15} style={{ color: "var(--mint)" }} /> Open marketplace of paid opportunities</div>
                <div className="role-list-item"><CheckCircle2 size={15} style={{ color: "var(--mint)" }} /> Set your own rates</div>
                <div className="role-list-item"><CheckCircle2 size={15} style={{ color: "var(--mint)" }} /> Real wallet, real payouts, real withdrawal history</div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={() => onGo("signup", "CREATOR")}>
                Apply as a creator
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap" style={{ textAlign: "center" }}>
          <h2 style={{ marginBottom: 14 }}>Ready to build real reach?</h2>
          <p style={{ maxWidth: 480, margin: "0 auto 26px" }}>Join a marketplace where every follower, view and like is real — because that's the only kind that converts.</p>
          <button className="btn btn-primary" onClick={() => onGo("signup")}>Create your free account</button>
        </div>
      </section>
    </>
  );
}

export function Footer() {
  return (
    <div className="footer">
      <div className="wrap footer-row">
        <Logo />
        <p>© 2026 SocialBoost Market. Built for authentic creator promotion — no bots, no fake engagement.</p>
      </div>
    </div>
  );
}

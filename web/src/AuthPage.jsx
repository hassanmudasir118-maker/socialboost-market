import React, { useState, useEffect } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { api } from "./api";

export default function AuthPage({ mode, onGo, onAuth, presetRole }) {
  const isSignup = mode === "signup";
  const [role, setRole] = useState(presetRole || "ADVERTISER");
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", referralCode: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [devVerifyLink, setDevVerifyLink] = useState(null);

  useEffect(() => { if (presetRole) setRole(presetRole); }, [presetRole]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.email || !form.password || (isSignup && !form.name)) {
      setError("Please fill in all fields.");
      return;
    }
    if (isSignup && form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const result = isSignup
        ? await api.register({ name: form.name, email: form.email, password: form.password, role, referralCode: form.referralCode || null })
        : await api.login({ email: form.email, password: form.password });
      api.setTokens(result.accessToken, result.refreshToken);
      if (result.devVerifyLink) {
        setDevVerifyLink({ link: result.devVerifyLink, user: result.user });
        setLoading(false);
        return; // let them see the dev verification notice before entering the dashboard
      }
      onAuth(result.user);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }
    setLoading(false);
  };

  if (devVerifyLink) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-head">
            <h2>Check your email</h2>
            <p>We've sent a verification link to {form.email}. No email server is connected in this dev environment, so here's the link directly:</p>
          </div>
          <div className="field-hint" style={{ wordBreak: "break-all", background: "var(--bg-soft)", padding: 12, borderRadius: 8, marginBottom: 16 }}>
            <a href={devVerifyLink.link} style={{ color: "var(--coral)" }}>{devVerifyLink.link}</a>
          </div>
          <button className="btn btn-primary btn-full" onClick={() => onAuth({ ...devVerifyLink.user, name: form.name })}>Continue to dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <h2>{isSignup ? "Create your account" : "Welcome back"}</h2>
          <p>{isSignup ? "Join the marketplace for authentic social promotion." : "Log in to manage your campaigns or collaborations."}</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={submit}>
          {isSignup && (
            <div className="field">
              <label>I am signing up as a...</label>
              <div className="role-toggle">
                <button type="button" className={`role-opt ${role === "ADVERTISER" ? "active" : ""}`} onClick={() => setRole("ADVERTISER")}>
                  <h4>Advertiser</h4>
                  <p>Run promotion campaigns</p>
                </button>
                <button type="button" className={`role-opt ${role === "CREATOR" ? "active" : ""}`} onClick={() => setRole("CREATOR")}>
                  <h4>Creator</h4>
                  <p>Get paid collaborations</p>
                </button>
              </div>
            </div>
          )}

          {isSignup && (
            <div className="field">
              <label>Full name or brand name</label>
              <input type="text" placeholder="Jordan Rivera" value={form.name} onChange={set("name")} />
            </div>
          )}

          <div className="field">
            <label>Email address</label>
            <input type="email" placeholder="you@email.com" value={form.email} onChange={set("email")} />
          </div>

          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ marginBottom: 0 }}>Password</label>
              {!isSignup && <button type="button" onClick={() => onGo("forgot-password")} style={{ background: "none", border: "none", color: "var(--coral)", fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: 7 }}>Forgot password?</button>}
            </div>
            <div className="field-pass">
              <input type={showPass ? "text" : "password"} placeholder="At least 8 characters" value={form.password} onChange={set("password")} />
              <button type="button" onClick={() => setShowPass(!showPass)}>{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
          </div>

          {isSignup && (
            <div className="field">
              <label>Referral code (optional)</label>
              <input type="text" placeholder="e.g. MAYA482" value={form.referralCode} onChange={set("referralCode")} />
            </div>
          )}

          <button className="btn btn-primary btn-full" type="submit" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? "Please wait..." : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <div className="divider-note">
          <ShieldCheck size={14} /> Accounts are reviewed to keep engagement authentic — no bots, ever.
        </div>

        <div className="auth-switch">
          {isSignup ? (
            <>Already have an account? <button onClick={() => onGo("login")}>Log in</button></>
          ) : (
            <>New to SocialBoost Market? <button onClick={() => onGo("signup")}>Create an account</button></>
          )}
        </div>
      </div>
    </div>
  );
}

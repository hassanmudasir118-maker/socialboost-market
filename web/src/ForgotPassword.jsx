import React, { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "./api";

export default function ForgotPassword({ onGo }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email) { setError("Enter your email address."); return; }
    setLoading(true);
    try {
      const res = await api.forgotPassword(email);
      setSent(true);
      if (res.devResetLink) setDevLink(res.devResetLink);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    }
    setLoading(false);
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <h2>Reset your password</h2>
          <p>Enter your account email and we'll send you a reset link.</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {sent ? (
          <>
            <div className="divider-note" style={{ marginTop: 0, marginBottom: 16 }}>
              <ShieldCheck size={14} /> If an account with that email exists, a reset link has been sent.
            </div>
            {devLink && (
              <div className="field-hint" style={{ wordBreak: "break-all", background: "var(--bg-soft)", padding: 12, borderRadius: 8, marginBottom: 16 }}>
                Dev mode (no email server connected): <a href={devLink} style={{ color: "var(--coral)" }}>{devLink}</a>
              </div>
            )}
            <button className="btn btn-ghost btn-full" onClick={() => onGo("login")}>Back to login</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label>Email address</label>
              <input type="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>{loading ? "Sending..." : "Send reset link"}</button>
          </form>
        )}

        <div className="auth-switch">
          Remembered your password? <button onClick={() => onGo("login")}>Log in</button>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "./api";

export default function ResetPassword({ onGo, token }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!token) { setError("This reset link is missing its token. Please request a new one."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message || "This reset link is invalid or has expired.");
    }
    setLoading(false);
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <h2>Set a new password</h2>
          <p>Choose a new password for your account.</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {done ? (
          <>
            <div className="field-hint" style={{ color: "var(--mint)", marginBottom: 16 }}>
              Your password has been reset. All existing sessions have been logged out for security — please log in again.
            </div>
            <button className="btn btn-primary btn-full" onClick={() => onGo("login")}>Go to login</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label>New password</label>
              <div className="field-pass">
                <input type={showPass ? "text" : "password"} placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setShowPass(!showPass)}>{showPass ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input type={showPass ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>{loading ? "Resetting..." : "Reset password"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

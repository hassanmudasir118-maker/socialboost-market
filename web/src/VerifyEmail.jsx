import React, { useState, useEffect } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { api } from "./api";

export default function VerifyEmail({ onGo, token, session, onVerified }) {
  const [status, setStatus] = useState("verifying"); // verifying | success | error
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      if (!token) { setStatus("error"); setError("This verification link is missing its token."); return; }
      try {
        await api.confirmEmailVerification(token);
        setStatus("success");
        if (session) await onVerified();
      } catch (err) {
        setStatus("error");
        setError(err.message || "This verification link is invalid or has expired.");
      }
    })();
  }, [token]);

  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ textAlign: "center" }}>
        {status === "verifying" && <p>Verifying your email…</p>}
        {status === "success" && (
          <>
            <CheckCircle2 size={40} style={{ color: "var(--mint)", marginBottom: 14 }} />
            <h2 style={{ marginBottom: 8 }}>Email verified</h2>
            <p style={{ marginBottom: 20 }}>Your email address has been confirmed.</p>
            <button className="btn btn-primary btn-full" onClick={() => onGo(session ? "dashboard" : "login")}>{session ? "Go to dashboard" : "Go to login"}</button>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle size={40} style={{ color: "#FF7A6E", marginBottom: 14 }} />
            <h2 style={{ marginBottom: 8 }}>Verification failed</h2>
            <p style={{ marginBottom: 20 }}>{error}</p>
            <button className="btn btn-ghost btn-full" onClick={() => onGo("login")}>Back to login</button>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import { api } from "./api";
import { Nav, Homepage, Footer } from "./Marketing";
import AuthPage from "./AuthPage";
import ForgotPassword from "./ForgotPassword";
import ResetPassword from "./ResetPassword";
import VerifyEmail from "./VerifyEmail";
import Dashboard from "./Dashboard";
import HelpCenter from "./HelpCenter";
import "./styles.css";

// Reads a token-carrying link the user landed on directly (e.g. from an
// emailed reset/verify link) before any other routing state is decided.
function initialRouteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname;
  if (path.startsWith("/reset-password") && params.get("token")) return { page: "reset-password", token: params.get("token") };
  if (path.startsWith("/verify-email") && params.get("token")) return { page: "verify-email", token: params.get("token") };
  // Landed here from the backend's OAuth callback redirect (see
  // routes/socialAccounts.js) — jump straight to Account settings and show
  // the connect result there.
  if (path.startsWith("/settings") && params.get("social")) {
    return {
      page: "dashboard",
      socialCallback: { status: params.get("social"), platform: params.get("platform"), message: params.get("message") },
    };
  }
  // Landed here from Stripe Connect's onboarding return/refresh redirect
  // (see stripeConnectService.js) — jump to the Earnings tab, where
  // PayoutSetupCard re-checks status fresh on mount. Stripe's redirect
  // carries no completion status itself (see that file's comments on why),
  // so there's nothing more to read from these params.
  if (path.startsWith("/dashboard") && params.get("tab")) {
    return { page: "dashboard", initialTab: params.get("tab") };
  }
  return { page: "home", token: null };
}

export default function App() {
  const initial = initialRouteFromUrl();
  const [page, setPage] = useState(initial.page);
  const [urlToken] = useState(initial.token);
  const [socialCallback, setSocialCallback] = useState(initial.socialCallback || null);
  const [initialTab] = useState(initial.initialTab || null);
  const [presetRole, setPresetRole] = useState(null);
  const [session, setSession] = useState(null);
  const [booted, setBooted] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("sbm_theme") || "dark");

  const loadSession = async () => {
    if (!api.getAccessToken()) return null;
    try {
      const { user, profile } = await api.me();
      const s = { ...user, name: profile?.displayName || user.email };
      setSession(s);
      return s;
    } catch (_) {
      api.clearTokens();
      return null;
    }
  };

  useEffect(() => {
    (async () => { await loadSession(); setBooted(true); })();
    // Strip the OAuth callback / Stripe Connect return query params from the
    // URL bar once captured, so a page refresh doesn't re-trigger them.
    if (initial.socialCallback || initial.initialTab) window.history.replaceState({}, "", "/");
  }, []);

  const goTo = (p, role) => {
    setPage(p);
    if (role) setPresetRole(role);
    if (p !== "signup") setPresetRole(null);
    window.scrollTo(0, 0);
    window.history.replaceState({}, "", "/");
  };

  const handleAuth = (user) => {
    setSession(user);
    setPage("dashboard");
  };

  const handleLogout = async () => {
    await api.logout();
    setSession(null);
    setPage("home");
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("sbm_theme", next);
  };

  if (!booted) {
    return <div className="sbm" data-theme={theme} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }} />;
  }
  // Protected route guard: dashboard is only reachable with a real, server-verified session.
  if (page === "dashboard" && !session) setPage("login");

  return (
    <div className="sbm" data-theme={theme}>
      {page !== "dashboard" && <Nav onGo={goTo} session={session} onLogout={handleLogout} theme={theme} onToggleTheme={toggleTheme} />}
      {page === "home" && <Homepage onGo={goTo} />}
      {page === "help" && <HelpCenter onGo={goTo} />}
      {page === "login" && <AuthPage mode="login" onGo={goTo} onAuth={handleAuth} />}
      {page === "signup" && <AuthPage mode="signup" onGo={goTo} onAuth={handleAuth} presetRole={presetRole} />}
      {page === "forgot-password" && <ForgotPassword onGo={goTo} />}
      {page === "reset-password" && <ResetPassword onGo={goTo} token={urlToken} />}
      {page === "verify-email" && <VerifyEmail onGo={goTo} token={urlToken} session={session} onVerified={loadSession} />}
      {page === "dashboard" && session && (
        <Dashboard
          session={session}
          onGo={goTo}
          onLogout={handleLogout}
          onSessionRefresh={loadSession}
          initialTab={socialCallback ? "__account" : initialTab || undefined}
          socialCallback={socialCallback}
          onConsumeSocialCallback={() => setSocialCallback(null)}
        />
      )}
      {page !== "dashboard" && <Footer />}
    </div>
  );
}

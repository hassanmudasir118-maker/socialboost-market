import React, { useState, useEffect } from "react";
import { BadgeCheck, ShieldCheck, ShieldAlert, Trash2, Plus, Monitor, RefreshCw, Link2, Unlink, AlertTriangle } from "lucide-react";
import { api } from "./api";
import { PLATFORM_ICONS, PLATFORM_LABELS, PLATFORM_COLORS } from "./shared";

function ProfileSection({ account, onSaved }) {
  const [form, setForm] = useState({
    displayName: account.profile?.displayName || "",
    username: account.profile?.username || "",
    bio: account.profile?.bio || "",
    avatarUrl: account.profile?.avatarUrl || "",
    country: account.profile?.country || "",
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setError(""); setSaved(false);
    try {
      await api.updateMyProfile(form);
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message || "Failed to save profile");
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head"><h3>Profile</h3></div>
      <div className="panel-body" style={{ padding: "18px 20px" }}>
        {error && <div className="auth-error">{error}</div>}
        {saved && <div className="field-hint" style={{ color: "var(--mint)", marginBottom: 12 }}>Profile saved.</div>}
        <div className="field-row">
          <div className="field"><label>Full name</label><input type="text" value={form.displayName} onChange={set("displayName")} /></div>
          <div className="field"><label>Username</label><input type="text" placeholder="e.g. maya_chen" value={form.username} onChange={set("username")} /></div>
        </div>
        <div className="field"><label>Profile image URL</label><input type="text" placeholder="https://..." value={form.avatarUrl} onChange={set("avatarUrl")} /></div>
        <div className="field"><label>Country</label><input type="text" value={form.country} onChange={set("country")} /></div>
        <div className="field"><label>Bio</label><textarea value={form.bio} onChange={set("bio")} /></div>
        <button className="btn btn-primary" onClick={save}>Save profile</button>
      </div>
    </div>
  );
}

function SecuritySection({ onLogout }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [sessions, setSessions] = useState([]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const loadSessions = () => api.mySessions().then((r) => setSessions(r.sessions));
  useEffect(() => { loadSessions(); }, []);

  const changePassword = async () => {
    setError(""); setSaved(false);
    if (form.newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (form.newPassword !== form.confirm) { setError("Passwords don't match."); return; }
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      setSaved(true);
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err) {
      setError(err.message || "Failed to change password");
    }
  };

  const logoutEverywhere = async () => {
    await api.logoutAllSessions();
    onLogout();
  };

  return (
    <>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h3>Change password</h3></div>
        <div className="panel-body" style={{ padding: "18px 20px" }}>
          {error && <div className="auth-error">{error}</div>}
          {saved && <div className="field-hint" style={{ color: "var(--mint)", marginBottom: 12 }}>Password changed.</div>}
          <div className="field"><label>Current password</label><input type="password" value={form.currentPassword} onChange={set("currentPassword")} /></div>
          <div className="field-row">
            <div className="field"><label>New password</label><input type="password" value={form.newPassword} onChange={set("newPassword")} /></div>
            <div className="field"><label>Confirm new password</label><input type="password" value={form.confirm} onChange={set("confirm")} /></div>
          </div>
          <button className="btn btn-primary" onClick={changePassword}>Update password</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Active sessions</h3>
          <button className="btn btn-ghost btn-sm" onClick={logoutEverywhere}>Log out everywhere</button>
        </div>
        <div className="panel-body">
          {sessions.length === 0 ? <div className="empty">No session history yet.</div> : sessions.map((s) => (
            <div className="row" key={s.id}>
              <div className="row-left">
                <div className="row-icon" style={{ background: "var(--surface-2)" }}><Monitor size={15} style={{ color: "var(--text-dim)" }} /></div>
                <div>
                  <div className="row-title">{(s.user_agent || "Unknown device").slice(0, 60)}</div>
                  <div className="row-sub">Last active {new Date(s.last_used_at).toLocaleString()}</div>
                </div>
              </div>
              <span className={`badge ${s.revoked_at ? "badge-muted" : "badge-mint"}`}>{s.revoked_at ? "Ended" : "Active"}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function VerificationSection({ account, onRefresh }) {
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);

  const resend = async () => {
    const res = await api.requestEmailVerification();
    setSent(true);
    if (res.devVerifyLink) setDevLink(res.devVerifyLink);
  };

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head"><h3>Verification &amp; account status</h3></div>
      <div className="panel-body" style={{ padding: "18px 20px" }}>
        <div className="toggle-row">
          <div>
            <div className="tlabel">Email verification</div>
            <div className="tdesc">{account.user.email}</div>
          </div>
          {account.user.emailVerified ? (
            <span className="badge badge-mint"><BadgeCheck size={12} style={{ display: "inline", marginRight: 4 }} />Verified</span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={resend}>Resend verification</button>
          )}
        </div>
        {sent && <div className="field-hint" style={{ color: "var(--mint)", marginTop: 10 }}>Verification email sent.</div>}
        {devLink && <div className="field-hint" style={{ wordBreak: "break-all", marginTop: 6 }}>Dev link: <a href={devLink} style={{ color: "var(--coral)" }}>{devLink}</a></div>}

        <div className="toggle-row">
          <div><div className="tlabel">Account status</div></div>
          <span className={`badge ${account.user.accountStatus === "ACTIVE" ? "badge-mint" : "badge-red"}`}>{account.user.accountStatus}</span>
        </div>
        {account.profile && (
          <div className="toggle-row">
            <div><div className="tlabel">Creator verification badge</div><div className="tdesc">Set by an administrator after review — not automatic.</div></div>
            <span className={`badge ${account.profile.verified ? "badge-mint" : "badge-muted"}`}>{account.profile.verified ? "Verified" : "Not verified"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const OAUTH_PLATFORMS = ["YOUTUBE", "TIKTOK", "INSTAGRAM", "FACEBOOK"];
const STATUS_BADGE = {
  VERIFIED: "badge-mint", CONNECTED: "badge-blue", CONNECTING: "badge-gold",
  EXPIRED: "badge-red", REVOKED: "badge-muted", ERROR: "badge-red", NOT_CONNECTED: "badge-muted",
};
const STATUS_LABEL = {
  VERIFIED: "Verified", CONNECTED: "Connected", CONNECTING: "Connecting…",
  EXPIRED: "Expired — reconnect", REVOKED: "Not connected", ERROR: "Error", NOT_CONNECTED: "Not connected",
};

function ConnectedPlatformsSection({ socialCallback, onConsumeSocialCallback }) {
  const [connections, setConnections] = useState(null);
  const [busyPlatform, setBusyPlatform] = useState(null);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);

  const load = () => api.listSocialConnections().then((r) => setConnections(r.socialAccounts));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!socialCallback) return;
    if (socialCallback.status === "connected") {
      setBanner({ kind: "success", text: `${PLATFORM_LABELS[socialCallback.platform] || socialCallback.platform} connected and verified.` });
      load();
    } else if (socialCallback.status === "error") {
      setBanner({ kind: "error", text: socialCallback.message || `Failed to connect ${PLATFORM_LABELS[socialCallback.platform] || socialCallback.platform}.` });
    }
    if (onConsumeSocialCallback) onConsumeSocialCallback();
  }, [socialCallback]);

  const connectionFor = (platform) => (connections || []).find((c) => c.platform === platform && c.connectedVia === "OAUTH" && c.verificationStatus !== "REVOKED");

  const connect = async (platform) => {
    setErrors({ ...errors, [platform]: "" });
    setBusyPlatform(platform);
    try {
      const res = await api.connectSocialAccount(platform);
      window.location.href = res.authorizationUrl; // full-page navigation — OAuth has to leave the SPA
    } catch (err) {
      setErrors({ ...errors, [platform]: err.message || "Could not start connection" });
      setBusyPlatform(null);
    }
  };

  const sync = async (connection) => {
    setBusyPlatform(connection.platform);
    setErrors({ ...errors, [connection.platform]: "" });
    try {
      await api.syncSocialAccount(connection.id);
      await load();
    } catch (err) {
      setErrors({ ...errors, [connection.platform]: err.message || "Sync failed" });
    } finally {
      setBusyPlatform(null);
    }
  };

  const disconnect = async (connection) => {
    if (!window.confirm(`Disconnect ${PLATFORM_LABELS[connection.platform]}? You can reconnect it at any time.`)) return;
    setBusyPlatform(connection.platform);
    try {
      await api.disconnectSocialAccount(connection.id);
      await load();
    } catch (err) {
      setErrors({ ...errors, [connection.platform]: err.message || "Failed to disconnect" });
    } finally {
      setBusyPlatform(null);
    }
  };

  if (!connections) return <div className="panel"><div className="panel-body"><div className="empty">Loading connections…</div></div></div>;

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head"><h3>Connected platforms</h3></div>
      <div className="panel-body" style={{ padding: "18px 20px" }}>
        <div className="divider-note" style={{ marginTop: 0, marginBottom: 16 }}>
          <ShieldCheck size={14} /> Connecting a platform uses its official sign-in — SocialBoost never sees or stores your password, and follower/engagement numbers shown here come directly from the platform, not from you.
        </div>
        {banner && (
          <div className="field-hint" style={{ color: banner.kind === "success" ? "var(--mint)" : "var(--coral)", marginBottom: 14 }}>
            {banner.text}
          </div>
        )}
        {OAUTH_PLATFORMS.map((platform) => {
          const Icon = PLATFORM_ICONS[platform];
          const connection = connectionFor(platform);
          const status = connection?.verificationStatus || "NOT_CONNECTED";
          const canConnect = !connection || status === "EXPIRED" || status === "REVOKED" || status === "ERROR";
          const isBusy = busyPlatform === platform;
          return (
            <div className="row" key={platform} style={{ alignItems: "flex-start" }}>
              <div className="row-left">
                <div className="row-icon" style={{ background: "var(--surface-2)" }}><Icon size={17} style={{ color: PLATFORM_COLORS[platform] }} /></div>
                <div>
                  <div className="row-title">
                    {PLATFORM_LABELS[platform]}
                    {status === "VERIFIED" && <BadgeCheck size={13} style={{ display: "inline", marginLeft: 6, color: "var(--mint)", verticalAlign: -2 }} />}
                  </div>
                  <div className="row-sub">
                    {connection?.username ? `@${connection.username} · ` : ""}
                    {status === "VERIFIED" && connection.followerCount != null && `${connection.followerCount.toLocaleString()} followers (verified)`}
                    {status === "VERIFIED" && connection.followerCount == null && "Metrics unavailable"}
                    {status !== "VERIFIED" && STATUS_LABEL[status]}
                  </div>
                  <div className="row-sub" style={{ opacity: 0.7 }}>
                    {connection?.lastSyncedAt ? `Last synced: ${new Date(connection.lastSyncedAt).toLocaleString()}` : (connection ? "Not yet synced" : "")}
                  </div>
                  {errors[platform] && (
                    <div className="field-hint" style={{ color: "var(--coral)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={12} /> {errors[platform]}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={`badge ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
                {connection && status === "VERIFIED" && (
                  <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => sync(connection)} title="Sync now">
                    <RefreshCw size={14} />
                  </button>
                )}
                {connection && status !== "NOT_CONNECTED" && (
                  <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => disconnect(connection)} title="Disconnect">
                    <Unlink size={14} />
                  </button>
                )}
                {canConnect && (
                  <button className="btn btn-primary btn-sm" disabled={isBusy} onClick={() => connect(platform)}>
                    <Link2 size={14} /> {isBusy ? "Connecting…" : connection ? "Reconnect" : "Connect"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SocialAccountsSection({ account, onRefresh }) {
  const [form, setForm] = useState({ platform: "YOUTUBE", handle: "", profileUrl: "", followers: "", engagementRate: "" });
  const [error, setError] = useState("");

  const add = async () => {
    setError("");
    if (!form.handle || !form.profileUrl) { setError("Enter a handle and profile URL."); return; }
    try {
      await api.addSocialAccount({
        platform: form.platform, handle: form.handle, profileUrl: form.profileUrl,
        followers: Number(form.followers) || 0, engagementRate: Number(form.engagementRate) || 0,
      });
      setForm({ platform: "YOUTUBE", handle: "", profileUrl: "", followers: "", engagementRate: "" });
      onRefresh();
    } catch (err) {
      setError(err.message || "Failed to add account");
    }
  };
  const remove = async (id) => { await api.removeSocialAccount(id); onRefresh(); };

  return (
    <div className="panel">
      <div className="panel-head"><h3>Add an unverified account</h3></div>
      <div className="panel-body" style={{ padding: "18px 20px" }}>
        <div className="divider-note" style={{ marginTop: 0, marginBottom: 16 }}>
          <ShieldAlert size={14} /> For platforms not listed above, or as a placeholder before connecting: numbers you enter here are self-reported and are never shown as verified, and cannot be used to meet a campaign's verified-follower requirements.
        </div>
        {(account.socialAccounts || []).map((s) => {
          const Icon = PLATFORM_ICONS[s.platform];
          return (
            <div className="row" key={s.id}>
              <div className="row-left">
                <div className="row-icon" style={{ background: "var(--surface-2)" }}><Icon size={17} style={{ color: PLATFORM_COLORS[s.platform] }} /></div>
                <div>
                  <div className="row-title">{s.handle} · {PLATFORM_LABELS[s.platform]}</div>
                  <div className="row-sub">{s.followers.toLocaleString()} followers (self-reported) · {s.engagementRate}% engagement</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="badge badge-muted">{s.verifiedAt ? "Verified" : "Self-reported"}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(s.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border-soft)", paddingTop: 16 }}>
          {error && <div className="auth-error">{error}</div>}
          <div className="field-row">
            <div className="field">
              <label>Platform</label>
              <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {Object.keys(PLATFORM_ICONS).filter((p) => p !== "OTHER").map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
              </select>
            </div>
            <div className="field"><label>Handle</label><input type="text" placeholder="@yourhandle" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} /></div>
          </div>
          <div className="field"><label>Profile URL</label><input type="text" placeholder="https://..." value={form.profileUrl} onChange={(e) => setForm({ ...form, profileUrl: e.target.value })} /></div>
          <div className="field-row">
            <div className="field"><label>Followers (self-reported)</label><input type="number" value={form.followers} onChange={(e) => setForm({ ...form, followers: e.target.value })} /></div>
            <div className="field"><label>Engagement rate % (self-reported)</label><input type="number" value={form.engagementRate} onChange={(e) => setForm({ ...form, engagementRate: e.target.value })} /></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={add}><Plus size={14} /> Add account</button>
        </div>
      </div>
    </div>
  );
}

export default function AccountSettings({ session, onLogout, onSessionRefresh, socialCallback, onConsumeSocialCallback }) {
  const [account, setAccount] = useState(null);
  const [tab, setTab] = useState(socialCallback ? "social" : "profile");

  const load = () => api.myAccount().then(setAccount);
  useEffect(() => { load(); }, []);

  const refreshAll = async () => { await load(); if (onSessionRefresh) await onSessionRefresh(); };

  if (!account) return <div className="empty">Loading account…</div>;

  return (
    <>
      <div className="tabs-row">
        <button className={`tab-btn ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>Profile</button>
        <button className={`tab-btn ${tab === "verification" ? "active" : ""}`} onClick={() => setTab("verification")}>Verification</button>
        {session.role === "CREATOR" && <button className={`tab-btn ${tab === "social" ? "active" : ""}`} onClick={() => setTab("social")}>Social platforms</button>}
        <button className={`tab-btn ${tab === "security" ? "active" : ""}`} onClick={() => setTab("security")}>Security</button>
      </div>

      {tab === "profile" && <ProfileSection account={account} onSaved={refreshAll} />}
      {tab === "verification" && <VerificationSection account={account} onRefresh={refreshAll} />}
      {tab === "social" && session.role === "CREATOR" && (
        <>
          <ConnectedPlatformsSection socialCallback={socialCallback} onConsumeSocialCallback={onConsumeSocialCallback} />
          <SocialAccountsSection account={account} onRefresh={refreshAll} />
        </>
      )}
      {tab === "security" && <SecuritySection onLogout={onLogout} />}

      {account.campaignHistory && (
        <div className="kpi-mini-row" style={{ marginTop: 20 }}>
          {session.role === "CREATOR" ? (
            <>
              <div className="kpi-mini"><div className="v">{account.campaignHistory.totalApplications}</div><div className="l">Total applications</div></div>
              <div className="kpi-mini"><div className="v">{account.campaignHistory.completedCampaigns}</div><div className="l">Completed campaigns</div></div>
              <div className="kpi-mini"><div className="v mono">${account.wallet.totalEarned.toFixed(2)}</div><div className="l">Verified earnings</div></div>
            </>
          ) : (
            <>
              <div className="kpi-mini"><div className="v">{account.campaignHistory.totalCampaigns}</div><div className="l">Total campaigns</div></div>
              <div className="kpi-mini"><div className="v">{account.campaignHistory.completedCampaigns}</div><div className="l">Completed campaigns</div></div>
            </>
          )}
        </div>
      )}
    </>
  );
}

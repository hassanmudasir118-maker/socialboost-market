import React, { useState, useEffect } from "react";
import { LayoutGrid, Search, Handshake, Wallet, Users, Megaphone, Download, Flag, BarChart3, Settings, History, LogOut, Bell, UserCog, Banknote } from "lucide-react";
import { api } from "./api";
import { initials } from "./shared";
import AdvertiserDashboard from "./AdvertiserDashboard";
import CreatorDashboard from "./CreatorDashboard";
import AdminDashboard from "./AdminDashboard";
import Marketplace from "./Marketplace";
import AccountSettings from "./AccountSettings";

const NAV_CONFIG = {
  ADVERTISER: [
    { key: "campaigns", label: "Campaigns", icon: Megaphone },
    { key: "marketplace", label: "Find creators", icon: Search },
    { key: "wallet", label: "Wallet", icon: Wallet },
  ],
  CREATOR: [
    { key: "opportunities", label: "Opportunities", icon: Search },
    { key: "collabs", label: "My collaborations", icon: Handshake },
    { key: "earnings", label: "Earnings", icon: Wallet },
  ],
  ADMIN: [
    { key: "overview", label: "Overview", icon: LayoutGrid },
    { key: "users", label: "Users", icon: Users },
    { key: "campaigns", label: "Campaigns", icon: Megaphone },
    { key: "withdrawals", label: "Withdrawals", icon: Download },
    { key: "manual-payments", label: "Manual payments", icon: Banknote },
    { key: "disputes", label: "Disputes", icon: Flag },
    { key: "analytics", label: "Analytics", icon: BarChart3 },
    { key: "settings", label: "Settings", icon: Settings },
    { key: "activity", label: "Activity log", icon: History },
  ],
};
const ROLE_LABEL = { ADVERTISER: "Advertiser", CREATOR: "Creator", ADMIN: "Admin" };
const DEFAULT_TAB = { ADVERTISER: "campaigns", CREATOR: "opportunities", ADMIN: "overview" };

function NotificationBell() {
  const [notifs, setNotifs] = useState([]);
  const [open, setOpen] = useState(false);

  const load = () => api.getNotifications().then((r) => setNotifs(r.notifications));
  useEffect(() => { load(); }, []);
  const unread = notifs.filter((n) => !n.read).length;

  const toggle = async () => {
    if (!open && unread > 0) { await api.markNotificationsRead(); load(); }
    setOpen(!open);
  };

  return (
    <div className="notif-wrap">
      <button className="notif-btn" onClick={toggle}>
        <Bell size={18} />
        {unread > 0 && <span className="notif-dot" />}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-head">Notifications</div>
          {notifs.length === 0 ? <div className="notif-item"><div className="nbody">No notifications yet.</div></div> : notifs.slice(0, 20).map((n) => (
            <div className={`notif-item ${!n.read ? "unread" : ""}`} key={n.id}>
              <div className="ntitle">{n.title}</div>
              <div className="nbody">{n.body}</div>
              <div className="ndate">{new Date(n.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ session, onGo, onLogout, onSessionRefresh, initialTab, socialCallback, onConsumeSocialCallback }) {
  const nav = NAV_CONFIG[session.role] || NAV_CONFIG.ADVERTISER;
  const [tab, setTab] = useState(initialTab || DEFAULT_TAB[session.role]);

  return (
    <div className="dash">
      <div className="sidebar">
        <div className="side-brand"><div className="brand-mark">S</div> SocialBoost</div>
        <div className="side-section">{ROLE_LABEL[session.role]}</div>
        {nav.map((n) => (
          <button key={n.key} className={`side-link ${tab === n.key ? "active" : ""}`} onClick={() => setTab(n.key)}>
            <n.icon size={17} /> {n.label}
          </button>
        ))}
        <div className="side-foot">
          <button className={`side-link ${tab === "__account" ? "active" : ""}`} onClick={() => setTab("__account")}><UserCog size={17} /> Account settings</button>
          <button className="side-link" onClick={() => onGo("home")}><LayoutGrid size={17} /> Back to site</button>
          <button className="side-link" onClick={onLogout}><LogOut size={17} /> Log out</button>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div className="topbar-title">{tab === "__account" ? "Account settings" : (nav.find((n) => n.key === tab)?.label || "Overview")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <NotificationBell />
            <div className="avatar">{initials(session.name || session.email)}</div>
          </div>
        </div>
        <div className="dash-content">
          {tab === "__account" && <AccountSettings session={session} onLogout={onLogout} onSessionRefresh={onSessionRefresh} socialCallback={socialCallback} onConsumeSocialCallback={onConsumeSocialCallback} />}
          {tab !== "__account" && session.role === "ADVERTISER" && tab === "marketplace" && <Marketplace />}
          {tab !== "__account" && session.role === "ADVERTISER" && tab !== "marketplace" && <AdvertiserDashboard tab={tab} />}
          {tab !== "__account" && session.role === "CREATOR" && <CreatorDashboard tab={tab} />}
          {tab !== "__account" && session.role === "ADMIN" && <AdminDashboard tab={tab} />}
        </div>
      </div>

      <div className="mbar">
        {nav.map((n) => (
          <button key={n.key} className={`mbar-btn ${tab === n.key ? "active" : ""}`} onClick={() => setTab(n.key)}>
            <n.icon size={19} /> {n.label}
          </button>
        ))}
      </div>
    </div>
  );
}

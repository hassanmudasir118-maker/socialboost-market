import React from "react";
import { FileText, CreditCard, Wallet, PlayCircle, Clock, Send, Eye, CheckCheck, Ban, AlertTriangle, Hash } from "lucide-react";

const YoutubeIcon = ({ size = 18, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
    <path d="M22 12s0-3.2-.4-4.7a3 3 0 0 0-2.1-2.1C17.9 4.8 12 4.8 12 4.8s-5.9 0-7.5.4A3 3 0 0 0 2.4 7.3C2 8.8 2 12 2 12s0 3.2.4 4.7a3 3 0 0 0 2.1 2.1c1.6.4 7.5.4 7.5.4s5.9 0 7.5-.4a3 3 0 0 0 2.1-2.1C22 15.2 22 12 22 12z" stroke="currentColor" strokeWidth="1.6" fill="none" />
    <path d="M10 9.5l5 2.5-5 2.5v-5z" fill="currentColor" />
  </svg>
);
const InstagramIcon = ({ size = 18, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
  </svg>
);
const FacebookIcon = ({ size = 18, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
    <path d="M14 22v-8h2.7l.4-3.1H14V9c0-.9.3-1.5 1.6-1.5H17V4.7C16.7 4.7 15.7 4.6 14.6 4.6c-2.3 0-3.9 1.4-3.9 4V11H8v3.1h2.7V22h3.3z" fill="currentColor" />
  </svg>
);
const TikTokIcon = ({ size = 18, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
    <path
      d="M16.6 5.82c-.9-.8-1.47-1.94-1.53-3.22h-3.1v13.53a2.6 2.6 0 1 1-1.83-2.48V10.5a5.9 5.9 0 1 0 4.93 5.82V9.4a7.4 7.4 0 0 0 4.33 1.39V7.6a4.4 4.4 0 0 1-2.8-1.78z"
      fill="currentColor"
    />
  </svg>
);

export const PLATFORM_ICONS = { YOUTUBE: YoutubeIcon, TIKTOK: TikTokIcon, INSTAGRAM: InstagramIcon, FACEBOOK: FacebookIcon, OTHER: Hash };
export const PLATFORM_LABELS = { YOUTUBE: "YouTube", TIKTOK: "TikTok", INSTAGRAM: "Instagram", FACEBOOK: "Facebook", OTHER: "Other" };
export const PLATFORM_COLORS = { YOUTUBE: "#FF4A4A", TIKTOK: "#F3F5F7", INSTAGRAM: "#E1478A", FACEBOOK: "#4A8CFF", OTHER: "#8B93F8" };

export const CAMPAIGN_STATUS_BADGE = {
  DRAFT: "badge-muted", PENDING_PAYMENT: "badge-gold", FUNDED: "badge-blue", PUBLISHED: "badge-mint",
  IN_PROGRESS: "badge-violet", SUBMITTED: "badge-gold", UNDER_REVIEW: "badge-violet",
  COMPLETED: "badge-blue", CANCELLED: "badge-red", DISPUTED: "badge-red",
};
export const CAMPAIGN_STATUS_ICON = {
  DRAFT: FileText, PENDING_PAYMENT: CreditCard, FUNDED: Wallet, PUBLISHED: PlayCircle,
  IN_PROGRESS: Clock, SUBMITTED: Send, UNDER_REVIEW: Eye,
  COMPLETED: CheckCheck, CANCELLED: Ban, DISPUTED: AlertTriangle,
};
export const CAMPAIGN_STATUS_LABEL = {
  DRAFT: "Draft", PENDING_PAYMENT: "Pending Payment", FUNDED: "Funded", PUBLISHED: "Published",
  IN_PROGRESS: "In Progress", SUBMITTED: "Submitted", UNDER_REVIEW: "Under Review",
  COMPLETED: "Completed", CANCELLED: "Cancelled", DISPUTED: "Disputed",
};

export function StatusBadge({ status }) {
  const Icon = CAMPAIGN_STATUS_ICON[status] || FileText;
  return (
    <span className={`badge ${CAMPAIGN_STATUS_BADGE[status] || "badge-muted"}`} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <Icon size={11} /> {CAMPAIGN_STATUS_LABEL[status] || status}
    </span>
  );
}

export function fmt(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function initials(name) {
  return (name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

export function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

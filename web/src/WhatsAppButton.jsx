import React from "react";

// Floating "Chat with us on WhatsApp" button, shown on every page.
// Opens a WhatsApp chat (web or app, whichever the visitor has) with the
// platform's support number and a pre-filled greeting message.
const SUPPORT_NUMBER = "923423360668"; // 0342-3360668 in international format (no leading 0, country code 92)
const DEFAULT_MESSAGE = "Hi, I need help with SocialBoost Market.";

export default function WhatsAppButton() {
  const href = `https://wa.me/${SUPPORT_NUMBER}?text=${encodeURIComponent(DEFAULT_MESSAGE)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      title="Need help? Chat with us on WhatsApp"
      style={{
        position: "fixed",
        bottom: "22px",
        right: "22px",
        zIndex: 9999,
        width: "58px",
        height: "58px",
        borderRadius: "50%",
        background: "#25D366",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
        textDecoration: "none",
      }}
    >
      <svg viewBox="0 0 32 32" width="30" height="30" fill="#fff" aria-hidden="true">
        <path d="M16.004 3C9.377 3 4 8.373 4 15c0 2.49.76 4.8 2.06 6.72L4.5 28.5l6.95-1.82A11.9 11.9 0 0 0 16.004 27C22.63 27 28 21.63 28 15S22.63 3 16.004 3Zm0 21.6c-1.98 0-3.83-.55-5.4-1.5l-.39-.23-4.12 1.08 1.1-4.02-.25-.41A9.56 9.56 0 0 1 5.4 15c0-5.3 4.3-9.6 9.6-9.6s9.6 4.3 9.6 9.6-4.3 9.6-9.6 9.6Zm5.27-7.19c-.29-.14-1.71-.84-1.97-.94-.26-.1-.46-.14-.65.14-.19.29-.75.94-.92 1.13-.17.19-.34.22-.63.07-.29-.14-1.21-.45-2.3-1.42-.85-.76-1.42-1.69-1.59-1.98-.17-.29-.02-.44.12-.59.13-.13.29-.34.43-.5.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.5-.07-.14-.65-1.57-.89-2.15-.23-.56-.47-.49-.65-.49-.17-.01-.36-.01-.56-.01-.19 0-.5.07-.77.36-.26.29-1 .98-1 2.39 0 1.41 1.03 2.77 1.17 2.96.14.19 2.03 3.1 4.93 4.35.69.3 1.22.48 1.64.61.69.22 1.32.19 1.81.11.55-.08 1.71-.7 1.95-1.37.24-.68.24-1.26.17-1.38-.07-.12-.26-.19-.55-.33Z" />
      </svg>
    </a>
  );
}

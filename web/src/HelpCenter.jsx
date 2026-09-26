import React, { useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-item">
      <button className="faq-q" onClick={() => setOpen(!open)}>{q} <ChevronRight size={16} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0 }} /></button>
      {open && <div className="faq-a">{a}</div>}
    </div>
  );
}

export default function HelpCenter({ onGo }) {
  const faqs = [
    { q: "How does escrow work for campaigns?", a: "When you fund a campaign, the amount is debited from your wallet and held by the platform until you approve the creator's submitted proof of work. Funds are only released after approval, or after a dispute is resolved in the creator's favor." },
    { q: "How is platform commission calculated?", a: "A percentage set by the marketplace is deducted from each creator payout when their proof is approved. The rate is locked in at the moment your campaign is funded." },
    { q: "How do I fund my wallet?", a: "Wallet top-ups via a real payment provider aren't connected yet in this build — see the README for the integration point. For now, an admin can credit a wallet as a stand-in." },
    { q: "What happens if I disagree with a submission?", a: "You can request changes directly, or open a dispute if you can't reach an agreement. Our admin team reviews disputes and decides whether funds are released to the creator or refunded to the advertiser." },
    { q: "How long do withdrawals take?", a: "Withdrawal requests are held (debited from your balance) and reviewed by our team before final approval. If rejected, the funds are automatically returned to your balance." },
    { q: "Do you allow fake followers or bots?", a: "No — never. Social account stats are self-reported until platform OAuth verification is connected, and the interface always distinguishes verified from self-reported data." },
  ];
  return (
    <div className="section">
      <div className="wrap" style={{ maxWidth: 720 }}>
        <button className="back-link" onClick={() => onGo("home")}><ChevronLeft size={15} /> Back to home</button>
        <h2 style={{ fontSize: 30, marginBottom: 8 }}>Help Center</h2>
        <p style={{ marginBottom: 30 }}>Answers to common questions about campaigns, payments, and account management.</p>
        <div className="panel">
          <div className="panel-body" style={{ padding: "4px 20px" }}>
            {faqs.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
        <div className="trust-banner" style={{ marginTop: 24 }}>
          <MessageSquare size={22} style={{ color: "var(--mint)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <h3>Still need help?</h3>
            <p>Reach out through in-app messaging on any active collaboration.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

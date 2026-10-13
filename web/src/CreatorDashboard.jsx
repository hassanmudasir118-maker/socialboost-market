import React, { useState, useEffect } from "react";
import { Upload, Flag, MessageSquare, Star, Download, Wallet as WalletIcon, Search, RotateCcw, Banknote, ShieldCheck, AlertTriangle } from "lucide-react";
import { api } from "./api";
import { PLATFORM_ICONS, PLATFORM_LABELS, PLATFORM_COLORS, StatusBadge, fmt, fmtDate } from "./shared";

const CATEGORIES = ["Tech", "Beauty", "Fitness", "Lifestyle", "Finance", "Travel", "Gaming", "Comedy", "Fashion", "Food", "Outdoor", "Other"];

function MarketplaceModule() {
  const [campaigns, setCampaigns] = useState([]);
  const [filters, setFilters] = useState({ platform: "", category: "", country: "", minBudget: "", maxBudget: "", campaignType: "", q: "", sort: "newest" });
  const [applyingId, setApplyingId] = useState(null);
  const [form, setForm] = useState({ message: "", proposedRate: "", estimatedCompletionDays: "", relevantExperience: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => { setLoading(true); const r = await api.marketplace(filters); setCampaigns(r.campaigns); setLoading(false); };
  useEffect(() => { load(); }, []);

  const setF = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const reset = () => setFilters({ platform: "", category: "", country: "", minBudget: "", maxBudget: "", campaignType: "", q: "", sort: "newest" });

  const submit = async (c) => {
    setError("");
    if (!form.proposedRate || Number(form.proposedRate) <= 0) { setError("Enter your proposed rate."); return; }
    if (!form.message.trim()) { setError("Write a short pitch message."); return; }
    try {
      await api.applyToCampaign(c.id, {
        message: form.message.trim(), proposedRate: Number(form.proposedRate),
        estimatedCompletionDays: form.estimatedCompletionDays ? Number(form.estimatedCompletionDays) : null,
        relevantExperience: form.relevantExperience || null,
      });
      setApplyingId(null); setForm({ message: "", proposedRate: "", estimatedCompletionDays: "", relevantExperience: "" });
      load();
    } catch (err) { setError(err.message || "Failed to apply"); }
  };

  return (
    <>
      <div className="filters-panel">
        <div className="field">
          <label>Platform</label>
          <select value={filters.platform} onChange={setF("platform")}>
            <option value="">All</option>
            {Object.keys(PLATFORM_ICONS).filter((p) => p !== "OTHER").map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="field"><label>Category</label><select value={filters.category} onChange={setF("category")}><option value="">All</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="field"><label>Country</label><input type="text" placeholder="Any" value={filters.country} onChange={setF("country")} /></div>
        <div className="field"><label>Min. budget (Rs)</label><input type="number" placeholder="Any" value={filters.minBudget} onChange={setF("minBudget")} /></div>
        <div className="field"><label>Max. budget (Rs)</label><input type="number" placeholder="Any" value={filters.maxBudget} onChange={setF("maxBudget")} /></div>
        <div className="field">
          <label>Sort</label>
          <select value={filters.sort} onChange={setF("sort")}>
            <option value="newest">Newest first</option>
            <option value="budget_desc">Highest budget</option>
            <option value="budget_asc">Lowest budget</option>
            <option value="deadline">Deadline soonest</option>
          </select>
        </div>
        <div className="field"><label>Search</label><input type="text" placeholder="Title or description" value={filters.q} onChange={setF("q")} /></div>
        <div className="field" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={load}><Search size={14} /> Search</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { reset(); }}><RotateCcw size={14} /></button>
        </div>
      </div>

      <div className="results-count">{campaigns.length} open campaign{campaigns.length !== 1 ? "s" : ""}</div>

      {loading ? <div className="empty">Loading…</div> : campaigns.length === 0 ? (
        <div className="panel"><div className="empty">No open campaigns match your filters right now.</div></div>
      ) : (
        <div className="creator-grid">
          {campaigns.map((c) => {
            const Icon = PLATFORM_ICONS[c.platform];
            return (
              <div className="creator-mini" key={c.id} style={{ cursor: "default" }}>
                <div className="cm-avatar-row">
                  <div className="row-icon" style={{ background: "var(--surface-2)" }}><Icon size={17} style={{ color: PLATFORM_COLORS[c.platform] }} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="cm-name-row">{c.title}</div>
                    <div className="cm-sub">{c.advertiserName} · {c.category}</div>
                  </div>
                </div>
                {c.requirementsList?.length > 0 && <div className="cm-tags">{c.requirementsList.slice(0, 3).map((r, i) => <span className="cm-tag" key={i}>{r}</span>)}</div>}
                <div className="cm-stats">
                  <div className="cm-stat"><div className="v mono">{fmt(c.budgetPerCreator)}</div><div className="l">Per creator</div></div>
                  <div className="cm-stat"><div className="v">{c.slotsRemaining}</div><div className="l">Slots left</div></div>
                  <div className="cm-stat"><div className="v">{fmtDate(c.endDate)}</div><div className="l">Deadline</div></div>
                </div>
                <div style={{ marginTop: 14 }}>
                  {c.alreadyApplied ? <span className="badge badge-mint">Applied</span> : (
                    <button className="btn btn-ghost btn-sm btn-full" onClick={() => setApplyingId(applyingId === c.id ? null : c.id)}>{applyingId === c.id ? "Cancel" : "Apply"}</button>
                  )}
                </div>
                {applyingId === c.id && (
                  <div style={{ marginTop: 12 }}>
                    {error && <div className="auth-error">{error}</div>}
                    <div className="field"><label>Your proposed rate (USD)</label><input type="number" min="1" value={form.proposedRate} onChange={(e) => setForm({ ...form, proposedRate: e.target.value })} /></div>
                    <div className="field"><label>Estimated completion (days)</label><input type="number" min="1" value={form.estimatedCompletionDays} onChange={(e) => setForm({ ...form, estimatedCompletionDays: e.target.value })} /></div>
                    <div className="field"><label>Relevant experience</label><input type="text" value={form.relevantExperience} onChange={(e) => setForm({ ...form, relevantExperience: e.target.value })} /></div>
                    <div className="field"><label>Pitch message</label><textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
                    <button className="btn btn-primary btn-sm btn-full" onClick={() => submit(c)}>Submit application</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function CollabCard({ item, onRefresh }) {
  const { campaign, application, assignment, deliverable } = item;
  const [form, setForm] = useState({ contentUrl: "", promotionUrl: "", notes: "" });
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState("");
  const [showMsg, setShowMsg] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewSent, setReviewSent] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");

  const Icon = PLATFORM_ICONS[campaign.platform];
  const latestVersion = deliverable?.versions?.[0];

  useEffect(() => { api.getMessages(application.id).then((r) => setMessages(r.messages)).catch(() => {}); }, [application.id]);

  const submitDeliverable = async () => { await api.submitDeliverable(assignment.id, form); onRefresh(); };
  const submitMessage = async () => {
    if (!msgText.trim()) return;
    const m = await api.sendMessage(application.id, msgText.trim());
    setMessages([...messages, m]); setMsgText("");
  };
  const submitReview = async () => { await api.submitReview(application.id, { rating, text: reviewText }); setReviewSent(true); };
  const submitDispute = async () => { await api.openAssignmentDispute(assignment.id, disputeReason); setShowDispute(false); onRefresh(); };

  return (
    <div className="app-card">
      <div className="app-card-top">
        <div style={{ display: "flex", gap: 12 }}>
          <div className="row-icon" style={{ background: "var(--surface-2)" }}><Icon size={17} style={{ color: PLATFORM_COLORS[campaign.platform] }} /></div>
          <div><div className="row-title">{campaign.title}</div><div className="row-sub">Agreed {fmt(assignment.agreedRate)}</div></div>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      <div className="review-block" style={{ marginTop: 14 }}>
        <h4>Deliverable {deliverable ? `(v${deliverable.currentVersion})` : ""}</h4>
        {!deliverable || deliverable.status === "REVISION_REQUESTED" ? (
          <>
            {deliverable?.reviewNote && <div className="field-hint" style={{ marginBottom: 10, color: "var(--gold)" }}>Advertiser requested: {deliverable.reviewNote}</div>}
            <div className="field-row">
              <div className="field"><label>Content URL</label><input type="text" value={form.contentUrl} onChange={(e) => setForm({ ...form, contentUrl: e.target.value })} /></div>
              <div className="field"><label>Promotion URL</label><input type="text" value={form.promotionUrl} onChange={(e) => setForm({ ...form, promotionUrl: e.target.value })} /></div>
            </div>
            <div className="field"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <button className="btn btn-primary btn-sm" onClick={submitDeliverable}>{deliverable ? "Resubmit" : "Submit deliverable"}</button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 8 }}><span className="badge badge-muted">{deliverable.status.replace("_", " ")}</span></div>
            {latestVersion?.contentUrl && <div className="val dim" style={{ wordBreak: "break-all" }}>Content: {latestVersion.contentUrl}</div>}
            {latestVersion?.notes && <div className="val dim">{latestVersion.notes}</div>}
            {["SUBMITTED", "UNDER_REVIEW"].includes(deliverable.status) && !showDispute && (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setShowDispute(true)}><Flag size={14} /> Open dispute</button>
            )}
            {showDispute && (
              <div style={{ marginTop: 10 }}>
                <div className="field"><textarea placeholder="Describe the issue..." value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} /></div>
                <button className="btn btn-reject btn-sm" onClick={submitDispute}>Submit dispute</button>
              </div>
            )}
          </>
        )}
      </div>

      {deliverable && deliverable.status === "APPROVED" && !reviewSent && (
        <div className="review-block">
          <h4>Rate this advertiser</h4>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} style={{ background: "none", border: "none", padding: 0 }}><Star size={20} fill={n <= rating ? "var(--gold)" : "none"} style={{ color: "var(--gold)" }} /></button>)}
          </div>
          <div className="field" style={{ marginBottom: 8 }}><textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} /></div>
          <button className="btn btn-primary btn-sm" onClick={submitReview}>Submit review</button>
        </div>
      )}
      {deliverable && deliverable.status === "APPROVED" && reviewSent && <div className="field-hint">✓ Review submitted.</div>}

      <div className="review-block">
        <div style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setShowMsg(!showMsg)}>
          <h4 style={{ marginBottom: 0 }}>Messages ({messages.length})</h4><MessageSquare size={15} style={{ color: "var(--text-faint)" }} />
        </div>
        {showMsg && (
          <>
            <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 12 }}>
              {messages.map((m) => <div key={m.id} style={{ marginBottom: 10 }}><div style={{ display: "inline-block", background: "var(--surface-2)", padding: "8px 12px", borderRadius: 10, fontSize: 13 }}>{m.text}</div></div>)}
            </div>
            <div className="field" style={{ display: "flex", gap: 8, marginTop: 10, marginBottom: 0 }}>
              <input type="text" value={msgText} onChange={(e) => setMsgText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitMessage(); }} />
              <button className="btn btn-primary btn-sm" onClick={submitMessage}>Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CollabsModule() {
  const [applications, setApplications] = useState([]);
  const [filter, setFilter] = useState("ACCEPTED");
  const [loading, setLoading] = useState(true);

  const load = async () => { const r = await api.myApplications(); setApplications(r.applications); setLoading(false); };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="empty">Loading collaborations…</div>;
  const filtered = applications.filter((a) => a.status === filter);

  return (
    <>
      <div className="chip-row" style={{ marginBottom: 18 }}>
        {["ACCEPTED", "PENDING", "REJECTED", "WITHDRAWN"].map((s) => (
          <div key={s} className={`filter-chip ${filter === s ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={() => setFilter(s)}>
            {s[0] + s.slice(1).toLowerCase()} ({applications.filter((a) => a.status === s).length})
          </div>
        ))}
      </div>
      {filtered.length === 0 ? <div className="panel"><div className="empty">No {filter.toLowerCase()} collaborations yet.</div></div> :
        filter === "ACCEPTED" ? filtered.map((a) => <CollabCard key={a.id} item={{ campaign: a.campaign, application: a, assignment: a.assignment, deliverable: a.deliverable }} onRefresh={load} />) : (
          <div className="panel"><div className="panel-body">
            {filtered.map((a) => (
              <div className="row" key={a.id}>
                <div><div className="row-title">{a.campaign.title}</div><div className="row-sub">Proposed {fmt(a.proposedRate)}</div></div>
                <span className={`badge ${filter === "PENDING" ? "badge-gold" : "badge-muted"}`}>{filter === "PENDING" ? "Pending" : filter === "WITHDRAWN" ? "Withdrawn" : "Not selected"}</span>
              </div>
            ))}
          </div></div>
        )}
    </>
  );
}

function PayoutSetupCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => api.getPayoutStatus().then(setStatus).catch(() => setStatus({ connected: false, payoutsEnabled: false }));
  useEffect(() => { load(); }, []);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const { url } = await api.beginPayoutOnboarding();
      window.location.href = url; // full-page navigation to Stripe's hosted onboarding
    } catch (err) {
      setError(err.message || "Could not start payout setup");
      setBusy(false);
    }
  };

  if (!status) return null;
  if (status.payoutsEnabled) {
    return (
      <div className="divider-note" style={{ marginBottom: 16, color: "var(--mint)" }}>
        <ShieldCheck size={14} /> Payouts are set up — withdrawals go straight to your bank via Stripe.
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-body" style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <Banknote size={16} /> {status.connected ? "Finish setting up payouts" : "Set up payouts"}
          </div>
          <div className="row-sub" style={{ marginTop: 4 }}>
            {status.connected
              ? "Your payout account needs a bit more information from Stripe before it can pay you."
              : "Withdrawals can't be sent to your bank until you complete a quick, secure setup with Stripe."}
          </div>
          {error && (
            <div className="field-hint" style={{ color: "var(--coral)", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
              <AlertTriangle size={12} /> {error}
            </div>
          )}
        </div>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={start}>
          {busy ? "Redirecting…" : status.connected ? "Finish setup" : "Set up payouts"}
        </button>
      </div>
    </div>
  );
}

function EarningsModule() {
  const [wallet, setWallet] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const load = async () => { const [w, wd] = await Promise.all([api.getWallet(), api.myWithdrawals()]); setWallet(w.wallet); setLedger(w.ledger); setWithdrawals(wd.withdrawals); };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    setError("");
    try { await api.requestWithdrawal(Number(amount)); setAmount(""); setOpen(false); load(); }
    catch (err) { setError(err.message || "Failed to request withdrawal"); }
  };

  if (!wallet) return <div className="empty">Loading earnings…</div>;

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-val">{fmt(wallet.balance)}</div><div className="stat-lbl">Available balance</div></div>
        <div className="stat-card"><div className="stat-val">{fmt(wallet.totalEarned)}</div><div className="stat-lbl">Total earnings</div></div>
      </div>
      <PayoutSetupCard />
      <div className="withdraw-box">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Withdraw funds</div>
          {!open && <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><Download size={14} /> Withdraw</button>}
        </div>
        {open && (
          <>
            {error && <div className="auth-error" style={{ marginTop: 14 }}>{error}</div>}
            <div className="withdraw-form">
              <div className="field"><label>Amount (USD)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <button className="btn btn-primary btn-sm" onClick={submit}>Confirm</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </>
        )}
      </div>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h3>Withdrawal history</h3></div>
        <div className="panel-body">
          {withdrawals.length === 0 ? <div className="empty">No withdrawals yet.</div> : withdrawals.map((w) => (
            <div className="row" key={w.id}>
              <div><div className="row-title">{fmt(w.amount)} withdrawal</div><div className="row-sub">Fee {fmt(w.fee)} · Net {fmt(w.net)}</div></div>
              <span className={`badge ${w.status === "APPROVED" ? "badge-mint" : w.status === "REJECTED" ? "badge-red" : "badge-gold"}`}>{w.status}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Ledger</h3></div>
        <div className="panel-body">
          {ledger.length === 0 ? <div className="empty">No activity yet. Complete a campaign to see payouts here.</div> : ledger.map((l) => (
            <div className="row" key={l.id}>
              <div><div className="row-title">{l.reason.replaceAll("_", " ")}</div><div className="row-sub">{new Date(l.createdAt).toLocaleString()}</div></div>
              <div className="mono" style={{ color: l.direction === "CREDIT" ? "var(--mint)" : "var(--text-dim)" }}>{l.direction === "CREDIT" ? "+" : "-"}{fmt(l.amount)}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function CreatorDashboard({ tab }) {
  if (tab === "opportunities") return <MarketplaceModule />;
  if (tab === "collabs") return <CollabsModule />;
  if (tab === "earnings") return <EarningsModule />;
  return <MarketplaceModule />;
}

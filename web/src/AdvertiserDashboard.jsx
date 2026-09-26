import React, { useState, useEffect } from "react";
import {
  Plus, ChevronLeft, CreditCard, Percent, CheckCircle2, XCircle,
  AlertCircle, Flag, Eye, MessageSquare, Star, Wallet as WalletIcon, TrendingUp, Handshake,
  Send, Ban, Trash2, Info,
} from "lucide-react";
import { api } from "./api";
import { PLATFORM_ICONS, PLATFORM_LABELS, PLATFORM_COLORS, StatusBadge, fmt, fmtDate, initials } from "./shared";

const CAMPAIGN_TYPES = [
  { key: "sponsored_post", label: "Sponsored post" },
  { key: "dedicated_video", label: "Dedicated video" },
  { key: "shoutout", label: "Shoutout / mention" },
  { key: "story_feature", label: "Story feature" },
  { key: "product_review", label: "Product review" },
  { key: "brand_ambassador", label: "Brand ambassadorship" },
];
const CATEGORIES = ["Tech", "Beauty", "Fitness", "Lifestyle", "Finance", "Travel", "Gaming", "Comedy", "Fashion", "Food", "Outdoor", "Other"];

function CampaignForm({ existing, onCancel, onSaved }) {
  const [form, setForm] = useState({
    title: existing?.title || "", description: existing?.description || "",
    platform: existing?.platform || "YOUTUBE", contentUrl: existing?.contentUrl || "",
    category: existing?.category || CATEGORIES[0], campaignType: existing?.campaignType || "sponsored_post",
    requirements: existing?.requirements || "", eligibilityRequirements: existing?.eligibilityRequirements || "",
    targetCountry: existing?.targetCountry || "", budget: existing?.budget || "", budgetPerCreator: existing?.budgetPerCreator || "",
    maxCreators: existing?.maxCreators || 3,
    startDate: existing?.startDate ? existing.startDate.slice(0, 10) : "",
    endDate: existing?.endDate ? existing.endDate.slice(0, 10) : "",
  });
  const [reqList, setReqList] = useState(existing?.requirementsList || []);
  const [reqInput, setReqInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const addReq = () => { if (reqInput.trim()) { setReqList([...reqList, reqInput.trim()]); setReqInput(""); } };
  const removeReq = (i) => setReqList(reqList.filter((_, idx) => idx !== i));

  const buildPayload = () => ({
    title: form.title, description: form.description, platform: form.platform, contentUrl: form.contentUrl,
    category: form.category, campaignType: form.campaignType, requirements: form.requirements,
    eligibilityRequirements: form.eligibilityRequirements || null, requirementsList: reqList,
    targetCountry: form.targetCountry || null, budget: Number(form.budget), budgetPerCreator: Number(form.budgetPerCreator),
    maxCreators: Number(form.maxCreators), startDate: new Date(form.startDate).toISOString(), endDate: new Date(form.endDate).toISOString(),
  });

  const submit = async (doSubmit) => {
    setError("");
    if (!form.title || !form.description || !form.contentUrl || !form.requirements || !form.budget || !form.budgetPerCreator || !form.startDate || !form.endDate) {
      setError("Please fill in all required fields.");
      return;
    }
    setBusy(true);
    try {
      if (existing) await api.updateCampaign(existing.id, { ...buildPayload(), submit: doSubmit });
      else await api.createCampaign({ ...buildPayload(), submit: doSubmit });
      onSaved();
    } catch (err) {
      setError(err.message || "Failed to save campaign");
    }
    setBusy(false);
  };

  return (
    <div>
      <button className="back-link" onClick={onCancel}><ChevronLeft size={15} /> Back to campaigns</button>
      <div className="wizard-card">
        <div className="wizard-title">{existing ? "Edit campaign" : "New campaign"}</div>
        <p className="wizard-hint">Drafts can be edited freely. Submitting moves it to Pending Payment.</p>
        {error && <div className="auth-error">{error}</div>}

        <div className="field"><label>Campaign title</label><input type="text" placeholder="e.g. Autumn Product Launch" value={form.title} onChange={set("title")} /></div>
        <div className="field"><label>Description</label><textarea placeholder="What is this campaign about?" value={form.description} onChange={set("description")} /></div>

        <div className="field">
          <label>Platform</label>
          <div className="platform-grid">
            {Object.entries(PLATFORM_ICONS).filter(([k]) => k !== "OTHER").map(([key, Icon]) => (
              <button type="button" key={key} className={`platform-opt ${form.platform === key ? "active" : ""}`} onClick={() => setForm({ ...form, platform: key })}>
                <Icon size={20} style={{ color: form.platform === key ? PLATFORM_COLORS[key] : "currentColor" }} />
                {PLATFORM_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="field"><label>Content URL</label><input type="text" placeholder="https://..." value={form.contentUrl} onChange={set("contentUrl")} /></div>

        <div className="field-row">
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="field">
            <label>Campaign type</label>
            <select value={form.campaignType} onChange={set("campaignType")}>{CAMPAIGN_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          </div>
        </div>

        <div className="field"><label>Requirements (description)</label><textarea placeholder="Deliverables, talking points, disclosure requirements..." value={form.requirements} onChange={set("requirements")} /></div>

        <div className="field">
          <label>Itemized requirements checklist</label>
          <div className="chip-input">
            <input type="text" placeholder="e.g. Tag @brand in caption" value={reqInput} onChange={(e) => setReqInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addReq(); } }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addReq}><Plus size={14} /> Add</button>
          </div>
          <div className="tag-row">
            {reqList.map((r, i) => <span className="tag" key={i}>{r} <button onClick={() => removeReq(i)}><XCircle size={11} /></button></span>)}
          </div>
        </div>

        <div className="field"><label>Creator eligibility requirements</label><textarea placeholder="e.g. Must have 10k+ subscribers, must post publicly..." value={form.eligibilityRequirements} onChange={set("eligibilityRequirements")} /></div>
        <div className="field"><label>Target country</label><input type="text" placeholder="e.g. United States" value={form.targetCountry} onChange={set("targetCountry")} /></div>

        <div className="field-row">
          <div className="field"><label>Total budget (USD)</label><input type="number" min="1" value={form.budget} onChange={set("budget")} /></div>
          <div className="field"><label>Budget per creator (USD)</label><input type="number" min="1" value={form.budgetPerCreator} onChange={set("budgetPerCreator")} /></div>
        </div>
        <div className="field"><label>Number of creators required</label><input type="number" min="1" value={form.maxCreators} onChange={set("maxCreators")} /></div>

        <div className="field-row">
          <div className="field"><label>Start date</label><input type="date" value={form.startDate} onChange={set("startDate")} /></div>
          <div className="field"><label>End date / deadline</label><input type="date" value={form.endDate} onChange={set("endDate")} /></div>
        </div>

        <div className="wizard-nav">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" disabled={busy} onClick={() => submit(false)}>Save as draft</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>Submit for payment</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentBox({ campaign, onFunded }) {
  const [promo, setPromo] = useState("");
  const [showPromo, setShowPromo] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState(null);

  const startCheckout = async () => {
    setBusy(true); setError("");
    try {
      const result = await api.checkout(campaign.id, promo.trim() || null);
      setPayment(result.payment);
    } catch (err) { setError(err.message || "Failed to start checkout"); }
    setBusy(false);
  };

  const confirm = async (outcome) => {
    setBusy(true); setError("");
    try {
      await api.simulatePayment(payment.id, outcome);
      onFunded();
    } catch (err) { setError(err.message || "Payment confirmation failed"); }
    setBusy(false);
  };

  if (payment) {
    return (
      <div className="payment-box" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <div className="msg">
          <CreditCard size={20} style={{ color: "var(--gold)" }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>Complete your payment</div>
            <p style={{ fontSize: 13 }}>{fmt(payment.amount)} · Test mode — no real card form is connected yet. Simulate the provider's response below.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => confirm("succeeded")} disabled={busy}>Simulate successful payment</button>
          <button className="btn btn-ghost btn-sm" onClick={() => confirm("failed")} disabled={busy}>Simulate declined card</button>
        </div>
        {error && <div className="auth-error" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="payment-box" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 14, width: "100%" }}>
        <div className="msg">
          <CreditCard size={20} style={{ color: "var(--gold)" }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>Payment required</div>
            <p style={{ fontSize: 13 }}>Fund your budget of {fmt(campaign.budget)} via the payment provider.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPromo(!showPromo)}><Percent size={14} /> Promo code</button>
          <button className="btn btn-primary btn-sm" onClick={startCheckout} disabled={busy}><CreditCard size={14} /> {busy ? "Starting…" : "Proceed to checkout"}</button>
        </div>
      </div>
      {showPromo && <div className="field" style={{ marginTop: 14, marginBottom: 0, maxWidth: 280 }}><label>Promo code</label><input type="text" value={promo} onChange={(e) => setPromo(e.target.value)} /></div>}
      {error && <div className="auth-error" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}

function PublishBox({ campaign, onPublished }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const publish = async () => {
    setBusy(true); setError("");
    try { const r = await api.publishCampaign(campaign.id); onPublished(r.campaign); }
    catch (err) { setError(err.message || "Failed to publish"); }
    setBusy(false);
  };
  return (
    <div className="payment-box">
      <div className="msg"><Send size={20} style={{ color: "var(--mint)" }} /><div><div style={{ fontWeight: 600, fontSize: 14.5 }}>Ready to publish</div><p style={{ fontSize: 13 }}>Your campaign is funded. Publish it to the marketplace so creators can apply.</p></div></div>
      <button className="btn btn-primary btn-sm" onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish to marketplace"}</button>
      {error && <div className="auth-error" style={{ marginTop: 12, width: "100%" }}>{error}</div>}
    </div>
  );
}

function ApplicationCard({ app, campaign, canAcceptMore, onDecide, onRequestInfo, onCancelAssignment, onReviewProof, onRefresh }) {
  const [showInfoBox, setShowInfoBox] = useState(false);
  const [infoNote, setInfoNote] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [showNoteFor, setShowNoteFor] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState("");
  const [showMsg, setShowMsg] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewSent, setReviewSent] = useState(false);

  const assignment = app.assignment;
  const deliverable = app.deliverable;
  const latestVersion = deliverable?.versions?.[0];

  useEffect(() => {
    if (app.status === "ACCEPTED") api.getMessages(app.id).then((r) => setMessages(r.messages)).catch(() => {});
  }, [app.id, app.status]);

  const submitMessage = async () => {
    if (!msgText.trim()) return;
    const m = await api.sendMessage(app.id, msgText.trim());
    setMessages([...messages, m]);
    setMsgText("");
  };
  const submitReview = async () => { await api.submitReview(app.id, { rating, text: reviewText }); setReviewSent(true); };

  return (
    <div className="app-card">
      <div className="app-card-top">
        <div style={{ display: "flex", gap: 12 }}>
          <div className="avatar" style={{ width: 38, height: 38, fontSize: 13 }}>{initials(app.creatorName)}</div>
          <div>
            <div className="row-title">{app.creatorName}</div>
            <div className="row-sub">proposed {fmt(app.proposedRate)}{app.estimatedCompletionDays ? ` · ~${app.estimatedCompletionDays}d` : ""}</div>
          </div>
        </div>
        {app.status === "PENDING" ? <span className="badge badge-gold">Pending</span> : app.status === "ACCEPTED" ? <span className="badge badge-mint">Accepted</span> : app.status === "WITHDRAWN" ? <span className="badge badge-muted">Withdrawn</span> : <span className="badge badge-red">Rejected</span>}
      </div>
      <div className="app-msg">{app.message}</div>
      {app.relevantExperience && <div className="field-hint" style={{ marginTop: 8 }}>Experience: {app.relevantExperience}</div>}
      {app.infoRequestedAt && <div className="field-hint" style={{ marginTop: 8, color: "var(--gold)" }}>Info requested: {app.infoRequestedNote}</div>}

      {app.status === "PENDING" && (
        <>
          <div className="app-actions">
            <button className="btn btn-sm btn-accept" disabled={!canAcceptMore} onClick={() => onDecide(app.id, "ACCEPTED")}><CheckCircle2 size={14} /> Accept</button>
            <button className="btn btn-sm btn-reject" onClick={() => onDecide(app.id, "REJECTED")}><XCircle size={14} /> Reject</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInfoBox(!showInfoBox)}><Info size={14} /> Request info</button>
          </div>
          {showInfoBox && (
            <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
              <textarea placeholder="What else do you need to know?" value={infoNote} onChange={(e) => setInfoNote(e.target.value)} />
              <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => { onRequestInfo(app.id, infoNote); setShowInfoBox(false); setInfoNote(""); }}>Send request</button>
            </div>
          )}
          {!canAcceptMore && <div className="field-hint" style={{ marginTop: 8 }}>All creator slots are filled.</div>}
        </>
      )}

      {app.status === "ACCEPTED" && assignment && (
        <>
          {assignment.status === "ACTIVE" && !deliverable && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => onCancelAssignment(assignment.id)}><Ban size={14} /> Cancel acceptance</button>
          )}
          <div className="review-block" style={{ marginTop: 14 }}>
            <h4>Deliverable {deliverable ? `(v${deliverable.currentVersion})` : ""}</h4>
            {!deliverable ? (
              <div className="val dim">Awaiting the creator to submit work.</div>
            ) : (
              <>
                <div style={{ marginBottom: 8 }}><span className="badge badge-muted">{deliverable.status.replace("_", " ")}</span></div>
                {latestVersion?.contentUrl && <div className="val dim" style={{ wordBreak: "break-all", marginBottom: 4 }}>Content: {latestVersion.contentUrl}</div>}
                {latestVersion?.promotionUrl && <div className="val dim" style={{ wordBreak: "break-all", marginBottom: 4 }}>Promotion: {latestVersion.promotionUrl}</div>}
                {latestVersion?.notes && <div className="val dim" style={{ marginBottom: 4 }}>{latestVersion.notes}</div>}
                {deliverable.reviewNote && <div className="field-hint" style={{ marginTop: 6 }}>Your note: {deliverable.reviewNote}</div>}
                {deliverable.versions.length > 1 && <div className="field-hint" style={{ marginTop: 6 }}>{deliverable.versions.length} versions submitted (history kept).</div>}

                {["SUBMITTED", "UNDER_REVIEW"].includes(deliverable.status) && (
                  <div className="app-actions">
                    {deliverable.status === "SUBMITTED" && <button className="btn btn-ghost btn-sm" onClick={() => onReviewProof(assignment.id, "start_review").then(onRefresh)}><Eye size={14} /> Start review</button>}
                    <button className="btn btn-sm btn-accept" onClick={() => onReviewProof(assignment.id, "approve").then(onRefresh)}><CheckCircle2 size={14} /> Approve &amp; pay</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowNoteFor(showNoteFor === "revision" ? null : "revision")}><AlertCircle size={14} /> Request revision</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowNoteFor(showNoteFor === "reject" ? null : "reject")}><XCircle size={14} /> Reject</button>
                    <button className="btn btn-reject btn-sm" onClick={() => setShowNoteFor(showNoteFor === "dispute" ? null : "dispute")}><Flag size={14} /> Dispute</button>
                  </div>
                )}
                {showNoteFor && (
                  <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
                    <textarea placeholder="Note..." value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
                    <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={() => { onReviewProof(assignment.id, showNoteFor, noteDraft).then(onRefresh); setShowNoteFor(null); setNoteDraft(""); }}>Submit</button>
                  </div>
                )}
              </>
            )}
          </div>

          {deliverable && deliverable.status === "APPROVED" && !reviewSent && (
            <div className="review-block">
              <h4>Rate this creator</h4>
              <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                {[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} style={{ background: "none", border: "none", padding: 0 }}><Star size={20} fill={n <= rating ? "var(--gold)" : "none"} style={{ color: "var(--gold)" }} /></button>)}
              </div>
              <div className="field" style={{ marginBottom: 8 }}><textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} /></div>
              <button className="btn btn-primary btn-sm" onClick={submitReview}>Submit review</button>
            </div>
          )}
          {deliverable && deliverable.status === "APPROVED" && reviewSent && <div className="field-hint" style={{ marginLeft: 2 }}>✓ Review submitted.</div>}

          <div className="review-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setShowMsg(!showMsg)}>
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
        </>
      )}
    </div>
  );
}

function CampaignDetail({ campaignId, onBack }) {
  const [campaign, setCampaign] = useState(null);
  const [applications, setApplications] = useState([]);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [c, a, h] = await Promise.all([api.getCampaign(campaignId), api.campaignApplications(campaignId), api.getCampaignHistory(campaignId)]);
    setCampaign(c.campaign); setApplications(a.applications); setHistory(h.history);
    setLoading(false);
  };
  useEffect(() => { load(); }, [campaignId]);

  if (loading || !campaign) return <div className="empty">Loading campaign…</div>;

  const Icon = PLATFORM_ICONS[campaign.platform];
  const acceptedCount = applications.filter((a) => a.assignment?.status === "ACTIVE").length;
  const canAcceptMore = acceptedCount < campaign.maxCreators;

  const decide = async (appId, decision) => { await api.decideApplication(appId, decision); load(); };
  const requestInfo = async (appId, note) => { await api.requestApplicationInfo(appId, note); load(); };
  const cancelAssignment = async (assignmentId) => { await api.cancelAssignment(assignmentId); load(); };
  const reviewProof = (assignmentId, decision, note) => api.reviewDeliverable(assignmentId, decision, note);

  return (
    <div>
      <button className="back-link" onClick={onBack}><ChevronLeft size={15} /> Back to campaigns</button>
      <div className="cm-head">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <h2>{campaign.title}</h2>
            <StatusBadge status={campaign.status} />
          </div>
          <div className="camp-card-meta"><Icon size={14} style={{ color: PLATFORM_COLORS[campaign.platform] }} /> {PLATFORM_LABELS[campaign.platform]} · {campaign.category}</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {["DRAFT"].includes(campaign.status) && <button className="btn btn-ghost btn-sm" onClick={() => onBack("edit")}>Edit</button>}
          {["DRAFT", "PENDING_PAYMENT", "FUNDED", "PUBLISHED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "DISPUTED"].includes(campaign.status) && (
            <button className="btn btn-ghost btn-sm" onClick={async () => { await api.cancelCampaign(campaign.id); load(); }}>Cancel campaign</button>
          )}
          {["IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW"].includes(campaign.status) && (
            <button className="btn btn-primary btn-sm" onClick={async () => { await api.completeCampaign(campaign.id); load(); }}>Mark completed</button>
          )}
        </div>
      </div>

      {campaign.status === "PENDING_PAYMENT" && <PaymentBox campaign={campaign} onFunded={load} />}
      {campaign.status === "FUNDED" && <PublishBox campaign={campaign} onPublished={load} />}

      <div className="tabs-row">
        <button className={`tab-btn ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>Overview</button>
        <button className={`tab-btn ${tab === "applications" ? "active" : ""}`} onClick={() => setTab("applications")}>Applications ({applications.length})</button>
        <button className={`tab-btn ${tab === "timeline" ? "active" : ""}`} onClick={() => setTab("timeline")}>Activity timeline</button>
      </div>

      {tab === "overview" && (
        <div className="two-col">
          <div>
            <div className="review-block"><h4>Description</h4><div className="val dim">{campaign.description}</div></div>
            <div className="review-block"><h4>Content URL</h4><div className="val" style={{ wordBreak: "break-all" }}>{campaign.contentUrl}</div></div>
            <div className="review-block"><h4>Requirements</h4><div className="val dim">{campaign.requirements}</div>
              {campaign.requirementsList?.length > 0 && <div className="tag-row">{campaign.requirementsList.map((r, i) => <span className="tag" key={i}>{r}</span>)}</div>}
            </div>
            {campaign.eligibilityRequirements && <div className="review-block"><h4>Eligibility</h4><div className="val dim">{campaign.eligibilityRequirements}</div></div>}
          </div>
          <div>
            <div className="review-block">
              <h4>Budget</h4>
              <div className="val mono" style={{ fontSize: 20 }}>{fmt(campaign.budget)}</div>
              <div className="field-hint">{fmt(campaign.budgetPerCreator)} per creator · {campaign.commissionPercent}% platform commission</div>
            </div>
            <div className="review-block">
              <h4>Schedule</h4>
              <div className="val">{fmtDate(campaign.startDate)} → {fmtDate(campaign.endDate)}</div>
              {campaign.targetCountry && <div className="field-hint">Target: {campaign.targetCountry}</div>}
            </div>
            <div className="review-block">
              <h4>Creator slots</h4>
              <div className="val">{acceptedCount} / {campaign.maxCreators} accepted</div>
              <div className="progress-track" style={{ marginTop: 10 }}><div className="progress-fill" style={{ width: `${Math.min(100, Math.round((acceptedCount / campaign.maxCreators) * 100))}%` }} /></div>
            </div>
          </div>
        </div>
      )}

      {tab === "applications" && (
        applications.length === 0 ? <div className="panel"><div className="empty">No applications yet.</div></div> :
          applications.map((a) => <ApplicationCard key={a.id} app={a} campaign={campaign} canAcceptMore={canAcceptMore} onDecide={decide} onRequestInfo={requestInfo} onCancelAssignment={cancelAssignment} onReviewProof={reviewProof} onRefresh={load} />)
      )}

      {tab === "timeline" && (
        <div className="panel"><div className="panel-body">
          {history.map((h) => (
            <div className="row" key={h.id}>
              <div><div className="row-title">{h.from_status ? `${h.from_status} → ${h.to_status}` : `Created as ${h.to_status}`}</div><div className="row-sub">{h.note || ""}</div></div>
              <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{new Date(h.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div></div>
      )}
    </div>
  );
}

function CampaignCard({ campaign, onClick }) {
  const Icon = PLATFORM_ICONS[campaign.platform];
  return (
    <div className="camp-card" onClick={onClick}>
      <div className="camp-card-top">
        <div>
          <div className="camp-card-name">{campaign.title}</div>
          <div className="camp-card-meta"><Icon size={14} style={{ color: PLATFORM_COLORS[campaign.platform] }} /> {PLATFORM_LABELS[campaign.platform]} · {campaign.category}</div>
        </div>
        <StatusBadge status={campaign.status} />
      </div>
      <div className="camp-stats-row">
        <div className="camp-stat"><div className="v mono">{fmt(campaign.budget)}</div><div className="l">Budget</div></div>
        <div className="camp-stat"><div className="v">{campaign.acceptedCount || 0}/{campaign.maxCreators}</div><div className="l">Creators</div></div>
        <div className="camp-stat"><div className="v">{campaign.applicantCount || 0}</div><div className="l">Applicants</div></div>
        <div className="camp-stat"><div className="v">{fmtDate(campaign.endDate)}</div><div className="l">Deadline</div></div>
      </div>
    </div>
  );
}

function CampaignsModule() {
  const [campaigns, setCampaigns] = useState([]);
  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  const load = async () => { const r = await api.myCampaigns(); setCampaigns(r.campaigns); setLoading(false); };
  useEffect(() => { load(); }, []);

  if (view === "new") return <CampaignForm onCancel={() => setView("list")} onSaved={() => { setView("list"); load(); }} />;
  if (view === "edit") return <CampaignForm existing={editingCampaign} onCancel={() => setView("list")} onSaved={() => { setView("list"); load(); }} />;
  if (view === "detail") return <CampaignDetail campaignId={selectedId} onBack={(next) => {
    if (next === "edit") { setEditingCampaign(campaigns.find((c) => c.id === selectedId)); setView("edit"); }
    else { setView("list"); load(); }
  }} />;

  const filtered = statusFilter === "All" ? campaigns : campaigns.filter((c) => c.status === statusFilter);
  const statuses = ["All", "DRAFT", "PENDING_PAYMENT", "FUNDED", "PUBLISHED", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "COMPLETED", "CANCELLED", "DISPUTED"];

  return (
    <>
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {statuses.map((s) => <div key={s} className={`filter-chip ${statusFilter === s ? "active" : ""}`} style={{ cursor: "pointer" }} onClick={() => setStatusFilter(s)}>{s === "All" ? "All" : s.replaceAll("_", " ")}</div>)}
      </div>
      <div className="cm-head">
        <div className="results-count" style={{ marginBottom: 0 }}>{filtered.length} campaign{filtered.length !== 1 ? "s" : ""}</div>
        <button className="btn btn-primary btn-sm" onClick={() => setView("new")}><Plus size={14} /> New campaign</button>
      </div>
      {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? (
        <div className="panel"><div className="empty">No campaigns match.<div style={{ marginTop: 14 }}><button className="btn btn-primary btn-sm" onClick={() => setView("new")}>Create your first campaign</button></div></div></div>
      ) : (
        filtered.map((c) => <CampaignCard key={c.id} campaign={c} onClick={() => { setSelectedId(c.id); setView("detail"); }} />)
      )}
    </>
  );
}

function WalletModule() {
  const [wallet, setWallet] = useState(null);
  const [ledger, setLedger] = useState([]);
  useEffect(() => { api.getWallet().then((r) => { setWallet(r.wallet); setLedger(r.ledger); }); }, []);
  if (!wallet) return <div className="empty">Loading wallet…</div>;
  return (
    <>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-top"><div className="stat-icon" style={{ background: "var(--coral-dim)" }}><WalletIcon size={16} style={{ color: "var(--coral)" }} /></div></div><div className="stat-val">{fmt(wallet.balance)}</div><div className="stat-lbl">Available balance</div></div>
        <div className="stat-card"><div className="stat-top"><div className="stat-icon" style={{ background: "var(--mint-dim)" }}><TrendingUp size={16} style={{ color: "var(--mint)" }} /></div></div><div className="stat-val">{fmt(wallet.totalEarned)}</div><div className="stat-lbl">Total credited</div></div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Ledger</h3></div>
        <div className="panel-body">
          {ledger.length === 0 ? <div className="empty">No wallet activity yet. An admin can credit your wallet (a stand-in for a real payment top-up — see README) so you can fund campaigns.</div> : ledger.map((l) => (
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

export default function AdvertiserDashboard({ tab }) {
  if (tab === "wallet") return <WalletModule />;
  return <CampaignsModule />;
}

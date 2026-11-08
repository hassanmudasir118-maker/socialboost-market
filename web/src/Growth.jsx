import React, { useState, useEffect } from "react";
import { api } from "./api";
import { fmt, PLATFORM_ICONS, PLATFORM_LABELS, PLATFORM_COLORS } from "./shared";

const STATUS_TEXT = {
  PENDING_PAYMENT: "Waiting for your payment", AWAITING_CONFIRMATION: "We are checking your payment",
  ACTIVE: "Running", COMPLETED: "Finished", CANCELLED: "Cancelled",
};
const STATUS_BADGE = { PENDING_PAYMENT: "badge-gold", AWAITING_CONFIRMATION: "badge-violet", ACTIVE: "badge-mint", COMPLETED: "badge-blue", CANCELLED: "badge-muted" };
const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "FACEBOOK"];

function OrderForm({ rates, onCreated }) {
  const [platform, setPlatform] = useState("TIKTOK");
  const [action, setAction] = useState("FOLLOW");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState(100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const actions = rates.actions[platform];
  const act = actions.includes(action) ? action : actions[0];
  const rate = rates.rates[act];
  const total = rate.price * (Number(qty) || 0);
  const label = act === "FOLLOW" ? "Followers" : act === "SUBSCRIBE" ? "Subscribers" : "Likes";

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.createTaskOrder({ platform, action: act, targetUrl: url, targetName: name || null, quantity: Number(qty) });
      setUrl(""); setName("");
      onCreated();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head"><h3>Get more followers or likes</h3></div>
      <div className="panel-body" style={{ padding: 20 }}>
        <div className="field">
          <label>1. Where?</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {PLATFORMS.map((p) => {
              const Icon = PLATFORM_ICONS[p];
              return (
                <button key={p} type="button" className={`btn ${platform === p ? "btn-primary" : "btn-ghost"} btn-sm`} onClick={() => { setPlatform(p); setAction(rates.actions[p][0]); }}>
                  <Icon size={16} style={{ color: platform === p ? undefined : PLATFORM_COLORS[p] }} /> {PLATFORM_LABELS[p]}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label>2. What do you want?</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {actions.map((a) => (
              <button key={a} type="button" className={`btn ${act === a ? "btn-primary" : "btn-ghost"} btn-sm`} onClick={() => setAction(a)}>
                {rates.rates[a].label === "Follow" ? "Followers" : rates.rates[a].label === "Subscribe" ? "Subscribers" : "Likes"} · {fmt(rates.rates[a].price)} each
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>3. Link of your {act === "LIKE" ? "video / post" : "profile or channel"}</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`https://www.${platform.toLowerCase()}.com/...`} />
          <div className="field-hint">Open it in your browser, copy the link from the top, and paste it here.</div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Your account name (optional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="@yourname" />
          </div>
          <div className="field">
            <label>4. How many {label.toLowerCase()}?</label>
            <input type="number" min={10} max={10000} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>
        <p style={{ marginBottom: 14 }}>You will pay <b className="mono">{fmt(total)}</b> for {Number(qty) || 0} {label.toLowerCase()}.</p>
        <button className="btn btn-primary" disabled={busy || url.trim().length < 8 || !(Number(qty) >= 10)} onClick={submit}>{busy ? "Please wait…" : "Continue to payment"}</button>
        {err && <p style={{ marginTop: 10, color: "var(--coral)" }}>{err}</p>}
      </div>
    </div>
  );
}

function OrderCard({ order, rates, reload }) {
  const [method, setMethod] = useState("EASYPAISA");
  const [ref, setRef] = useState("");
  const [claims, setClaims] = useState(null);
  const [err, setErr] = useState(null);
  const Icon = PLATFORM_ICONS[order.platform];
  const wrap = async (fn) => { setErr(null); try { await fn(); await reload(); } catch (e) { setErr(e.message); } };
  const loadClaims = () => api.taskOrderClaims(order.id).then((r) => setClaims(r)).catch((e) => setErr(e.message));
  const reject = async (id) => {
    const reason = window.prompt("What was wrong? (for example: I cannot see this follower)") || "";
    await wrap(() => api.rejectTaskClaim(id, reason));
    loadClaims();
  };
  const acc = rates.payTo.find((a) => a.method === method);

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-body" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ color: PLATFORM_COLORS[order.platform] }}>{Icon && <Icon size={26} />}</div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div className="row-title">{order.quantity} {order.actionLabel} · {PLATFORM_LABELS[order.platform]}</div>
            <div className="row-sub">{order.done} done of {order.quantity} · {fmt(order.total)}</div>
          </div>
          <span className={`badge ${STATUS_BADGE[order.status]}`}>{STATUS_TEXT[order.status] || order.status}</span>
        </div>

        {order.status === "PENDING_PAYMENT" && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
            <p>Send <b className="mono">{fmt(order.total)}</b> to:</p>
            <div className="field" style={{ margin: "10px 0", maxWidth: 320 }}>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {rates.payTo.map((a) => <option key={a.method} value={a.method}>{a.method}</option>)}
              </select>
            </div>
            {acc && <p style={{ marginBottom: 12 }}><b>{acc.accountNumber}</b> ({acc.accountName})</p>}
            <div className="field" style={{ maxWidth: 320 }}>
              <label>Transaction ID or your phone number</label>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 1234567890" />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-primary btn-sm" disabled={ref.trim().length < 3} onClick={() => wrap(() => api.payTaskOrder(order.id, method, ref))}>I have paid</button>
              <button className="btn btn-ghost btn-sm" onClick={() => wrap(() => api.cancelTaskOrder(order.id))}>Cancel order</button>
            </div>
          </div>
        )}

        {(order.status === "ACTIVE" || order.status === "COMPLETED") && (
          <div style={{ marginTop: 12 }}>
            {claims === null ? (
              <button className="btn btn-ghost btn-sm" onClick={loadClaims}>
                See who did it{order.waiting > 0 ? ` (${order.waiting} to check)` : ""}
              </button>
            ) : claims.claims.length === 0 ? <p>Nobody has done it yet.</p> : (
              <>
                <p className="row-sub" style={{ marginBottom: 6 }}>Check each username in your {PLATFORM_LABELS[order.platform]} followers list. If you do nothing, it is accepted automatically after {claims.autoApproveHours} hours.</p>
                {claims.claims.map((c) => (
                  <div className="row" key={c.id}>
                    <div className="row-title">{c.username}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {c.status === "PENDING" ? (
                        <>
                          <button className="btn btn-primary btn-sm" onClick={async () => { await wrap(() => api.approveTaskClaim(c.id)); loadClaims(); }}>Yes, I see it</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => reject(c.id)}>Not found</button>
                        </>
                      ) : <span className={`badge ${c.status === "APPROVED" ? "badge-mint" : "badge-red"}`}>{c.status === "APPROVED" ? "Accepted" : "Rejected"}</span>}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        {err && <p style={{ marginTop: 10, color: "var(--coral)" }}>{err}</p>}
      </div>
    </div>
  );
}

export default function Growth() {
  const [rates, setRates] = useState(null);
  const [orders, setOrders] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => api.myTaskOrders().then((r) => setOrders(r.orders)).catch((e) => setErr(e.message));
  useEffect(() => { api.taskRates().then(setRates).catch((e) => setErr(e.message)); load(); }, []);
  if (!rates || !orders) return <div className="empty">{err || "Loading…"}</div>;
  return (
    <>
      <OrderForm rates={rates} onCreated={load} />
      <h3 style={{ margin: "0 0 12px" }}>Your orders</h3>
      {orders.length === 0 ? <div className="empty">No orders yet.</div> : orders.map((o) => <OrderCard key={o.id} order={o} rates={rates} reload={load} />)}
    </>
  );
}

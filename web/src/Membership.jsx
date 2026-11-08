import React, { useState, useEffect } from "react";
import { api } from "./api";
import { fmt } from "./shared";

// Advertiser membership page. The only benefit shown is a lower commission,
// which the server really applies when a campaign is paid for.
export default function Membership() {
  const [data, setData] = useState(null);
  const [planId, setPlanId] = useState(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => api.getMembership().then(setData).catch((e) => setMsg({ type: "err", text: e.message }));
  useEffect(() => { load(); }, []);

  if (!data) return <div className="empty">{msg ? msg.text : "Loading…"}</div>;

  const current = data.current.plan;
  const expires = data.current.expiresAt ? new Date(data.current.expiresAt).toLocaleDateString() : null;
  const chosen = data.plans.find((p) => p.id === planId);

  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.requestMembership(planId, reference);
      setMsg({ type: "ok", text: "Request sent. The admin will check your payment and activate your plan." });
      setPlanId(null); setReference("");
      await load();
    } catch (e) {
      setMsg({ type: "err", text: e.message });
    }
    setBusy(false);
  };

  return (
    <>
      <div className="panel">
        <div className="panel-head"><h3>Your plan</h3><span className="badge badge-mint">{current.name}</span></div>
        <div className="panel-body" style={{ padding: 20 }}>
          <p>{current.description}</p>
          {expires && <p style={{ marginTop: 8 }}>Active until <b>{expires}</b>. After that you go back to the Free plan.</p>}
          {data.pendingRequest && <p style={{ marginTop: 8 }}>Your <b>{data.pendingRequest.planId}</b> request is waiting for the admin to check your payment.</p>}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>Plans</h3></div>
        <div className="panel-body" style={{ padding: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
            {data.plans.map((p) => {
              const isCurrent = p.id === current.id;
              return (
                <div key={p.id} style={{ border: `1px solid ${planId === p.id ? "var(--coral)" : "var(--border)"}`, borderRadius: "var(--radius-md)", padding: 18, background: "var(--surface-2)" }}>
                  <div className="disp" style={{ fontSize: 18, fontWeight: 600 }}>{p.name}</div>
                  <div className="mono" style={{ fontSize: 22, margin: "8px 0" }}>{p.price === 0 ? "Free" : `${fmt(p.price)} / month`}</div>
                  <p style={{ fontSize: 13.5 }}>{p.description}</p>
                  <div style={{ marginTop: 14 }}>
                    {isCurrent ? <span className="badge badge-mint">Your plan</span>
                      : p.price === 0 ? null
                      : <button className="btn btn-primary btn-sm" disabled={!!data.pendingRequest} onClick={() => { setPlanId(p.id); setMsg(null); }}>Choose {p.name}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {chosen && (
        <div className="panel" style={{ marginTop: 18 }}>
          <div className="panel-head"><h3>Pay for {chosen.name}: {fmt(chosen.price)}</h3></div>
          <div className="panel-body" style={{ padding: 20 }}>
            <p>1. Send <b>{fmt(chosen.price)}</b> to one of these accounts:</p>
            <div style={{ margin: "10px 0 16px" }}>
              {data.payTo.map((a) => (
                <div key={a.method} className="row-sub" style={{ marginBottom: 4 }}>{a.method}: <b>{a.accountNumber}</b> ({a.accountName})</div>
              ))}
            </div>
            <p style={{ marginBottom: 10 }}>2. Write the transaction ID (or the number you paid from) below and press Send.</p>
            <div className="field">
              <label>Transaction ID or your phone number</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 1234567890" />
            </div>
            <button className="btn btn-primary" disabled={busy || reference.trim().length < 3} onClick={send}>{busy ? "Sending…" : "Send for approval"}</button>
          </div>
        </div>
      )}

      {msg && <p style={{ marginTop: 14, color: msg.type === "ok" ? "var(--mint)" : "var(--coral)" }}>{msg.text}</p>}
    </>
  );
}

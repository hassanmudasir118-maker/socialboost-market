import React, { useState, useEffect, useRef } from "react";
import { ExternalLink, CheckCircle2 } from "lucide-react";
import { api } from "./api";
import { fmt, PLATFORM_ICONS, PLATFORM_LABELS, PLATFORM_COLORS } from "./shared";

const STATUS_TEXT = { PENDING: "Waiting for check", APPROVED: "Paid", REJECTED: "Not accepted" };
const STATUS_BADGE = { PENDING: "badge-gold", APPROVED: "badge-mint", REJECTED: "badge-red" };

function loadName() { try { return localStorage.getItem("sbm_task_username") || ""; } catch { return ""; } }
function saveName(v) { try { localStorage.setItem("sbm_task_username", v); } catch { /* ignore */ } }

function TaskCard({ task, minSeconds, onDone }) {
  const [phase, setPhase] = useState("idle"); // idle -> opened -> (ready)
  const [left, setLeft] = useState(0);
  const [username, setUsername] = useState(loadName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const timer = useRef(null);
  const Icon = PLATFORM_ICONS[task.platform];

  useEffect(() => () => clearInterval(timer.current), []);

  const open = async () => {
    setErr(null);
    try {
      const r = await api.startTask(task.id);
      window.open(r.url, "_blank", "noopener,noreferrer");
      setPhase("opened");
      setLeft(r.minSeconds || minSeconds);
      clearInterval(timer.current);
      timer.current = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    } catch (e) { setErr(e.message); }
  };

  const done = async () => {
    setBusy(true); setErr(null);
    try {
      await api.claimTask(task.id, username);
      saveName(username);
      onDone();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-body" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", color: PLATFORM_COLORS[task.platform] }}>
            {Icon && <Icon size={26} />}
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div className="row-title">{task.actionLabel} {task.targetName ? `@${task.targetName.replace(/^@/, "")}` : `on ${PLATFORM_LABELS[task.platform]}`}</div>
            <div className="row-sub">{PLATFORM_LABELS[task.platform]} · {task.left} spots left</div>
          </div>
          <div className="mono" style={{ fontSize: 18, color: "var(--mint)" }}>+{fmt(task.reward)}</div>
          {phase === "idle" && <button className="btn btn-primary btn-sm" onClick={open}><ExternalLink size={14} /> Open {PLATFORM_LABELS[task.platform]}</button>}
        </div>

        {phase === "opened" && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
            <p style={{ marginBottom: 10 }}>
              1. In the new tab, <b>{task.actionLabel.toLowerCase()}</b> the account.<br />
              2. Come back here, write <b>your own {PLATFORM_LABELS[task.platform]} username</b> so the advertiser can check, and press Done.
            </p>
            <div className="field" style={{ maxWidth: 320 }}>
              <label>Your {PLATFORM_LABELS[task.platform]} username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@yourname" />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-primary btn-sm" disabled={busy || left > 0 || username.trim().length < 2} onClick={done}>
                <CheckCircle2 size={14} /> {left > 0 ? `Done (wait ${left}s)` : "✅ I did it"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={open}>Open link again</button>
            </div>
          </div>
        )}
        {err && <p style={{ marginTop: 10, color: "var(--coral)" }}>{err}</p>}
      </div>
    </div>
  );
}

export default function QuickTasks() {
  const [data, setData] = useState(null);
  const [mine, setMine] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => {
    api.availableTasks().then(setData).catch((e) => setErr(e.message));
    api.myTasks().then(setMine).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  if (!data) return <div className="empty">{err || "Loading…"}</div>;

  return (
    <>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-body" style={{ padding: 18 }}>
          <div className="disp" style={{ fontSize: 18, fontWeight: 600 }}>Do a quick task, earn money</div>
          <p style={{ marginTop: 6 }}>Open the account, follow (or like), come back and press ✅. Your reward is added to your wallet after the advertiser checks it (or automatically after 48 hours).</p>
          {mine && (
            <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap" }}>
              <div><div className="mono" style={{ fontSize: 20, color: "var(--mint)" }}>{fmt(mine.totals.approved)}</div><div className="row-sub">Earned from tasks</div></div>
              <div><div className="mono" style={{ fontSize: 20 }}>{fmt(mine.totals.waiting)}</div><div className="row-sub">Waiting for check</div></div>
            </div>
          )}
        </div>
      </div>

      <h3 style={{ margin: "0 0 12px" }}>Available tasks</h3>
      {data.tasks.length === 0 ? <div className="empty">No tasks right now. Please check again soon.</div>
        : data.tasks.map((t) => <TaskCard key={t.id} task={t} minSeconds={data.minSeconds} onDone={load} />)}

      {mine && mine.claims.length > 0 && (
        <div className="panel" style={{ marginTop: 22 }}>
          <div className="panel-head"><h3>My finished tasks</h3></div>
          <div className="panel-body">
            {mine.claims.map((c) => (
              <div className="row" key={c.id}>
                <div><div className="row-title">{c.action} · {PLATFORM_LABELS[c.platform]}{c.targetName ? ` · ${c.targetName}` : ""}</div>
                  <div className="row-sub">{new Date(c.claimedAt).toLocaleString()}{c.note ? ` · ${c.note}` : ""}</div></div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="mono">{fmt(c.reward)}</span>
                  <span className={`badge ${STATUS_BADGE[c.status]}`}>{STATUS_TEXT[c.status]}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

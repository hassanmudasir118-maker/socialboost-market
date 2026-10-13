import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import { Save, History } from "lucide-react";
import { api } from "./api";
import { fmt } from "./shared";

function Overview() {
  const [d, setD] = useState(null);
  useEffect(() => { api.adminOverview().then(setD); }, []);
  if (!d) return <div className="empty">Loading…</div>;
  return (
    <>
      <div className="kpi-mini-row" style={{ marginBottom: 14 }}>
        <div className="kpi-mini"><div className="v">{d.totalUsers}</div><div className="l">Total users</div></div>
        <div className="kpi-mini"><div className="v">{d.advertisers}</div><div className="l">Advertisers</div></div>
        <div className="kpi-mini"><div className="v">{d.creators}</div><div className="l">Creators</div></div>
        <div className="kpi-mini"><div className="v">{d.activeCampaigns}</div><div className="l">Active campaigns</div></div>
      </div>
      <div className="kpi-mini-row">
        <div className="kpi-mini"><div className="v">{d.completedCampaigns}</div><div className="l">Completed campaigns</div></div>
        <div className="kpi-mini"><div className="v mono">{fmt(d.totalPlatformRevenue)}</div><div className="l">Total platform revenue</div></div>
        <div className="kpi-mini"><div className="v mono">{fmt(d.totalCreatorEarnings)}</div><div className="l">Total creator earnings</div></div>
        <div className="kpi-mini"><div className="v mono">{fmt(d.pendingPayments)}</div><div className="l">Pending payments (escrow)</div></div>
      </div>
      <div className="kpi-mini-row" style={{ marginTop: 14 }}>
        <div className="kpi-mini"><div className="v">{d.withdrawalRequests}</div><div className="l">Withdrawal requests</div></div>
        <div className="kpi-mini"><div className="v">{d.openDisputes}</div><div className="l">Open disputes</div></div>
      </div>
    </>
  );
}

function UsersModule() {
  const [users, setUsers] = useState([]);
  const load = () => api.adminUsers().then((r) => setUsers(r.users));
  useEffect(() => { load(); }, []);
  return (
    <div className="panel">
      <div className="panel-head"><h3>User accounts</h3><span className="badge badge-muted">{users.length}</span></div>
      <div className="panel-body">
        {users.map((u) => (
          <div className="row" key={u.id}>
            <div><div className="row-title">{u.name || u.email} {u.verified && <span className="badge badge-mint" style={{ marginLeft: 6 }}>Verified</span>}</div><div className="row-sub">{u.email} · {u.role}</div></div>
            <div style={{ display: "flex", gap: 8 }}>
              {u.role === "CREATOR" && <button className="btn btn-ghost btn-sm" onClick={async () => { await api.adminVerifyUser(u.id); load(); }}>{u.verified ? "Unverify" : "Verify"}</button>}
              <button className="btn btn-ghost btn-sm" onClick={async () => { await api.adminSuspendUser(u.id); load(); }}>{u.suspended ? "Reactivate" : "Suspend"}</button>
              <span className={`badge ${u.suspended ? "badge-red" : "badge-mint"}`}>{u.suspended ? "Suspended" : "Active"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignsModule() {
  const [campaigns, setCampaigns] = useState([]);
  const load = () => api.adminCampaigns().then((r) => setCampaigns(r.campaigns));
  useEffect(() => { load(); }, []);
  return (
    <div className="panel">
      <div className="panel-head"><h3>All campaigns</h3><span className="badge badge-muted">{campaigns.length}</span></div>
      <div className="panel-body">
        {campaigns.map((c) => (
          <div className="row" key={c.id}>
            <div><div className="row-title">{c.name} · {c.advertiserName}</div><div className="row-sub">{fmt(c.budget)} · {c.applicantCount} applicants</div></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {c.adminApproved ? <span className="badge badge-mint">Approved</span> : <button className="btn btn-ghost btn-sm" onClick={async () => { await api.adminApproveCampaign(c.id); load(); }}>Approve</button>}
              <span className="badge badge-muted">{c.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualPaymentsModule() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api.adminPendingManualPayments().then((r) => setRows(r.payments));
  useEffect(() => { load(); }, []);

  const resolve = async (id, confirm) => {
    setBusy(true);
    try { await api.adminResolveManualPayment(id, confirm, confirm ? null : "Payment not found / could not be verified"); await load(); }
    finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <div className="panel-head"><h3>Pending manual payments (EasyPaisa / JazzCash / Bank Transfer)</h3><span className="badge badge-gold">{rows.length}</span></div>
      <div className="panel-body">
        {rows.length === 0 ? <div className="empty">None pending.</div> : rows.map((p) => (
          <div className="row" key={p.id}>
            <div>
              <div className="row-title">{p.advertiserEmail} — {p.campaignTitle}</div>
              <div className="row-sub">{fmt(p.amount)} via {p.method} · reference: <strong>{p.reference}</strong></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm btn-accept" disabled={busy} onClick={() => resolve(p.id, true)}>Confirm — fund escrow</button>
              <button className="btn btn-sm btn-reject" disabled={busy} onClick={() => resolve(p.id, false)}>Reject</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WithdrawalsModule() {
  const [rows, setRows] = useState([]);
  const load = () => api.adminWithdrawals().then((r) => setRows(r.withdrawals));
  useEffect(() => { load(); }, []);
  const pending = rows.filter((w) => w.status === "PENDING");
  const resolved = rows.filter((w) => w.status !== "PENDING");
  return (
    <>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h3>Pending requests</h3><span className="badge badge-gold">{pending.length}</span></div>
        <div className="panel-body">
          {pending.length === 0 ? <div className="empty">None pending.</div> : pending.map((w) => (
            <div className="row" key={w.id}>
              <div><div className="row-title">{w.userEmail}</div><div className="row-sub">{fmt(w.amount)} requested · net {fmt(w.net)}</div></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm btn-accept" onClick={async () => { await api.adminResolveWithdrawal(w.id, true); load(); }}>Approve</button>
                <button className="btn btn-sm btn-reject" onClick={async () => { await api.adminResolveWithdrawal(w.id, false); load(); }}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Resolved</h3></div>
        <div className="panel-body">{resolved.map((w) => (
          <div className="row" key={w.id}>
            <div><div className="row-title">{w.userEmail}</div><div className="row-sub">{fmt(w.amount)}</div></div>
            <span className={`badge ${w.status === "APPROVED" ? "badge-mint" : "badge-red"}`}>{w.status}</span>
          </div>
        ))}</div>
      </div>
    </>
  );
}

function DisputesModule() {
  const [rows, setRows] = useState([]);
  const load = () => api.adminDisputes().then((r) => setRows(r.disputes));
  useEffect(() => { load(); }, []);
  const open = rows.filter((d) => d.status === "OPEN");
  const resolved = rows.filter((d) => d.status !== "OPEN");
  return (
    <>
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head"><h3>Open disputes</h3><span className="badge badge-coral">{open.length}</span></div>
        <div className="panel-body">
          {open.length === 0 ? <div className="empty">No open disputes.</div> : open.map((d) => (
            <div key={d.id} style={{ borderBottom: "1px solid var(--border-soft)", padding: "14px 12px" }}>
              <div className="row-title">{d.campaignName}</div>
              <div className="row-sub" style={{ marginBottom: 8 }}>Raised by {d.raisedByName} ({d.raised_by_role}) against {d.against}</div>
              <div className="app-msg">{d.reason}</div>
              <div className="app-actions">
                <button className="btn btn-sm btn-accept" onClick={async () => { await api.adminResolveDispute(d.id, "RELEASED_TO_CREATOR"); load(); }}>Release to creator</button>
                <button className="btn btn-sm btn-reject" onClick={async () => { await api.adminResolveDispute(d.id, "REFUNDED_TO_ADVERTISER"); load(); }}>Refund advertiser</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h3>Resolved</h3></div>
        <div className="panel-body">{resolved.map((d) => (
          <div className="row" key={d.id}><div className="row-title">{d.campaignName}</div><span className="badge badge-mint">Resolved</span></div>
        ))}</div>
      </div>
    </>
  );
}

function AnalyticsModule() {
  const [d, setD] = useState(null);
  useEffect(() => { api.adminAnalytics().then(setD); }, []);
  if (!d) return <div className="empty">Loading…</div>;
  const COLORS = ["#FF6B4A", "#4ADE94", "#8B93F8", "#D8A94E", "#5EA8FF", "#FF7A6E"];
  return (
    <>
      <div className="two-col" style={{ marginBottom: 20 }}>
        <div className="chart-panel">
          <h3>Platform revenue (last 14 days)</h3>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer><LineChart data={d.revenueByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232A34" vertical={false} />
              <XAxis dataKey="date" stroke="#5D6672" fontSize={10.5} />
              <YAxis stroke="#5D6672" fontSize={11} />
              <Tooltip contentStyle={{ background: "#171C24", border: "1px solid #232A34", borderRadius: 8 }} />
              <Line type="monotone" dataKey="amount" stroke="#FF6B4A" strokeWidth={2} dot={false} />
            </LineChart></ResponsiveContainer>
          </div>
        </div>
        <div className="chart-panel">
          <h3>Campaigns by status</h3>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer><PieChart>
              <Pie data={d.campaignsByStatus} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                {d.campaignsByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart></ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="chart-panel">
        <h3>Users by role</h3>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer><BarChart data={d.usersByRole}>
            <CartesianGrid strokeDasharray="3 3" stroke="#232A34" vertical={false} />
            <XAxis dataKey="name" stroke="#5D6672" fontSize={11} />
            <YAxis stroke="#5D6672" fontSize={11} />
            <Tooltip />
            <Bar dataKey="value" fill="#8B93F8" radius={[6, 6, 0, 0]} />
          </BarChart></ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

function SettingsModule() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.adminGetSettings().then((r) => setS(r.settings)); }, []);
  if (!s) return <div className="empty">Loading…</div>;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const save = async () => {
    await api.adminUpdateSettings(s);
    setMsg("Settings saved.");
    setTimeout(() => setMsg(""), 2000);
  };
  return (
    <div className="panel">
      <div className="panel-head"><h3>Marketplace payment settings</h3></div>
      <div className="panel-body" style={{ padding: "18px 20px" }}>
        {msg && <div className="auth-error" style={{ background: "var(--mint-dim)", borderColor: "#234436", color: "var(--mint)" }}>{msg}</div>}
        <div className="field"><label>Platform commission (%)</label><input type="number" value={s.commissionPercent} onChange={set("commissionPercent")} /></div>
        <div className="field-row">
          <div className="field"><label>Min withdrawal (Rs)</label><input type="number" value={s.minWithdrawal} onChange={set("minWithdrawal")} /></div>
          <div className="field"><label>Max withdrawal (Rs)</label><input type="number" value={s.maxWithdrawal} onChange={set("maxWithdrawal")} /></div>
        </div>
        <div className="field-row">
          <div className="field"><label>Processing fee (%)</label><input type="number" value={s.processingFeePercent} onChange={set("processingFeePercent")} /></div>
          <div className="field"><label>Fixed processing fee (Rs)</label><input type="number" value={s.processingFeeFixed} onChange={set("processingFeeFixed")} /></div>
        </div>
        <button className="btn btn-primary" onClick={save}><Save size={15} /> Save settings</button>
      </div>
    </div>
  );
}

function ActivityLogModule() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { api.adminAuditLogs().then((r) => setLogs(r.logs)); }, []);
  return (
    <div className="panel">
      <div className="panel-head"><h3>Activity log</h3><span className="badge badge-muted">{logs.length}</span></div>
      <div className="panel-body">
        {logs.map((l) => (
          <div className="row" key={l.id}>
            <div className="row-left">
              <div className="row-icon" style={{ background: "var(--surface-2)" }}><History size={15} style={{ color: "var(--text-dim)" }} /></div>
              <div><div className="row-title">{l.action}</div><div className="row-sub">{l.actor_email || "System"} · {l.details || ""}</div></div>
            </div>
            <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{new Date(l.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminDashboard({ tab }) {
  if (tab === "overview") return <Overview />;
  if (tab === "users") return <UsersModule />;
  if (tab === "campaigns") return <CampaignsModule />;
  if (tab === "withdrawals") return <WithdrawalsModule />;
  if (tab === "manual-payments") return <ManualPaymentsModule />;
  if (tab === "disputes") return <DisputesModule />;
  if (tab === "analytics") return <AnalyticsModule />;
  if (tab === "settings") return <SettingsModule />;
  if (tab === "activity") return <ActivityLogModule />;
  return <Overview />;
}

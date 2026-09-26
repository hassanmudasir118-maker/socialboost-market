import React, { useState, useEffect } from "react";
import { RotateCcw, Star, Globe, MapPin } from "lucide-react";
import { api } from "./api";
import { PLATFORM_ICONS, PLATFORM_LABELS, PLATFORM_COLORS } from "./shared";

export default function Marketplace() {
  const [filters, setFilters] = useState({ platform: "", country: "", category: "", minFollowers: "", minEngagement: "", minRating: "" });
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const r = await api.listCreators(filters);
    setCreators(r.creators);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const setF = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

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
        <div className="field"><label>Country</label><input type="text" placeholder="Any" value={filters.country} onChange={setF("country")} /></div>
        <div className="field"><label>Min. followers</label><input type="number" placeholder="Any" value={filters.minFollowers} onChange={setF("minFollowers")} /></div>
        <div className="field"><label>Min. engagement %</label><input type="number" placeholder="Any" value={filters.minEngagement} onChange={setF("minEngagement")} /></div>
        <div className="field"><label>Min. rating</label><input type="number" step="0.5" max="5" placeholder="Any" value={filters.minRating} onChange={setF("minRating")} /></div>
        <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="btn btn-primary btn-full" onClick={load}>Search</button>
        </div>
      </div>

      <div className="results-count">{creators.length} creator{creators.length !== 1 ? "s" : ""} match your filters — real registered accounts only</div>

      {loading ? <div className="empty">Loading…</div> : creators.length === 0 ? (
        <div className="panel"><div className="empty">
          No creators match yet. Unlike a demo, this marketplace only shows real registered creators who've added a
          social account — nothing here is fabricated. Invite creators to sign up and add their accounts to populate it.
        </div></div>
      ) : (
        <div className="creator-grid">
          {creators.map((c) => {
            const primary = c.socialAccounts[0];
            const Icon = PLATFORM_ICONS[primary.platform];
            return (
              <div className="creator-mini" key={c.userId}>
                <div className="cm-avatar-row">
                  <div className="cm-avatar">{(c.profile.displayName || "?").split(" ").map((n) => n[0]).join("")}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="cm-name-row">{c.profile.displayName} {c.profile.verified && <span className="badge badge-mint" style={{ fontSize: 10 }}>Verified</span>}</div>
                    <div className="cm-sub"><Icon size={12} style={{ color: PLATFORM_COLORS[primary.platform] }} /> {primary.handle} {c.profile.country && <><span>·</span> <MapPin size={11} /> {c.profile.country}</>}</div>
                  </div>
                </div>
                <div className="cm-tags">{(c.profile.categories || []).slice(0, 3).map((cat) => <span className="cm-tag" key={cat}>{cat}</span>)}</div>
                <div className="cm-stats">
                  <div className="cm-stat"><div className="v">{c.totalFollowers.toLocaleString()}</div><div className="l">Followers (self-reported)</div></div>
                  <div className="cm-stat"><div className="v">{c.topEngagement}%</div><div className="l">Engagement</div></div>
                  <div className="cm-stat"><div className="rating-row"><Star size={12} style={{ color: "var(--gold)" }} fill="var(--gold)" /> {c.profile.ratingAvg || "—"}</div><div className="l">{c.profile.ratingCount} reviews</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function getAccessToken() { return localStorage.getItem("sbm_access_token"); }
function getRefreshToken() { return localStorage.getItem("sbm_refresh_token"); }
function setTokens(accessToken, refreshToken) {
  if (accessToken) localStorage.setItem("sbm_access_token", accessToken); else localStorage.removeItem("sbm_access_token");
  if (refreshToken) localStorage.setItem("sbm_refresh_token", refreshToken); else localStorage.removeItem("sbm_refresh_token");
}
function clearTokens() { setTokens(null, null); }

let refreshInFlight = null;
async function tryRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) { clearTokens(); return false; }
        const data = await res.json();
        setTokens(data.accessToken, data.refreshToken);
        return true;
      })
      .catch(() => { clearTokens(); return false; })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function request(path, { method = "GET", body, auth = true, _retried = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Access tokens are short-lived (15m) by design. On a 401, silently use the
  // refresh token to get a new one and retry once — the user never notices.
  if (res.status === 401 && auth && !_retried && path !== "/auth/refresh") {
    const refreshed = await tryRefresh();
    if (refreshed) return request(path, { method, body, auth, _retried: true });
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.issues = data && data.issues;
    throw err;
  }
  return data;
}

export const api = {
  setTokens,
  clearTokens,
  getAccessToken,

  // Auth
  register: (payload) => request("/auth/register", { method: "POST", body: payload, auth: false }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload, auth: false }),
  logout: () => {
    const refreshToken = getRefreshToken();
    clearTokens();
    if (refreshToken) return request("/auth/logout", { method: "POST", body: { refreshToken }, auth: false }).catch(() => {});
    return Promise.resolve();
  },
  logoutAllSessions: () => request("/auth/logout-all", { method: "POST" }),
  me: () => request("/auth/me"),
  mySessions: () => request("/auth/sessions"),
  requestEmailVerification: () => request("/auth/verify-email/request", { method: "POST" }),
  confirmEmailVerification: (token) => request("/auth/verify-email/confirm", { method: "POST", body: { token }, auth: false }),
  forgotPassword: (email) => request("/auth/forgot-password", { method: "POST", body: { email }, auth: false }),
  resetPassword: (token, newPassword) => request("/auth/reset-password", { method: "POST", body: { token, newPassword }, auth: false }),
  changePassword: (currentPassword, newPassword) => request("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } }),


  // Profile / social accounts
  myProfile: () => request("/users/me/profile"),
  myAccount: () => request("/users/me/account"),
  updateMyProfile: (payload) => request("/users/me/profile", { method: "PATCH", body: payload }),
  mySocialAccounts: () => request("/users/me/social-accounts"),
  addSocialAccount: (payload) => request("/users/me/social-accounts", { method: "POST", body: payload }),
  removeSocialAccount: (id) => request(`/users/me/social-accounts/${id}`, { method: "DELETE" }),
  publicProfile: (userId) => request(`/users/${userId}/public-profile`),

  // OAuth-verified social account connections (Settings → Social Accounts)
  listSocialConnections: () => request("/social-accounts"),
  connectSocialAccount: (platform) => request(`/social-accounts/${platform}/connect`),
  syncSocialAccount: (id) => request(`/social-accounts/${id}/sync`, { method: "POST" }),
  disconnectSocialAccount: (id) => request(`/social-accounts/${id}`, { method: "DELETE" }),

  // Stripe Connect payout onboarding (creator wallet)
  getPayoutStatus: () => request("/wallet/payouts/status"),
  beginPayoutOnboarding: () => request("/wallet/payouts/onboarding", { method: "POST" }),

  listCreators: (filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== "" && v != null)).toString();
    return request(`/users/creators${qs ? `?${qs}` : ""}`);
  },

  // Campaigns
  createCampaign: (payload) => request("/campaigns", { method: "POST", body: payload }),
  updateCampaign: (id, payload) => request(`/campaigns/${id}`, { method: "PATCH", body: payload }),
  myCampaigns: () => request("/campaigns/mine"),
  marketplace: (filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== "" && v != null)).toString();
    return request(`/campaigns/marketplace${qs ? `?${qs}` : ""}`);
  },
  getCampaign: (id) => request(`/campaigns/${id}`),
  getCampaignHistory: (id) => request(`/campaigns/${id}/history`),
  checkout: (campaignId, promoCode) => request("/payments/checkout", { method: "POST", body: { campaignId, promoCode: promoCode || null } }),
  simulatePayment: (paymentId, outcome) => request("/payments/test/simulate", { method: "POST", body: { paymentId, outcome } }),
  getPayment: (id) => request(`/payments/${id}`),
  getEscrow: (campaignId) => request(`/payments/campaign/${campaignId}/escrow`),
  paymentConfig: () => request("/payments/config/public"),
  publishCampaign: (id) => request(`/campaigns/${id}/publish`, { method: "POST" }),
  cancelCampaign: (id) => request(`/campaigns/${id}/cancel`, { method: "POST" }),
  completeCampaign: (id) => request(`/campaigns/${id}/complete`, { method: "POST" }),

  // Applications
  applyToCampaign: (campaignId, payload) => request(`/campaigns/${campaignId}/applications`, { method: "POST", body: payload }),
  campaignApplications: (campaignId) => request(`/campaigns/${campaignId}/applications`),
  myApplications: () => request("/campaigns/mine/applications"),
  decideApplication: (appId, decision) => request(`/campaigns/applications/${appId}/decide`, { method: "POST", body: { decision } }),
  requestApplicationInfo: (appId, note) => request(`/campaigns/applications/${appId}/request-info`, { method: "POST", body: { note } }),
  withdrawApplication: (appId) => request(`/campaigns/applications/${appId}/withdraw`, { method: "POST" }),
  cancelAssignment: (assignmentId) => request(`/campaigns/assignments/${assignmentId}/cancel`, { method: "POST" }),

  // Deliverables (versioned proof)
  submitDeliverable: (assignmentId, payload) => request(`/campaigns/assignments/${assignmentId}/deliverables`, { method: "POST", body: payload }),
  getDeliverable: (assignmentId) => request(`/campaigns/assignments/${assignmentId}/deliverables`),
  reviewDeliverable: (assignmentId, decision, note) => request(`/campaigns/assignments/${assignmentId}/deliverables/review`, { method: "POST", body: { decision, note } }),
  openAssignmentDispute: (assignmentId, reason) => request(`/campaigns/assignments/${assignmentId}/dispute`, { method: "POST", body: { reason } }),

  // Reviews & messages
  submitReview: (appId, payload) => request(`/campaigns/applications/${appId}/reviews`, { method: "POST", body: payload }),
  getReviews: (appId) => request(`/campaigns/applications/${appId}/reviews`),
  getMessages: (appId) => request(`/campaigns/applications/${appId}/messages`),
  sendMessage: (appId, text) => request(`/campaigns/applications/${appId}/messages`, { method: "POST", body: { text } }),

  // Wallet
  getWallet: () => request("/wallet"),
  myWithdrawals: () => request("/wallet/withdrawals"),
  requestWithdrawal: (amount) => request("/wallet/withdrawals", { method: "POST", body: { amount } }),

  // Notifications
  getNotifications: () => request("/notifications"),
  markNotificationsRead: () => request("/notifications/read", { method: "POST" }),

  // Referrals
  myReferral: () => request("/referrals/mine"),

  // Admin
  adminOverview: () => request("/admin/overview"),
  adminUsers: (filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== "" && v != null)).toString();
    return request(`/admin/users${qs ? `?${qs}` : ""}`);
  },
  adminUserProfile: (id) => request(`/admin/users/${id}/profile`),
  adminUserActivity: (id) => request(`/admin/users/${id}/activity`),
  adminSuspendUser: (id) => request(`/admin/users/${id}/suspend`, { method: "POST" }),
  adminVerifyUser: (id) => request(`/admin/users/${id}/verify`, { method: "POST" }),
  adminCampaigns: () => request("/admin/campaigns"),
  adminApproveCampaign: (id) => request(`/admin/campaigns/${id}/approve`, { method: "POST" }),
  adminWithdrawals: () => request("/admin/withdrawals"),
  adminResolveWithdrawal: (id, approve) => request(`/admin/withdrawals/${id}/resolve`, { method: "POST", body: { approve } }),
  adminDisputes: () => request("/admin/disputes"),
  adminResolveDispute: (id, resolution) => request(`/admin/disputes/${id}/resolve`, { method: "POST", body: { resolution } }),
  adminTransactions: () => request("/admin/transactions"),
  adminAnalytics: () => request("/admin/analytics"),
  adminGetSettings: () => request("/admin/settings"),
  adminUpdateSettings: (payload) => request("/admin/settings", { method: "PUT", body: payload }),
  adminAddCategory: (name) => request("/admin/settings/categories", { method: "POST", body: { name } }),
  adminRemoveCategory: (name) => request(`/admin/settings/categories/${encodeURIComponent(name)}`, { method: "DELETE" }),
  adminAddPlatform: (name) => request("/admin/settings/platforms", { method: "POST", body: { name } }),
  adminRemovePlatform: (name) => request(`/admin/settings/platforms/${encodeURIComponent(name)}`, { method: "DELETE" }),
  adminPromoCodes: () => request("/admin/promo-codes"),
  adminCreatePromoCode: (payload) => request("/admin/promo-codes", { method: "POST", body: payload }),
  adminTogglePromoCode: (code) => request(`/admin/promo-codes/${code}/toggle`, { method: "POST" }),
  adminAuditLogs: () => request("/admin/audit-logs"),
};

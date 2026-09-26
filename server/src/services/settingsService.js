const { get, run, namedRun, nowIso } = require("../db");

const DEFAULTS = {
  id: "singleton",
  commission_bps: 1500,
  min_withdrawal_cents: 5000,
  max_withdrawal_cents: 500000,
  processing_fee_bps: 250,
  processing_fee_fixed_cents: 30,
  categories: JSON.stringify([
    "Tech", "Beauty", "Skincare", "Fitness", "Lifestyle", "Finance",
    "Travel", "Gaming", "Comedy", "Fashion", "Community", "Reviews",
  ]),
  platforms: JSON.stringify(["YOUTUBE", "TIKTOK", "INSTAGRAM", "FACEBOOK"]),
};

async function getSettings() {
  let row = await get("SELECT * FROM platform_settings WHERE id = 'singleton'");
  if (!row) {
    await namedRun(
      `INSERT INTO platform_settings (id, commission_bps, min_withdrawal_cents, max_withdrawal_cents, processing_fee_bps, processing_fee_fixed_cents, categories, platforms, updated_at)
       VALUES (@id, @commission_bps, @min_withdrawal_cents, @max_withdrawal_cents, @processing_fee_bps, @processing_fee_fixed_cents, @categories, @platforms, @updated_at)
       ON CONFLICT (id) DO NOTHING`,
      { ...DEFAULTS, updated_at: nowIso() }
    );
    row = await get("SELECT * FROM platform_settings WHERE id = 'singleton'");
  }
  return row;
}

/** Only admins may call this (enforced at the route layer with requireRole). */
async function updateSettings(patch) {
  const current = await getSettings();
  const next = {
    commission_bps: patch.commissionBps ?? current.commission_bps,
    min_withdrawal_cents: patch.minWithdrawalCents ?? current.min_withdrawal_cents,
    max_withdrawal_cents: patch.maxWithdrawalCents ?? current.max_withdrawal_cents,
    processing_fee_bps: patch.processingFeeBps ?? current.processing_fee_bps,
    processing_fee_fixed_cents: patch.processingFeeFixedCents ?? current.processing_fee_fixed_cents,
  };
  await namedRun(
    `UPDATE platform_settings SET commission_bps=@commission_bps, min_withdrawal_cents=@min_withdrawal_cents,
     max_withdrawal_cents=@max_withdrawal_cents, processing_fee_bps=@processing_fee_bps,
     processing_fee_fixed_cents=@processing_fee_fixed_cents, updated_at=@updated_at WHERE id='singleton'`,
    { ...next, updated_at: nowIso() }
  );
  return getSettings();
}

async function addCategory(name) {
  const s = await getSettings();
  const list = JSON.parse(s.categories);
  if (!list.includes(name)) list.push(name);
  await run("UPDATE platform_settings SET categories = ?, updated_at = ? WHERE id = 'singleton'", [JSON.stringify(list), nowIso()]);
  return list;
}
async function removeCategory(name) {
  const s = await getSettings();
  const list = JSON.parse(s.categories).filter((c) => c !== name);
  await run("UPDATE platform_settings SET categories = ?, updated_at = ? WHERE id = 'singleton'", [JSON.stringify(list), nowIso()]);
  return list;
}
async function addPlatform(name) {
  const s = await getSettings();
  const list = JSON.parse(s.platforms);
  if (!list.includes(name)) list.push(name);
  await run("UPDATE platform_settings SET platforms = ?, updated_at = ? WHERE id = 'singleton'", [JSON.stringify(list), nowIso()]);
  return list;
}
async function removePlatform(name) {
  const CORE = ["YOUTUBE", "TIKTOK", "INSTAGRAM", "FACEBOOK"];
  if (CORE.includes(name)) {
    const err = new Error("Core platforms cannot be removed");
    err.status = 400;
    throw err;
  }
  const s = await getSettings();
  const list = JSON.parse(s.platforms).filter((p) => p !== name);
  await run("UPDATE platform_settings SET platforms = ?, updated_at = ? WHERE id = 'singleton'", [JSON.stringify(list), nowIso()]);
  return list;
}

module.exports = { getSettings, updateSettings, addCategory, removeCategory, addPlatform, removePlatform };

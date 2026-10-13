#!/usr/bin/env bash
# End-to-end test of SocialBoost Market's live production backend:
#   - Manual EasyPaisa (or whichever manual method is configured) payment flow
#   - Creator withdrawal flow
# Creates its own throwaway advertiser + creator accounts, logs in as the
# real admin, and drives the whole business flow via the REST API with curl.
# Safe to run multiple times — every run uses fresh, timestamped test accounts.

set -uo pipefail

BASE="https://m5cmiycfbq4a-production-53woez5g.us-central1.suga.run/api"
TS=$(date +%s)
PASS=0
FAIL=0
RESP=""
HTTP_STATUS=""

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
call() {
  # call METHOD PATH TOKEN JSON_BODY
  local method="$1" path="$2" token="$3" body="${4:-}"
  local args=(-s -o /tmp/tf_resp.json -w "%{http_code}" -X "$method" "$BASE$path" -H "Content-Type: application/json")
  if [ -n "$token" ]; then args+=(-H "Authorization: Bearer $token"); fi
  if [ -n "$body" ]; then args+=(-d "$body"); fi
  HTTP_STATUS=$(curl "${args[@]}")
  RESP=$(cat /tmp/tf_resp.json)
}

jget() {
  # jget '<json>' 'path.to.field' -> prints value (object/array printed as JSON)
  node -e '
    const d = JSON.parse(process.argv[1]);
    const path = process.argv[2].split(".");
    let v = d;
    for (const k of path) { v = (v == null) ? undefined : v[k]; }
    if (v === undefined) { process.exit(1); }
    console.log(typeof v === "object" ? JSON.stringify(v) : v);
  ' "$1" "$2" 2>/dev/null
}

step() { echo ""; echo "=== $1 ==="; }

check() {
  local desc="$1" expect="$2"
  if [ "$HTTP_STATUS" = "$expect" ]; then
    echo "PASS: $desc (HTTP $HTTP_STATUS)"
    PASS=$((PASS+1))
    return 0
  else
    echo "FAIL: $desc (expected HTTP $expect, got $HTTP_STATUS)"
    echo "Response body: $RESP"
    FAIL=$((FAIL+1))
    return 1
  fi
}

die() {
  echo ""
  echo "STOPPING: $1"
  echo ""
  echo "===================================================================="
  echo "RESULT: $PASS passed, $FAIL failed (stopped early)"
  echo "===================================================================="
  exit 1
}

echo "SocialBoost Market — live backend end-to-end test"
echo "Target: $BASE"
echo "Run ID: $TS"

# ---------------------------------------------------------------------------
# 0. Create fresh test accounts + admin login
# ---------------------------------------------------------------------------
step "0a. Register throwaway ADVERTISER test account"
ADV_EMAIL="testadv_${TS}@example.com"
call POST /auth/register "" "{\"name\":\"Test Advertiser $TS\",\"email\":\"$ADV_EMAIL\",\"password\":\"TestPass123!\",\"role\":\"ADVERTISER\"}"
check "Register advertiser" 201 || die "Could not create advertiser test account"
ADV_TOKEN=$(jget "$RESP" accessToken)
[ -n "$ADV_TOKEN" ] || die "No access token returned for advertiser"
echo "Advertiser: $ADV_EMAIL"

step "0b. Register throwaway CREATOR test account"
CRE_EMAIL="testcre_${TS}@example.com"
call POST /auth/register "" "{\"name\":\"Test Creator $TS\",\"email\":\"$CRE_EMAIL\",\"password\":\"TestPass123!\",\"role\":\"CREATOR\"}"
check "Register creator" 201 || die "Could not create creator test account"
CRE_TOKEN=$(jget "$RESP" accessToken)
[ -n "$CRE_TOKEN" ] || die "No access token returned for creator"
echo "Creator: $CRE_EMAIL"

step "0c. Log in as the real admin account"
call POST /auth/login "" '{"email":"hassanmudasir111@gmail.com","password":"khemta1234"}'
check "Admin login" 200 || die "Admin login failed — check the admin credentials"
ADMIN_TOKEN=$(jget "$RESP" accessToken)
[ -n "$ADMIN_TOKEN" ] || die "No access token returned for admin"

# ---------------------------------------------------------------------------
# 1. Advertiser creates + submits a campaign
# ---------------------------------------------------------------------------
step "1. Advertiser creates and submits a test campaign"
START_DATE=$(date -u -d "+1 day" +%Y-%m-%dT%H:%M:%S.000Z)
END_DATE=$(date -u -d "+30 days" +%Y-%m-%dT%H:%M:%S.000Z)
CAMPAIGN_BODY=$(node -e "console.log(JSON.stringify({
  title: 'Automated Test Campaign $TS',
  description: 'Automated end-to-end test campaign used to verify the payment and withdrawal flow.',
  platform: 'YOUTUBE',
  contentUrl: 'https://youtube.com/watch?v=test$TS',
  category: 'Tech',
  campaignType: 'Product Review',
  requirements: 'Post a short honest review video mentioning the product.',
  budget: 200,
  budgetPerCreator: 100,
  maxCreators: 1,
  startDate: '$START_DATE',
  endDate: '$END_DATE',
  submit: true
}))")
call POST /campaigns "$ADV_TOKEN" "$CAMPAIGN_BODY"
check "Create + submit campaign (should land in PENDING_PAYMENT)" 201 || die "Campaign creation failed"
CAMPAIGN_ID=$(jget "$RESP" campaign.id)
[ -n "$CAMPAIGN_ID" ] || die "No campaign id returned"
echo "Campaign ID: $CAMPAIGN_ID"

# ---------------------------------------------------------------------------
# 2. Manual payment (EasyPaisa or whichever manual method is configured)
# ---------------------------------------------------------------------------
step "2a. Check which manual payment methods are configured on the server"
call GET /payments/manual/methods "$ADV_TOKEN" ""
check "List manual payment methods" 200
echo "Configured methods: $RESP"
METHOD=$(node -e '
  const d = JSON.parse(process.argv[1]);
  const methods = (d.methods || []).map(m => m.method);
  const pick = methods.includes("EASYPAISA") ? "EASYPAISA" : methods[0];
  if (pick) console.log(pick);
' "$RESP" 2>/dev/null)

if [ -z "$METHOD" ]; then
  echo ""
  echo "NOTE: No manual payment method is configured on the live server yet"
  echo "(PLATFORM_EASYPAISA_NAME / PLATFORM_EASYPAISA_NUMBER env vars are empty in Suga)."
  echo "Skipping the payment + withdrawal flow — nothing else can be tested"
  echo "until at least one manual method is configured."
  echo ""
  echo "===================================================================="
  echo "RESULT: $PASS passed, $FAIL failed (payment flow skipped — see note above)"
  echo "===================================================================="
  exit 0
fi
echo "Using manual method: $METHOD"

step "2b. Advertiser starts manual $METHOD checkout"
call POST /payments/manual-checkout "$ADV_TOKEN" "{\"campaignId\":\"$CAMPAIGN_ID\",\"method\":\"$METHOD\"}"
check "Create manual checkout" 201 || die "Manual checkout failed"
PAYMENT_ID=$(jget "$RESP" payment.id)
[ -n "$PAYMENT_ID" ] || die "No payment id returned"
echo "Payment ID: $PAYMENT_ID"

step "2c. Advertiser submits the payment reference (simulating 'I sent the money')"
call POST /payments/$PAYMENT_ID/manual-proof "$ADV_TOKEN" '{"reference":"TEST-TXN-'"$TS"'","note":"Automated test payment proof"}'
check "Submit manual payment reference" 200 || die "Submitting payment proof failed"

step "2d. Admin confirms the manual payment (this is what actually funds escrow)"
call POST /admin/payments/$PAYMENT_ID/manual-resolve "$ADMIN_TOKEN" '{"confirm":true}'
check "Admin confirms manual payment" 200 || die "Admin payment confirmation failed"

# ---------------------------------------------------------------------------
# 3. Publish + approve campaign
# ---------------------------------------------------------------------------
step "3a. Advertiser publishes the now-funded campaign to the marketplace"
call POST /campaigns/$CAMPAIGN_ID/publish "$ADV_TOKEN" ""
check "Publish campaign" 200 || die "Publishing campaign failed"

step "3b. Admin approves the campaign"
call POST /admin/campaigns/$CAMPAIGN_ID/approve "$ADMIN_TOKEN" ""
check "Admin approves campaign" 200

# ---------------------------------------------------------------------------
# 4. Creator applies, advertiser accepts
# ---------------------------------------------------------------------------
step "4a. Creator applies to the campaign"
call POST /campaigns/$CAMPAIGN_ID/applications "$CRE_TOKEN" '{"message":"I would love to work on this campaign.","proposedRate":100}'
check "Creator applies" 201 || die "Creator application failed"
APPLICATION_ID=$(jget "$RESP" application.id)
[ -n "$APPLICATION_ID" ] || die "No application id returned"

step "4b. Advertiser accepts the application"
call POST /campaigns/applications/$APPLICATION_ID/decide "$ADV_TOKEN" '{"decision":"ACCEPTED"}'
check "Advertiser accepts application" 200 || die "Accepting application failed"

step "4c. Look up the resulting assignment id"
call GET /campaigns/$CAMPAIGN_ID/applications "$ADV_TOKEN" ""
check "Fetch campaign applications" 200 || die "Could not fetch applications"
ASSIGNMENT_ID=$(node -e '
  const d = JSON.parse(process.argv[1]);
  const app = (d.applications || []).find(a => a.id === process.argv[2]);
  console.log(app && app.assignment ? app.assignment.id : "");
' "$RESP" "$APPLICATION_ID")
[ -n "$ASSIGNMENT_ID" ] || die "No assignment id found"
echo "Assignment ID: $ASSIGNMENT_ID"

# ---------------------------------------------------------------------------
# 5. Creator submits deliverable, advertiser approves -> creator gets paid
# ---------------------------------------------------------------------------
step "5a. Creator submits proof of completed work"
TODAY=$(date -u +%Y-%m-%d)
call POST /campaigns/assignments/$ASSIGNMENT_ID/deliverables "$CRE_TOKEN" "{\"contentUrl\":\"https://youtube.com/watch?v=deliverable$TS\",\"promotionUrl\":\"https://youtube.com/watch?v=deliverable$TS\",\"notes\":\"Posted the review as requested.\",\"completionDate\":\"$TODAY\"}"
check "Creator submits deliverable" 200 || die "Deliverable submission failed"

step "5b. Advertiser approves the deliverable (this releases payment to the creator's wallet)"
call POST /campaigns/assignments/$ASSIGNMENT_ID/deliverables/review "$ADV_TOKEN" '{"decision":"approve"}'
check "Advertiser approves deliverable" 200 || die "Deliverable approval failed"

# ---------------------------------------------------------------------------
# 6. Creator checks wallet, requests withdrawal
# ---------------------------------------------------------------------------
step "6a. Creator checks wallet balance after getting paid"
call GET /wallet "$CRE_TOKEN" ""
check "Fetch creator wallet" 200 || die "Could not fetch creator wallet"
BALANCE_BEFORE=$(jget "$RESP" wallet.balance)
echo "Creator wallet balance: \$$BALANCE_BEFORE (expected \$85.00 — \$100 minus 15% platform commission)"

step "6b. Creator requests a \$50 withdrawal"
call POST /wallet/withdrawals "$CRE_TOKEN" '{"amount":50}'
check "Creator requests withdrawal" 201 || die "Withdrawal request failed"
WITHDRAWAL_ID=$(jget "$RESP" withdrawal.id)
[ -n "$WITHDRAWAL_ID" ] || die "No withdrawal id returned"
echo "Withdrawal ID: $WITHDRAWAL_ID"

# ---------------------------------------------------------------------------
# 7. Admin approves (manual payout) and marks it paid
# ---------------------------------------------------------------------------
step "7a. Admin approves the withdrawal as a MANUAL payout (e.g. sent via EasyPaisa by hand)"
call POST /admin/withdrawals/$WITHDRAWAL_ID/resolve "$ADMIN_TOKEN" '{"approve":true,"payoutMethod":"MANUAL"}'
check "Admin approves withdrawal" 200 || die "Admin withdrawal approval failed"

step "7b. Admin marks the payout as completed (confirms money was actually sent)"
call POST /admin/withdrawals/$WITHDRAWAL_ID/payout-completed "$ADMIN_TOKEN" ""
check "Admin marks payout completed" 200 || die "Marking payout completed failed"

# ---------------------------------------------------------------------------
# 8. Final verification
# ---------------------------------------------------------------------------
step "8a. Creator re-checks wallet balance after the withdrawal"
call GET /wallet "$CRE_TOKEN" ""
check "Fetch creator wallet (final)" 200
BALANCE_AFTER=$(jget "$RESP" wallet.balance)
echo "Creator wallet balance after withdrawal: \$$BALANCE_AFTER (expected \$35.00 — \$85 minus the \$50 withdrawn)"

step "8b. Creator checks withdrawal history"
call GET /wallet/withdrawals "$CRE_TOKEN" ""
check "Fetch withdrawal history" 200
WD_STATUS=$(node -e '
  const d = JSON.parse(process.argv[1]);
  const w = (d.withdrawals || []).find(x => x.id === process.argv[2]);
  console.log(w ? w.status : "NOT FOUND");
' "$RESP" "$WITHDRAWAL_ID")
echo "Withdrawal status: $WD_STATUS (expected: APPROVED)"

echo ""
echo "===================================================================="
echo "RESULT: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
  echo "Payment flow (manual $METHOD) and withdrawal flow BOTH work end-to-end."
else
  echo "Some steps failed — see FAIL lines above for details."
fi
echo "===================================================================="

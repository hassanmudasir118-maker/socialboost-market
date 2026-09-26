const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.PAYMENT_SECRET_KEY = process.env.PAYMENT_SECRET_KEY || "sk_test_unused_by_these_tests";
const stripeProvider = require("../src/services/paymentProvider/stripeProvider");

function sign(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

test("accepts a correctly signed payload", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
  assert.equal(stripeProvider.verifyWebhookSignature(body, sign(body, secret), secret), true);
});

test("rejects a tampered body", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
  const header = sign(body, secret);
  assert.equal(stripeProvider.verifyWebhookSignature(body + "tampered", header, secret), false);
});

test("rejects the wrong secret", () => {
  const body = JSON.stringify({ id: "evt_1" });
  const header = sign(body, "whsec_correct");
  assert.equal(stripeProvider.verifyWebhookSignature(body, header, "whsec_wrong"), false);
});

test("rejects a missing signature header", () => {
  assert.equal(stripeProvider.verifyWebhookSignature("{}", null, "whsec_x"), false);
  assert.equal(stripeProvider.verifyWebhookSignature("{}", undefined, "whsec_x"), false);
  assert.equal(stripeProvider.verifyWebhookSignature("{}", "", "whsec_x"), false);
});

test("rejects a malformed signature header without throwing", () => {
  assert.equal(stripeProvider.verifyWebhookSignature("{}", "not-a-real-header", "whsec_x"), false);
  assert.equal(stripeProvider.verifyWebhookSignature("{}", "t=123", "whsec_x"), false); // missing v1
  assert.equal(stripeProvider.verifyWebhookSignature("{}", "v1=abc", "whsec_x"), false); // missing t
});

test("rejects a v1 value that isn't valid hex without throwing", () => {
  assert.equal(stripeProvider.verifyWebhookSignature("{}", "t=123,v1=not-hex-zz", "whsec_x"), false);
});

test("a signature computed for a different secret's payload is not accidentally valid for this one (sanity check against false positives)", () => {
  const bodyA = JSON.stringify({ id: "evt_a" });
  const bodyB = JSON.stringify({ id: "evt_b" });
  const header = sign(bodyA, "whsec_1");
  assert.equal(stripeProvider.verifyWebhookSignature(bodyB, header, "whsec_1"), false);
});

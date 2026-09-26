const mockProvider = require("./mockProvider");
const stripeProvider = require("./stripeProvider");

// To add a real provider (e.g. Stripe): write stripeProvider.js implementing
// the same five functions as mockProvider.js, add it to this map, and set
// PAYMENT_PROVIDER=stripe in .env. Nothing else in the codebase changes.
// (stripeProvider.js now exists — set PAYMENT_PROVIDER=stripe and configure
// PAYMENT_SECRET_KEY/PAYMENT_WEBHOOK_SECRET with real Stripe values to use it.
// Payouts additionally require Stripe Connect onboarding — see that file's
// createPayout() comments.)
const PROVIDERS = { mock: mockProvider, stripe: stripeProvider };

function getProvider() {
  const name = process.env.PAYMENT_PROVIDER || "mock";
  if (process.env.NODE_ENV === "production" && name === "mock") {
    throw new Error("Production payment provider is not configured. Set PAYMENT_PROVIDER to a real provider adapter before starting production.");
  }
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown PAYMENT_PROVIDER "${name}"`);
  return provider;
}

module.exports = { getProvider };

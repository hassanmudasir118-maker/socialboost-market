const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Encrypts OAuth access/refresh tokens before they touch the database, and
// decrypts them only at the point of use (calling a provider's API). Tokens
// are never returned in any API response and never logged — see
// socialAccountService.js and socialProviders/*, which are the only callers
// of decrypt() in the whole codebase.
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM

function loadKey() {
  const raw = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SOCIAL_TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it in server/.env — see .env.example."
    );
  }
  // Accept base64 or hex, whichever the operator generated it as.
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }
  if (key.length !== 32) {
    throw new Error(
      `SOCIAL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256 (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`
    );
  }
  return key;
}

// Loaded lazily (not at module load) so a missing key only breaks the
// social-account feature, not the entire process, in an environment that
// hasn't configured it yet — the routes/service surface a clear
// configuration error instead (see §15 of the OAuth brief).
let cachedKey = null;
function getKey() {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

/** Returns true if the encryption key is present and valid, without throwing. Used for "is this feature configured" checks. */
function isEncryptionConfigured() {
  try {
    getKey();
    return true;
  } catch (_) {
    return false;
  }
}

/** Encrypts a UTF-8 string. Returns a single string: base64(iv):base64(authTag):base64(ciphertext). */
function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Reverses encrypt(). Throws if the ciphertext was tampered with (auth tag check) or the key is wrong/missing. */
function decrypt(encoded) {
  if (encoded == null) return null;
  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = String(encoded).split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error("Malformed encrypted token payload");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

module.exports = { encrypt, decrypt, isEncryptionConfigured };

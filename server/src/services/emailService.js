/**
 * No real email provider is connected yet (see README "Remaining
 * configuration"). In production, replace the body of these functions with a
 * call to a transactional email provider (Postmark, SES, SendGrid, etc).
 *
 * For now, in development, the email "send" is logged to the server console
 * AND the raw token/link is returned directly in the API response so the
 * full flow (registration → verify, forgot → reset) can be tested without a
 * mail server. This must be removed once a real provider is wired up —
 * returning the token in the response is only safe in development.
 */
function sendVerificationEmail(email, token) {
  const link = `${process.env.APP_URL || "http://localhost:5173"}/verify-email?token=${token}`;
  console.log(`[DEV EMAIL] Verification link for ${email}: ${link}`);
  return link;
}

function sendPasswordResetEmail(email, token) {
  const link = `${process.env.APP_URL || "http://localhost:5173"}/reset-password?token=${token}`;
  console.log(`[DEV EMAIL] Password reset link for ${email}: ${link}`);
  return link;
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };

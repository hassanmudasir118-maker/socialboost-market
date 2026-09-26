// Express 4 does not catch rejected promises from async route handlers —
// an unhandled rejection there just hangs the request. Wrapping every
// async handler with this forwards the error to the centralized error
// handler in app.js instead.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };

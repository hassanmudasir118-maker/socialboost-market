class ConfigurationError extends Error {
  constructor(platform) {
    super(`${platform} OAuth is not configured on this server. An administrator needs to set the ${platform}_CLIENT_ID/SECRET/REDIRECT_URI environment variables.`);
    this.name = "ConfigurationError";
    this.status = 503;
  }
}
class RefreshNotSupportedError extends Error {
  constructor(platform) {
    super(`${platform} does not support silent token refresh — the user must reconnect once the token expires.`);
    this.name = "RefreshNotSupportedError";
  }
}
class RefreshFailedError extends Error {
  constructor(platform, cause) {
    super(`Refreshing the ${platform} token failed${cause ? `: ${cause}` : ""}.`);
    this.name = "RefreshFailedError";
  }
}
class ProviderApiError extends Error {
  constructor(platform, cause) {
    super(`${platform} API request failed${cause ? `: ${cause}` : ""}.`);
    this.name = "ProviderApiError";
  }
}

module.exports = { ConfigurationError, RefreshNotSupportedError, RefreshFailedError, ProviderApiError };

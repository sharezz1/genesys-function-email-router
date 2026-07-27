/**
 * OAuth 2.0 client-credentials used to authenticate against the Genesys Cloud Platform API.
 *
 * Genesys Cloud Functions run inside a Genesys-owned AWS account with no IAM access, so there is
 * no ambient credential available to the function. Every invocation must authenticate itself,
 * and these values must therefore be supplied by the data action configuration.
 */
export type Credentials = {
  /**
   * Base URL of the Genesys Cloud region hosting the organization.
   *
   * @example "https://api.mypurecloud.com"
   */
  readonly host: string;

  /** OAuth 2.0 client ID issued by Genesys Cloud. */
  readonly clientId: string;

  /**
   * OAuth 2.0 client secret paired with {@linkcode Credentials.clientId}.
   *
   * Never log this value. The client secret reaches the function through the data action
   * configuration, and a secret written to console output is a secret you can no longer account
   * for — you cannot read those logs back to check what leaked into them.
   */
  readonly clientSecret: string;
};

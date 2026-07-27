/**
 * Enum representing various routing actions that can be performed.
 */
export enum RoutingDecision {
  /** Disconnect the current interaction */
  Disconnect = "disconnect",

  /** No matching rule or action was found */
  None = "none",

  /** Transfer the interaction to an external email */
  TransferToEmail = "transfer_email",

  /** Transfer the interaction to a queue */
  TransferToQueue = "transfer_queue",

  /** Transfer the interaction to a specific Architect state */
  TransferToState = "transfer_state",
}

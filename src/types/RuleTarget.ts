/**
 * Specifies the type of target that a rule action can apply to.
 * The target type determines how and where the action is executed.
 */
export enum RuleTarget {
  /**
   * The action target is an e-mail address or mailbox.
   * Typically used with the `Forward` action.
   */
  Email = "email",

  /**
   * The action target is a routing queue.
   * Used for directing the interaction to a specific queue.
   */
  Queue = "queue",

  /**
   * The action target is a named flow state.
   * Used for transitioning control to a specific flow branch or logic state.
   */
  State = "state",
}

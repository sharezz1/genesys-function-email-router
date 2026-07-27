import type { RuleAction } from "./RuleAction.ts";
import type { RuleTarget } from "./RuleTarget.ts";

/**
 * Defines a routing rule with matching conditions and execution behavior.
 * Each rule may include filters, actions, targets, and metadata.
 */
export type Rule = Readonly<{
  /**
   * Unique identifier for the rule.
   * Used for logging, auditing, or linking rules to decisions.
   */
  key: string;

  /**
   * Optional filter condition expression in string form.
   * If provided, it must evaluate to true for the rule to apply.
   */
  filter?: string;

  /**
   * The action to perform when the rule matches.
   * Defines how the routing system responds.
   */
  action: RuleAction;

  /**
   * Optional type of the target used by the action (e.g., queue, flow).
   */
  targetType?: RuleTarget;

  /**
   * Optional name or ID of the target (e.g., queue name, flow name).
   */
  targetName?: string;

  /**
   * Optional priority value assigned to the routed interaction.
   */
  priority?: number;

  /**
   * Optional skill name to be applied during routing.
   */
  skill?: string;

  /**
   * Optional library name for predefined response templates.
   */
  responseLibrary?: string;

  /**
   * Optional template name used to generate the response.
   */
  responseName?: string;

  /**
   * Indicates whether the rule is active and should be evaluated.
   */
  enabled: boolean;

  /**
   * Optional human-readable description of the rule's purpose.
   */
  description?: string;
}>;

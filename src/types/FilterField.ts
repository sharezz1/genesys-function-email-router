/**
 * Specifies the available fields that can be referenced in filter expressions.
 * These correspond to properties of the routing context for an e-mail.
 */
export enum FilterField {
  /**
   * The sender's e-mail address.
   * Example: `from = "alice@company.com"`
   */
  From = "from",

  /**
   * The address designated to receive replies.
   * Example: `replyTo = "support@company.com"`
   */
  ReplyTo = "replyto",

  /**
   * The list of primary recipients (TO).
   * Example: `to ∩ ("team@corp.com")`
   */
  To = "to",

  /**
   * The list of carbon copy (CC) recipients.
   * Example: `cc ~ "manager"`
   */
  Cc = "cc",

  /**
   * The list of blind carbon copy (BCC) recipients.
   * Example: `bcc !~ "audit"`
   */
  Bcc = "bcc",

  /**
   * The subject line of the e-mail.
   * Example: `subject ~ "invoice"`
   */
  Subject = "subject",

  /**
   * The full body content of the e-mail (plain text or preview).
   * Example: `body !~ "unsubscribe"`
   */
  Body = "body",

  /**
   * The list of attachment filenames included in the e-mail.
   * Example: `attachments * "*.pdf"`
   */
  Attachments = "attachments",
}

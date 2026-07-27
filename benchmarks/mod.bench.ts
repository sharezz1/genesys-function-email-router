import type platformClient from "purecloud-platform-client-v2";
import { compileFilter } from "../src/filters/compile.ts";
import { evaluateFilter } from "../src/filters/evaluate.ts";
import { tokenizeFilter } from "../src/filters/tokenize.ts";
import type { RoutingContext } from "../src/types/RoutingContext.ts";

/**
 * The filter language is what these benchmarks measure, and deliberately not the handler.
 *
 * The handler's wall-clock is dominated by Platform API round trips, which a benchmark can only
 * measure by either hitting a live org or stubbing the calls away — the first is not reproducible
 * and the second measures nothing. Filter evaluation is the part that is genuinely this function's
 * own work, it runs once per rule per email, and it is the only part that can grow without anyone
 * noticing: a rule set is edited in a datatable, not in a pull request.
 */

const SIMPLE = 'subject ~ "invoice"';

const TYPICAL = 'from !* "*noreply*" AND (subject ~ "invoice" OR subject ~ "receipt")';

const COMPLEX = '(from = "vip@example.com" OR replyTo * "support*@example.com") AND ' +
  'subject ~= "invoice [0-9]{4}" AND attachments * "*.pdf" AND ' +
  'to ∩ ("billing@example.com", "finance@example.com") AND body !~ "unsubscribe"';

const message: platformClient.Models.EmailMessage = {
  id: "message-0001",
  from: { email: "customer@example.net", name: "A Customer" },
  replyTo: { email: "support@example.com", name: "Support" },
  to: [{ email: "billing@example.com", name: "Billing" }],
  cc: [],
  bcc: [],
  subject: "Invoice 2026 attached",
  textBody: "Please find the invoice attached.",
  attachments: [{ attachmentId: "attachment-0001", name: "invoice.pdf" }],
};

const context = { message } as RoutingContext;

const compiled = compileFilter(COMPLEX);

Deno.bench("tokenize — typical filter", () => {
  for (const _token of tokenizeFilter(TYPICAL)) {
    // Draining the iterator is the work; the tokens themselves are not the point.
  }
});

Deno.bench("compile — simple filter", () => {
  compileFilter(SIMPLE);
});

Deno.bench("compile — typical filter", () => {
  compileFilter(TYPICAL);
});

Deno.bench("compile — complex filter", () => {
  compileFilter(COMPLEX);
});

Deno.bench("evaluate — pre-compiled complex filter", () => {
  evaluateFilter(context, compiled);
});

Deno.bench("evaluate — complex filter, parsed each time", () => {
  evaluateFilter(context, COMPLEX);
});

Deno.bench("evaluate — 50-rule table, parsed each time", () => {
  for (let index = 0; index < 50; index++) {
    evaluateFilter(context, TYPICAL);
  }
});

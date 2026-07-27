import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createLambdaContext } from "./fixtures.ts";

/**
 * The budget a Genesys data action is given, and the number the fixture's context reports.
 *
 * Genesys permits 1–15 seconds and stops a function that exceeds its configured timeout, so this is
 * the ceiling: a function never has more, whatever else the platform is doing.
 */
const ACTION_TIMEOUT_MS = 15_000;

describe("Fixtures => Lambda Context => createLambdaContext()", () => {
  it("reports the platform ceiling as the time remaining", () => {
    assertEquals(createLambdaContext().getRemainingTimeInMillis(), ACTION_TIMEOUT_MS);
  });

  it("carries the legacy callback API as inert no-ops", () => {
    const context = createLambdaContext();

    context.done();
    context.fail("ignored");
    context.succeed("ignored");

    // `done`, `fail` and `succeed` are the Node 0.10 callback API that `Context` still declares.
    // Genesys invokes the function for the promise it returns, so nothing under test reaches for
    // them — but the fixture still has to supply all three, because a context that omits them
    // type-checks through the `Context` annotation and then fails at the call site as "not a
    // function". Calling them is what proves they are present, and reaching the assertion below is
    // what proves they are harmless.
    assertEquals(
      [typeof context.done, typeof context.fail, typeof context.succeed],
      ["function", "function", "function"],
    );
  });
});

import type platformClient from "purecloud-platform-client-v2";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { restore, stub } from "@std/testing/mock";
import { createMockRoutingContext } from "../fixtures.ts";
import { getLibraries, getResponseByName, getResponses } from "../../src/genesys/responses.ts";

describe("Genesys => Response Management => getLibraries()", () => {
  const context = createMockRoutingContext();

  afterEach(() => {
    restore();
  });

  it("returns all libraries from a single page", async () => {
    const mockLibraries = Array.from({ length: 3 }, (_, i) => ({
      id: `lib-${i}`,
      name: `Library ${i}`,
    }));

    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      () =>
        Promise.resolve({
          entities: mockLibraries,
          pageCount: 1,
        }),
    );

    const libraries = await getLibraries(context);
    assertEquals(libraries.length, 3);

    const first = libraries[0];
    const second = libraries[1];
    assertExists(first);
    assertExists(second);
    assertEquals(first.id, "lib-0");
    assertEquals(second.name, "Library 1");
  });

  it("handles pagination across multiple pages", async () => {
    const page1 = [
      { id: "lib-0", name: "Library 0" },
      { id: "lib-1", name: "Library 1" },
    ];
    const page2 = [
      { id: "lib-2", name: "Library 2" },
    ];

    let callCount = 0;
    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      (opts?: { pageSize?: number; pageNumber?: number }) => {
        callCount++;
        return Promise.resolve({
          entities: opts?.pageNumber === 1 ? page1 : page2,
          pageCount: 2,
        });
      },
    );

    const libraries = await getLibraries(context);
    assertEquals(libraries.length, 3);
    assertEquals(callCount, 2);
    assertEquals(libraries.map((library) => library.id), ["lib-0", "lib-1", "lib-2"]);
  });

  it("returns an empty array if no libraries exist", async () => {
    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      () =>
        Promise.resolve({
          entities: [],
          pageCount: 1,
        }),
    );

    const libraries = await getLibraries(context);
    assertEquals(libraries.length, 0);
  });
});

describe("Genesys => Response Management => getResponses()", () => {
  const context = createMockRoutingContext();
  const page1 = [
    {
      id: "resp-1",
      name: "Response 1",
      libraries: [],
      texts: [],
    },
  ];
  const page2 = [
    {
      id: "resp-2",
      name: "Response 2",
      libraries: [],
      texts: [],
    },
  ];

  let callCount = 0;

  beforeEach(() => {
    callCount = 0;
    stub(
      context.responseManagementApi,
      "getResponsemanagementResponses",
      (_libraryId: string, opts?: { pageSize?: number; pageNumber?: number }) => {
        callCount++;
        const entities = opts?.pageNumber === 1 ? page1 : page2;
        return Promise.resolve(
          {
            entities,
            pageCount: 2,
          } satisfies platformClient.Models.ResponseEntityListing,
        );
      },
    );
  });

  afterEach(() => {
    restore();
  });

  it("returns all responses from all pages", async () => {
    const responses = await getResponses("lib-123", context);
    assertEquals(responses.length, 2);
    assertEquals(responses.map((response) => response.id), ["resp-1", "resp-2"]);
  });

  it("calls the API for each page", async () => {
    await getResponses("lib-456", context);
    assertEquals(callCount, 2);
  });

  it("respects the library ID", async () => {
    let calledWith = "";
    restore();
    stub(
      context.responseManagementApi,
      "getResponsemanagementResponses",
      (libraryId: string) => {
        calledWith = libraryId;
        return Promise.resolve({ entities: [], pageCount: 1 } satisfies platformClient.Models.ResponseEntityListing);
      },
    );

    await getResponses("custom-lib-id", context);
    assertEquals(calledWith, "custom-lib-id");
  });
});

describe("Genesys => Response Management => getResponseByName()", () => {
  const context = createMockRoutingContext();

  const mockLibraries = [
    { id: "lib-1", name: "Billing Responses" },
    { id: "lib-2", name: "General Auto-Replies" },
  ];

  const mockResponses = [
    {
      id: "resp-1",
      name: "Invoice Reminder",
      libraries: [],
      texts: [],
    },
    {
      id: "resp-2",
      name: "Payment Confirmation",
      libraries: [],
      texts: [],
    },
  ];

  beforeEach(() => {
    stub(
      context.responseManagementApi,
      "getResponsemanagementLibraries",
      () =>
        Promise.resolve({
          entities: mockLibraries,
          pageCount: 1,
        }),
    );

    stub(
      context.responseManagementApi,
      "getResponsemanagementResponses",
      (libraryId: string) =>
        Promise.resolve(
          {
            entities: libraryId === "lib-1" ? mockResponses : [],
            pageCount: 1,
          } satisfies platformClient.Models.ResponseEntityListing,
        ),
    );
  });

  afterEach(() => restore());

  it("returns the matching response from the specified library", async () => {
    const result = await getResponseByName("Invoice Reminder", "Billing Responses", context);
    assertEquals(result.id, "resp-1");
    assertEquals(result.name, "Invoice Reminder");
  });

  it("throws if the specified library is not found", async () => {
    await assertRejects(
      () => getResponseByName("Invoice Reminder", "Unknown Library", context),
      Error,
      "Library with name Unknown Library not found",
    );
  });

  it("throws if the specified response is not found in the library", async () => {
    await assertRejects(
      () => getResponseByName("Nonexistent Response", "Billing Responses", context),
      Error,
      "Response with name Nonexistent Response not found in library Billing Responses",
    );
  });

  it("throws if the library exists but has no responses at all", async () => {
    await assertRejects(
      () => getResponseByName("Invoice Reminder", "General Auto-Replies", context),
      Error,
      "Response with name Invoice Reminder not found in library General Auto-Replies",
    );
  });
});

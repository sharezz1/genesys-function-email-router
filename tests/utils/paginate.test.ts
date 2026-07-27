import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { paginate } from "../../src/utils/paginate.ts";

/** One page of results, shaped the way the Platform API returns listings. */
type Page<T> = { entities?: T[]; pageCount?: number };

describe("Utils => Pagination => paginate", () => {
  it("should return every entity of a single page", async () => {
    const fetchPage = (): Promise<Page<string>> => Promise.resolve({ entities: ["a", "b"], pageCount: 1 });

    const result = await paginate<string>(fetchPage);
    assertEquals(result, ["a", "b"]);
  });

  it("should paginate strings across multiple pages", async () => {
    const fetchPage = (page: number): Promise<Page<string>> =>
      Promise.resolve({
        entities: page === 1 ? ["a", "b"] : ["c"],
        pageCount: 2,
      });

    const result = await paginate<string>(fetchPage);
    assertEquals(result, ["a", "b", "c"]);
  });

  it("should paginate numbers with explicit generic type", async () => {
    const fetchPage = (page: number): Promise<Page<number>> =>
      Promise.resolve({
        entities: [page * 10, page * 10 + 1],
        pageCount: 2,
      });

    const result = await paginate<number>(fetchPage);
    assertEquals(result, [10, 11, 20, 21]);
  });

  it("should paginate objects and maintain structure", async () => {
    type User = { id: number; name: string };

    const fetchPage = (page: number): Promise<Page<User>> =>
      Promise.resolve({
        entities: [
          { id: page * 1, name: `User${page * 1}` },
          { id: page * 2, name: `User${page * 2}` },
        ],
        pageCount: 2,
      });

    const result = await paginate<User>(fetchPage);
    assertEquals(result, [
      { id: 1, name: "User1" },
      { id: 2, name: "User2" },
      { id: 2, name: "User2" },
      { id: 4, name: "User4" },
    ]);
  });

  it("should accept and use strongly typed options object", async () => {
    type Item = { label: string };
    type Options = { prefix: string };

    const fetchPage = (
      page: number,
      _size: number,
      options: Options,
    ): Promise<Page<Item>> => Promise.resolve({ entities: [{ label: `${options.prefix}-${page}` }], pageCount: 2 });

    const result = await paginate<Item, Options>(fetchPage, { prefix: "P" });
    assertEquals(result, [{ label: "P-1" }, { label: "P-2" }]);
  });

  it("should pass the options through to fetchPage unchanged on every page", async () => {
    type Options = { prefix: string };
    const options: Options = { prefix: "P" };
    const seen: Options[] = [];

    const fetchPage = (_page: number, _size: number, received: Options): Promise<Page<string>> => {
      seen.push(received);
      return Promise.resolve({ entities: [], pageCount: 2 });
    };

    await paginate<string, Options>(fetchPage, options);

    assertEquals(seen.length, 2);
    for (const received of seen) {
      assertStrictEquals(received, options);
    }
  });

  it("should default the options to an empty object when none is given", async () => {
    const seen: unknown[] = [];

    const fetchPage = (_page: number, _size: number, options: unknown): Promise<Page<string>> => {
      seen.push(options);
      return Promise.resolve({ entities: [], pageCount: 1 });
    };

    await paginate<string>(fetchPage);

    assertEquals(seen, [{}]);
  });

  it("should request the Platform API maximum page size of 100", async () => {
    const sizes: number[] = [];

    const fetchPage = (_page: number, pageSize: number): Promise<Page<string>> => {
      sizes.push(pageSize);
      return Promise.resolve({ entities: [], pageCount: 3 });
    };

    await paginate<string>(fetchPage);

    assertEquals(sizes, [100, 100, 100]);
  });

  it("should request pages in order, starting at page one", async () => {
    const pages: number[] = [];

    const fetchPage = (pageNumber: number): Promise<Page<string>> => {
      pages.push(pageNumber);
      return Promise.resolve({ entities: [], pageCount: 3 });
    };

    await paginate<string>(fetchPage);

    assertEquals(pages, [1, 2, 3]);
  });

  it("should default to empty array if no entities returned", async () => {
    const fetchPage = (): Promise<Page<string>> => Promise.resolve({ pageCount: 1 });

    const result = await paginate<string>(fetchPage);
    assertEquals(result, []);
  });

  it("should handle pageCount = 0 (treated as 1)", async () => {
    const fetchPage = (): Promise<Page<string>> => Promise.resolve({ entities: ["fallback"], pageCount: 0 });

    const result = await paginate<string>(fetchPage);
    assertEquals(result, ["fallback"]);
  });

  it("should skip pages where entities is undefined", async () => {
    const fetchPage = (page: number): Promise<Page<string>> =>
      Promise.resolve(page === 2 ? { pageCount: 3 } : { entities: [`page-${page}`], pageCount: 3 });

    const result = await paginate<string>(fetchPage);
    assertEquals(result, ["page-1", "page-3"]);
  });

  it("should collect an empty array if all pages return no data", async () => {
    const fetchPage = (): Promise<Page<string>> => Promise.resolve({ entities: [], pageCount: 3 });

    const result = await paginate<string>(fetchPage);
    assertEquals(result, []);
  });

  it("should not enter an infinite loop when pageCount is missing every time", async () => {
    let callCount = 0;

    const fetchPage = (): Promise<Page<string>> => {
      callCount++;
      return Promise.resolve({ entities: ["data"] }); // no pageCount
    };

    const result = await paginate<string>(fetchPage);
    assertEquals(result, ["data"]);
    assertEquals(callCount, 1); // it stops at page 1
  });

  it("should respect non-sequential page data and still aggregate", async () => {
    const fetchPage = (page: number): Promise<Page<number>> =>
      Promise.resolve({
        entities: page === 2 ? [999] : [page],
        pageCount: 3,
      });

    const result = await paginate<number>(fetchPage);
    assertEquals(result, [1, 999, 3]);
  });

  it("should throw if fetchPage throws", async () => {
    const fetchPage = (): Promise<Page<string>> => Promise.reject(new Error("Unexpected failure"));

    await assertRejects(
      () => paginate<string>(fetchPage),
      Error,
      "Unexpected failure",
    );
  });

  it("should allow empty results when pageCount is undefined", async () => {
    const fetchPage = (): Promise<Page<string>> => Promise.resolve({});

    const result = await paginate<string>(fetchPage);
    assertEquals(result, []);
  });
});

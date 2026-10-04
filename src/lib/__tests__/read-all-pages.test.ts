import { expect, it } from "vitest";
import { readAllPages } from "@/lib/read-all-pages";

it("includes results beyond the database page limit without duplicates", async () => {
  const rows = [1, 2, 3, 4, 5];
  expect(await readAllPages(async (from, to) => ({ data: rows.slice(from, to + 1), error: null }), 2)).toEqual(rows);
});
it("does not report a partial list as complete after a failed page", async () => {
  await expect(readAllPages(async (from) => from ? { data: null, error: new Error("DB unavailable") } : { data: [1, 2], error: null }, 2)).rejects.toThrow("Unable to load data");
});

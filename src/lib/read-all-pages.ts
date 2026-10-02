/** Read ordered database results without silently accepting the API's row cap. */
export async function readAllPages<T>(readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, pageSize = 500): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error || !data) throw new Error("Unable to load assignments. Please try again.");
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

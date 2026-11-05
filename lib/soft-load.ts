/** Run a page-level read; on any throw return the fallback so one broken card never 500s the whole page. */
export async function softLoad<T>(read: () => Promise<T>, fallback: T | (() => T)): Promise<T> {
  try {
    return await read()
  } catch (err) {
    console.error("[settings] soft-load failed:", err instanceof Error ? err.message : err)
    return typeof fallback === "function" ? (fallback as () => T)() : fallback
  }
}

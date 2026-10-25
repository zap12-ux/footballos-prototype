/**
 * Web Worker: sha256 of a File with `crypto.subtle.digest`. Runs off the main thread so a
 * multi-hundred-megabyte read does not freeze the page. `digest` needs the whole buffer in
 * memory, which is why the caller only uses this below a size limit (see `sha256.ts`).
 */
export interface HashRequest {
  file: File;
}
export type HashResponse = { ok: true; sha256: string } | { ok: false; reason: string };

self.onmessage = async (event: MessageEvent<HashRequest>) => {
  try {
    const buffer = await event.data.file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    (self as unknown as Worker).postMessage({ ok: true, sha256 } satisfies HashResponse);
  } catch (error) {
    (self as unknown as Worker).postMessage({ ok: false, reason: error instanceof Error ? error.message : String(error) } satisfies HashResponse);
  }
};

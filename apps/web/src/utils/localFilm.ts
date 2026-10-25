/**
 * Holds an object URL for a coach-selected local file for the life of the page.
 * The file never leaves the browser and is never analyzed.
 */
let url: string | null = null;

export function setLocalFilmUrl(next: string | null) {
  if (url && url !== next && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
  url = next;
}

export function getLocalFilmUrl(): string | null {
  return url;
}

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Node 22+ ships an experimental global `localStorage` that shadows jsdom's and
 * throws "getItem is not a function" unless a storage file is configured. Install
 * a plain in-memory Storage so the tests exercise the same code path a browser does.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

function broken(candidate: unknown): boolean {
  try {
    return !candidate || typeof (candidate as Storage).getItem !== 'function';
  } catch {
    return true;
  }
}

function install(target: object) {
  let current: unknown;
  try {
    current = (target as { localStorage?: unknown }).localStorage;
  } catch {
    current = undefined;
  }
  if (broken(current)) {
    Object.defineProperty(target, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}

install(globalThis);
if (typeof window !== 'undefined' && window !== (globalThis as unknown as Window)) {
  install(window);
}

// jsdom does not implement scrolling; the app calls it on screen changes.
Object.defineProperty(window, 'scrollTo', { value: () => undefined, configurable: true, writable: true });

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  // The app writes #/demo or #/research to the URL; start every test from the landing route.
  window.history.replaceState(null, '', window.location.pathname);
});

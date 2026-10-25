import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Node 22+ ships an experimental global `localStorage` that shadows jsdom's and throws
 * unless a storage file is configured. Install a plain in-memory Storage for both
 * localStorage and sessionStorage so tests exercise the browser code path.
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

function install(target: object, name: 'localStorage' | 'sessionStorage') {
  let current: unknown;
  try {
    current = (target as Record<string, unknown>)[name];
  } catch {
    current = undefined;
  }
  if (broken(current)) {
    Object.defineProperty(target, name, { value: new MemoryStorage(), configurable: true, writable: true });
  }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  install(globalThis, name);
  if (typeof window !== 'undefined' && window !== (globalThis as unknown as Window)) install(window, name);
}

// React Flow measures nodes with ResizeObserver, which jsdom lacks.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: RO, configurable: true, writable: true });
}
if (typeof window !== 'undefined' && !window.DOMMatrixReadOnly) {
  class DM {
    m22 = 1;
    constructor(_t?: string) {}
  }
  Object.defineProperty(window, 'DOMMatrixReadOnly', { value: DM, configurable: true, writable: true });
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', window.location.pathname);
});

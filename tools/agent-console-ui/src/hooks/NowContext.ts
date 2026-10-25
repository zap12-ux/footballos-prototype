import { createContext, useContext } from 'react';

/** Server-referenced "now" (ISO) ticking once a second; read by leaf components for relative times. */
export const NowContext = createContext<string>(new Date().toISOString());

export function useNow(): string {
  return useContext(NowContext);
}

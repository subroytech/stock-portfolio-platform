import { createContext, useContext } from 'react';

// Lets any tab (Contrarian Finder / Contrarian Comeback's missing-key error
// messages) open the API Keys modal directly, now that /subscriptions is no
// longer a navigable route - TabShell provides the real implementation;
// the no-op default only matters for pages rendered in isolation (tests).
export const ApiKeysModalContext = createContext<{ open: () => void }>({ open: () => {} });

export function useApiKeysModal() {
  return useContext(ApiKeysModalContext);
}

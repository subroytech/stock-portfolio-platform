import { createContext, useContext, useEffect, useRef } from 'react';

// Lets any tab "launch" a ticker on another tab (e.g. a Contrarian Finder
// row triggering Long-Term Analysis) without unmounting either - the target
// page's own hooks just react to a context change. Follows the same
// Context+Provider-in-TabShell pattern as apiKeysModal.ts.
//
// Note: TabShell.tsx's `launch()` guarantees the target tab is already
// mounted (via visitedTabs) BEFORE ever dispatching a handoff to it - tabs
// are lazily mounted on first visit (2026-09-18), so without that ordering
// the target page could mount for the first time in the same instant it
// receives the handoff, landing inside React StrictMode's dev-only
// double-invoke window and silently losing the mutation's result (a real
// bug found live 2026-09-19). This module's own `useIncomingTicker` doesn't
// need to know about that - it just assumes (correctly, given the above)
// that it's always reacting to an update on an already-mounted page.
export type HandoffTarget = 'long-term-analysis' | 'contrarian-comeback';

export interface TickerHandoff {
  target: HandoffTarget;
  symbol: string;
  requestId: number;
}

interface TickerHandoffContextValue {
  handoff: TickerHandoff | null;
  launch: (target: HandoffTarget, symbol: string) => void;
}

export const TickerHandoffContext = createContext<TickerHandoffContextValue>({
  handoff: null,
  launch: () => {},
});

export function useTickerHandoff() {
  return useContext(TickerHandoffContext);
}

// Runs `onReceive` exactly once per incoming handoff addressed to `target` -
// a requestId ref-guard means re-launching the same symbol still re-fires,
// unlike a plain symbol-equality check would.
export function useIncomingTicker(target: HandoffTarget, onReceive: (symbol: string) => void) {
  const { handoff } = useTickerHandoff();
  const lastHandledRequestId = useRef<number | null>(null);

  useEffect(() => {
    if (handoff && handoff.target === target && handoff.requestId !== lastHandledRequestId.current) {
      lastHandledRequestId.current = handoff.requestId;
      onReceive(handoff.symbol);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff, target]);
}

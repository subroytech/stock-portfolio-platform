import { createContext, useContext, useEffect, useRef } from 'react';

// Lets any tab "launch" a ticker on another tab (e.g. a Contrarian Finder
// row triggering Long-Term Analysis) without unmounting either - both tabs
// stay mounted at all times under TabShell, so the target page's own hooks
// just react to a context change. Follows the same
// Context+Provider-in-TabShell pattern as apiKeysModal.ts.
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

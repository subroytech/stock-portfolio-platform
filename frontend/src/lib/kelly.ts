export interface KellySizing {
  kF: number;
  hk: number;
  pos: number;
  sh: number;
  noEntry: boolean;
}

// Client-side port of backend/src/services/momentum.service.ts's
// calcKellySizing — kept in sync manually, not shared as a package (small
// enough that duplicating is simpler than introducing a shared workspace for
// one function). Capital is a live-editable UI input, so this runs on every
// keystroke without a network round trip — see the Phase 3 plan.
export function calcKellySizing(rr: number, capital: number, entryMid: number, score: number): KellySizing {
  const kF = rr > 0 ? Math.max((0.55 * rr - 0.45) / rr, 0) : 0;
  const noEntry = score < 6;
  let hk = 0;
  if (!noEntry && kF > 0) {
    hk = score >= 7 ? Math.min(Math.max(kF / 2, 0.10), 0.20)
      : Math.min(kF / 2, 0.20);
  }
  const pos = capital * hk;
  const sh = entryMid > 0 ? Math.floor(pos / entryMid) : 0;
  return { kF, hk, pos, sh, noEntry };
}

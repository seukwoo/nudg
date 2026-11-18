// The codes critique reports, apart from critique itself so the compiler can check "keep" (1.7)
// without depending on the runtime.

/** Every finding code critique reports; a file may keep any of them (`"keep"`, 1.7). */
export const CRITIQUE_CODES = ["slow-transition", "late-feedback", "invisible-change", "slow-exit", "bouncy-fade", "short-timeout", "no-escape"];

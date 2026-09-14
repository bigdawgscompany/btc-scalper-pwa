import { Decimal } from "decimal.js";
import Dexie, { type Table } from "dexie";
import type {
  PaperAccountState,
  PaperDecision,
  PaperFill,
  ClosedTrade,
  EquityObservation,
  SignalSnapshot,
} from "./types";
import { createInitialAccount } from "./engine";

export type PaperTradeLedgerRow = ClosedTrade;

export class ScalperDatabase extends Dexie {
  account!: Table<PaperAccountState, string>;
  trades!: Table<PaperTradeLedgerRow, string>;
  fills!: Table<PaperFill, string>;
  decisions!: Table<PaperDecision, string>;
  equityObservations!: Table<EquityObservation, string>;
  signalSnapshots!: Table<SignalSnapshot, string>;

  constructor() {
    super("btc-scalper-pwa");
    this.version(1).stores({
      account: "id, updatedAt, revision",
      trades: "id, positionId, entryTime, exitTime, side, closeReason",
      fills: "id, decisionId, timestamp, side",
      decisions: "id, timestamp, confirmedCandleTime, action",
      equityObservations: "id, timestamp, hasOpenPosition",
      signalSnapshots: "id, timestamp, candleTime, state, score",
    });
  }
}

let dbInstance: ScalperDatabase | null = null;

/** Return the singleton IndexedDB wrapper for the current runtime. */
export function getDatabase(): ScalperDatabase {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable in this runtime.");
  }
  if (!dbInstance) {
    dbInstance = new ScalperDatabase();
  }
  return dbInstance;
}

// ─── Invariant validation (§6) ──────────────────────────────────────────

/**
 * Validates accounting invariants and references for an account state.
 * Returns an array of error messages (empty = valid).
 */
export function validateAccountInvariants(
  account: PaperAccountState
): string[] {
  const errors: string[] = [];
  const cash = new Decimal(account.availableCash);
  const collateral = new Decimal(account.reservedCollateral);
  const equity = new Decimal(account.equity);

  if (!cash.isFinite() || !collateral.isFinite() || !equity.isFinite()) {
    errors.push("Account contains a non-finite monetary value.");
  }
  if (cash.isNegative()) errors.push("Available cash is negative.");
  if (collateral.isNegative()) errors.push("Reserved collateral is negative.");
  if (equity.isNegative()) errors.push("Equity is negative.");

  if (account.position) {
    const positionQty = new Decimal(account.position.quantity);
    const positionNotional = new Decimal(account.position.reservedCollateral);
    if (positionQty.isLessThanOrEqualTo(0)) errors.push("Open position quantity must be positive.");
    if (positionNotional.isLessThanOrEqualTo(0)) errors.push("Open position collateral must be positive.");
    if (!collateral.eq(positionNotional)) {
      errors.push("Reserved collateral does not match open position collateral.");
    }
  } else if (!collateral.isZero()) {
    errors.push("Flat account must not reserve collateral.");
  }

  if (!cash.plus(collateral).minus(equity).abs().lessThanOrEqualTo(new Decimal("0.00000001"))) {
    errors.push("Cash plus collateral does not reconcile to equity.");
  }

  return errors;
}

/** Ensure the primary paper account exists in storage. */
export async function ensurePrimaryAccount(): Promise<PaperAccountState> {
  const database = getDatabase();
  const existing = await database.account.get("primary");
  if (existing) return existing;

  const initial = createInitialAccount();
  await database.account.put(initial);
  return initial;
}

/** Reset all paper-trading state. Intended for explicit user reset only. */
export async function resetDatabase(): Promise<void> {
  const database = getDatabase();
  await database.transaction(
    "rw",
    database.account,
    database.trades,
    database.fills,
    database.decisions,
    database.equityObservations,
    database.signalSnapshots,
    async () => {
      await database.account.clear();
      await database.trades.clear();
      await database.fills.clear();
      await database.decisions.clear();
      await database.equityObservations.clear();
      await database.signalSnapshots.clear();
      await database.account.put(createInitialAccount());
    }
  );
}

/**
 * Persist one atomic paper-evaluation step.
 *
 * The returned account is the exact state committed to IndexedDB, including
 * the incremented revision. This prevents callers from continuing with a
 * stale in-memory revision after a successful transaction.
 */
export async function recordEvaluationStep(
  account: PaperAccountState,
  decision: PaperDecision,
  fills: PaperFill[],
  closedTrade: ClosedTrade | null,
  equityObservation: EquityObservation | null,
  signalSnapshot?: SignalSnapshot | null
): Promise<PaperAccountState> {
  const database = getDatabase();
  const nextRevision = account.revision + 1;
  const nextAccount: PaperAccountState = {
    ...account,
    revision: nextRevision,
    updatedAt: Date.now(),
  };

  const invariantErrors = validateAccountInvariants(nextAccount);
  if (invariantErrors.length > 0) {
    throw new Error(`Account invariant violation: ${invariantErrors.join("; ")}`);
  }

  await database.transaction(
    "rw",
    database.account,
    database.trades,
    database.fills,
    database.decisions,
    database.equityObservations,
    database.signalSnapshots,
    async () => {
      const stored = await database.account.get(account.id);
      if (stored && stored.revision !== account.revision) {
        throw new Error(
          `Revision conflict: expected ${account.revision}, stored ${stored.revision}.`
        );
      }

      await database.account.put(nextAccount);
      await database.decisions.put(decision);
      if (fills.length > 0) await database.fills.bulkPut(fills);
      if (closedTrade) await database.trades.put(closedTrade);
      if (equityObservation) await database.equityObservations.put(equityObservation);
      if (signalSnapshot) await database.signalSnapshots.put(signalSnapshot);
    }
  );

  return nextAccount;
}

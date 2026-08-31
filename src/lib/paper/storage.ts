import Dexie, { type Table } from "dexie";
import { Decimal } from "decimal.js";
import type {
  PaperAccountState,
  ClosedTrade,
  PaperFill,
  PaperDecision,
  EquityObservation,
  PaperConfig,
} from "./types";
import { createInitialAccount } from "./engine";
import { DEFAULT_PAPER_CONFIG } from "./types";
import type { AnalysisResult } from "../contracts";

export interface SignalSnapshot {
  id: string;
  timestamp: number;
  candleTime: number;
  state: string;
  score: number;
  reasons: string[];
}

export class ScalperDatabase extends Dexie {
  account!: Table<PaperAccountState, string>;
  trades!: Table<ClosedTrade, string>;
  fills!: Table<PaperFill, string>;
  decisions!: Table<PaperDecision, string>;
  equityObservations!: Table<EquityObservation, string>;
  signalSnapshots!: Table<SignalSnapshot, string>;

  constructor() {
    super("btc_scalper_db_v2");
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

export function getDatabase(): ScalperDatabase {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only accessible in browser environment.");
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

  if (!account.id) errors.push("Account missing id");

  // All monetary fields must be valid decimal strings
  const moneyFields: (keyof PaperAccountState)[] = [
    "availableCash",
    "reservedCollateral",
    "realizedPnl",
    "totalFeesPaid",
    "equity",
  ];
  for (const field of moneyFields) {
    const val = account[field];
    if (typeof val !== "string" || isNaN(Number(val))) {
      errors.push(`Account.${field} is not a valid decimal string: ${val}`);
    }
  }

  // Equity must equal cash + collateral (when flat, no unrealized P&L)
  try {
    const cash = new Decimal(account.availableCash);
    const collateral = new Decimal(account.reservedCollateral);
    const equity = new Decimal(account.equity);
    if (!account.position && !equity.equals(cash.plus(collateral))) {
      errors.push(
        `Equity invariant violated: equity=${equity} != cash+collateral=${cash.plus(collateral)}`
      );
    }
  } catch {
    errors.push("Cannot parse account monetary fields as decimals");
  }

  // Position references
  if (account.position) {
    if (!account.position.quantity || !account.position.entryPrice) {
      errors.push("Position missing quantity or entryPrice");
    }
  }

  return errors;
}

// ─── Core storage operations ────────────────────────────────────────────

/**
 * Load or initialize the primary paper account. Validates invariants on load.
 */
export async function getOrInitAccount(
  defaultConfig: PaperConfig = DEFAULT_PAPER_CONFIG
): Promise<PaperAccountState> {
  const db = getDatabase();
  const existing = await db.account.get("primary");
  if (existing) {
    const errors = validateAccountInvariants(existing);
    if (errors.length > 0) {
      throw new Error(`Corrupt account state detected: ${errors.join("; ")}`);
    }
    return existing;
  }
  const initial = createInitialAccount(defaultConfig);
  await db.account.put(initial);
  return initial;
}

/**
 * Save updated account state with revision increment.
 */
export async function saveAccount(account: PaperAccountState): Promise<void> {
  const db = getDatabase();
  await db.account.put({
    ...account,
    revision: account.revision + 1,
    updatedAt: Date.now(),
  });
}

/**
 * Atomic transaction recording an evaluation step, fills, trade close, and equity observation.
 */
export async function recordEvaluationStep(
  account: PaperAccountState,
  decision: PaperDecision,
  fills: PaperFill[],
  closedTrade: ClosedTrade | null,
  analysis: AnalysisResult | null
): Promise<void> {
  const db = getDatabase();

  await db.transaction(
    "rw",
    [
      db.account,
      db.decisions,
      db.fills,
      db.trades,
      db.equityObservations,
      db.signalSnapshots,
    ],
    async () => {
      // 1. Update Account
      await db.account.put({
        ...account,
        revision: account.revision + 1,
        updatedAt: Date.now(),
      });

      // 2. Record Decision
      await db.decisions.put(decision);

      // 3. Record Fills
      for (const fill of fills) {
        await db.fills.put(fill);
      }

      // 4. Record Closed Trade
      if (closedTrade) {
        await db.trades.put(closedTrade);
      }

      // 5. Record Equity Observation
      const obs: EquityObservation = {
        id: `eq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        equity: account.equity,
        availableCash: account.availableCash,
        reservedCollateral: account.reservedCollateral,
        unrealizedPnl: account.position ? account.position.unrealizedPnl : "0.00000000",
        hasOpenPosition: account.position !== null,
        isPausedGap: account.isPaused,
      };
      await db.equityObservations.put(obs);

      // 6. Record Signal Snapshot if analysis provided
      if (analysis) {
        const snap: SignalSnapshot = {
          id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          candleTime: analysis.candleTime,
          state: analysis.state,
          score: analysis.score,
          reasons: analysis.reasons,
        };
        await db.signalSnapshots.put(snap);
      }

      // Retention limits: prune oldest snapshots beyond 10,000
      const snapCount = await db.signalSnapshots.count();
      if (snapCount > 10000) {
        const excess = snapCount - 10000;
        const oldestKeys = await db.signalSnapshots
          .orderBy("timestamp")
          .limit(excess)
          .primaryKeys();
        await db.signalSnapshots.bulkDelete(oldestKeys);
      }

      // Retention: prune equity observations beyond 5,000
      const eqCount = await db.equityObservations.count();
      if (eqCount > 5000) {
        const excess = eqCount - 5000;
        const oldestKeys = await db.equityObservations
          .orderBy("timestamp")
          .limit(excess)
          .primaryKeys();
        await db.equityObservations.bulkDelete(oldestKeys);
      }
    }
  );
}

/**
 * Fetch all closed trades from journal.
 */
export async function getClosedTrades(): Promise<ClosedTrade[]> {
  const db = getDatabase();
  return db.trades.orderBy("exitTime").reverse().toArray();
}

/**
 * Fetch equity observation history for plotting.
 */
export async function getEquityHistory(limit = 500): Promise<EquityObservation[]> {
  const db = getDatabase();
  return db.equityObservations.orderBy("timestamp").limit(limit).toArray();
}

/**
 * Reset entire simulation database.
 */
export async function resetDatabase(
  newConfig: PaperConfig = DEFAULT_PAPER_CONFIG
): Promise<PaperAccountState> {
  const db = getDatabase();
  await db.transaction(
    "rw",
    [
      db.account,
      db.trades,
      db.fills,
      db.decisions,
      db.equityObservations,
      db.signalSnapshots,
    ],
    async () => {
      await db.trades.clear();
      await db.fills.clear();
      await db.decisions.clear();
      await db.equityObservations.clear();
      await db.signalSnapshots.clear();

      const fresh = createInitialAccount(newConfig);
      await db.account.put(fresh);
    }
  );
  return createInitialAccount(newConfig);
}

// ─── Backup & recovery (§6) ─────────────────────────────────────────────

/**
 * Export full backup as versioned JSON string.
 */
export async function exportBackupJSON(): Promise<string> {
  const db = getDatabase();
  const account = await db.account.get("primary");
  const trades = await db.trades.toArray();
  const fills = await db.fills.toArray();
  const decisions = await db.decisions.toArray();
  const equityObservations = await db.equityObservations.toArray();

  const backupData = {
    version: 2,
    exportedAt: Date.now(),
    account,
    trades,
    fills,
    decisions,
    equityObservations,
  };

  return JSON.stringify(backupData, null, 2);
}

/**
 * Export diagnostic corrupt-state data (separate from valid import backups).
 */
export async function exportCorruptStateJSON(): Promise<string> {
  const db = getDatabase();
  const account = await db.account.get("primary");
  const trades = await db.trades.toArray();
  const fills = await db.fills.toArray();
  const decisions = await db.decisions.toArray();
  const equityObservations = await db.equityObservations.toArray();
  const snapshots = await db.signalSnapshots.toArray();

  const errors = account ? validateAccountInvariants(account) : ["No account found"];

  return JSON.stringify(
    {
      version: 2,
      exportedAt: Date.now(),
      diagnostic: true,
      validationErrors: errors,
      account,
      trades,
      fills,
      decisions,
      equityObservations,
      snapshots,
    },
    null,
    2
  );
}

/**
 * Import and validate a backup JSON string, restoring in Paused state.
 * Validates fully before transactional replacement.
 */
export async function importBackupJSON(jsonString: string): Promise<PaperAccountState> {
  const db = getDatabase();
  type BackupData = {
    version: number;
    exportedAt?: number;
    account?: PaperAccountState;
    trades?: ClosedTrade[];
    fills?: PaperFill[];
    decisions?: PaperDecision[];
    equityObservations?: EquityObservation[];
  };
  let parsed: BackupData;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("Invalid JSON format in backup file.");
  }

  if (!parsed || parsed.version !== 2 || !parsed.account) {
    throw new Error("Incompatible or corrupted backup structure (expected version 2).");
  }

  // Full validation before replacement (§6)
  const errors = validateAccountInvariants(parsed.account);
  if (errors.length > 0) {
    throw new Error(`Backup validation failed: ${errors.join("; ")}`);
  }

  const restoredAccount: PaperAccountState = {
    ...parsed.account,
    isRunning: false,
    isPaused: true, // Always restore in Paused state for safety
    revision: 0, // Reset revision on import
    updatedAt: Date.now(),
  };

  await db.transaction(
    "rw",
    [
      db.account,
      db.trades,
      db.fills,
      db.decisions,
      db.equityObservations,
      db.signalSnapshots,
    ],
    async () => {
      await db.account.clear();
      await db.trades.clear();
      await db.fills.clear();
      await db.decisions.clear();
      await db.equityObservations.clear();

      await db.account.put(restoredAccount);
      if (Array.isArray(parsed.trades)) await db.trades.bulkPut(parsed.trades);
      if (Array.isArray(parsed.fills)) await db.fills.bulkPut(parsed.fills);
      if (Array.isArray(parsed.decisions)) await db.decisions.bulkPut(parsed.decisions);
      if (Array.isArray(parsed.equityObservations)) {
        await db.equityObservations.bulkPut(parsed.equityObservations);
      }
    }
  );

  return restoredAccount;
}

/**
 * Export journal trades to CSV with formula injection escaping.
 */
export function exportTradesToCSV(trades: ClosedTrade[]): string {
  const headers = [
    "Trade ID",
    "Side",
    "Quantity (BTC)",
    "Entry Price (USDT)",
    "Exit Price (USDT)",
    "Entry Time",
    "Exit Time",
    "Gross PnL (USDT)",
    "Total Fees (USDT)",
    "Net PnL (USDT)",
    "Return (%)",
    "Close Reason",
  ];

  const escapeCSV = (field: string | number): string => {
    let str = String(field);
    // Escape spreadsheet formula injection characters (=, +, -, @, \t, \r)
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    // Escape internal quotes
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = trades.map((t) => [
    escapeCSV(t.id),
    escapeCSV(t.side),
    escapeCSV(t.quantity),
    escapeCSV(t.entryPrice),
    escapeCSV(t.exitPrice),
    escapeCSV(new Date(t.entryTime).toISOString()),
    escapeCSV(new Date(t.exitTime).toISOString()),
    escapeCSV(t.grossPnl),
    escapeCSV(t.totalFees),
    escapeCSV(t.netPnl),
    escapeCSV(t.returnPct),
    escapeCSV(t.closeReason),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
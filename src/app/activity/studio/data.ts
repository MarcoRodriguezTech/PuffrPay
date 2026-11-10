// AG Studio data sources for the Activity page: one table per row type
// produced by src/lib/dashboard-data.ts, a shared calendar and a few
// calculated measures.

import type {
  AgDataSourcesDefinition,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from "ag-studio";
import type { DashboardData } from "@/lib/dashboard-data";

// --- Helpers ----------------------------------------------------------------------

const CALENDAR_ID = "calendar";

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

const onCalendar = (tableId: string, fieldId: string, truncate?: "day"): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
  ...(truncate && { truncate }),
});

const sumOf = (id: string) => ({ id, aggregation: "sum" as const });

const ratio = (
  id: string,
  name: string,
  description: string,
  numerator: { id: string; aggregation: "sum" | "avg" | "countd" },
  denominator: { id: string; aggregation: "sum" | "avg" | "countd" }
): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format: "percentageFormat",
  isMeasure: true,
  expression: { operator: "divide", inputs: [numerator, denominator] },
});

// --- Data sources -----------------------------------------------------------------

// Whether there is anything to report on at all — without rows Studio would
// only render empty widgets.
export const hasData = (data: DashboardData) => data.requests.length > 0;

export function buildStudioData(data: DashboardData): AgDataSourcesDefinition {
  const dates = data.activity
    .map((r) => r.createdAt?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort();
  const today = data.asOf.slice(0, 10);

  return {
    description:
      "PuffrPay data: purchase requests an AI shopping agent made inside owner-set spending " +
      "limits. Every request carries the policy engine's decision (ALLOW/ASK/BLOCK), the " +
      "owner/policy decider, and lifecycle status. Requests with isStub true never reached " +
      "PayPal (offline dev mode). Amounts are USD.",
    sources: [
      {
        id: "requests",
        name: "Purchase requests",
        description:
          "The full ledger — one row per purchase request the agent made (kind='request') plus " +
          "one row per option card it offered on the carousel (kind='card'). Card rows are " +
          "shelf items the owner skipped (status SKIPPED), cards still " +
          "live and pickable (status OFFERED), or cards the rules refused before they could " +
          "be picked (status BLOCKED, decided-by 'policy'); they were never purchase requests, so their " +
          "spent/purchased/blocked/waiting flags are always 0 and they never count as spend. " +
          "Spent is the amount only when a request row is PURCHASED; blocked/waiting/purchased/" +
          "autoApproved are 1/0 flags for rate measures. Policy limits are repeated on every " +
          "row so spend-to-cap ratios work without a join.",
        data: data.activity,
        fields: fields([
          ["ref", "Request Ref", "textFormat", true],
          ["kind", "Row Kind", "textFormat", true],
          ["state", "Card State", "textFormat", true],
          ["rowIdx", "Row Index", "integerFormat", true],
          ["createdAt", "Requested", "dateTimeFormat"],
          ["title", "Item", "textFormat"],
          ["merchantUrl", "Item URL", "textFormat", true],
          ["imageUrl", "Image URL", "textFormat", true],
          ["category", "Category", "textFormat", true],
          ["amount", "Amount", "currencyFormat"],
          ["currency", "Currency", "textFormat", true],
          ["decision", "Policy Decision", "textFormat"],
          // PURCHASED/WAITING/BLOCKED/REJECTED/FAILED on requests; card rows
          // also carry OFFERED (live shelf card) and SKIPPED (unchosen card).
          ["status", "Status", "textFormat"],
          ["decidedBy", "Decided By", "textFormat"],
          ["reason", "Policy Reason", "textFormat"],
          ["reasoning", "Agent Reasoning", "textFormat", true],
          ["orderId", "PayPal Order", "textFormat", true],
          ["hasOrder", "Has PayPal Order", "integerFormat", true],
          ["isStub", "Stub Order", "booleanFormat"],
          ["spent", "Spent", "currencyFormat"],
          ["cumulative", "Spent to date", "currencyFormat"],
          ["purchased", "Purchased Count", "integerFormat", true],
          ["blocked", "Blocked Count", "integerFormat", true],
          ["waiting", "Waiting Count", "integerFormat", true],
          ["autoApproved", "Auto-approved Count", "integerFormat", true],
          ["monthlyCap", "Monthly Cap", "currencyFormat"],
          ["perPurchaseMax", "Per-purchase Max", "currencyFormat"],
          ["autoApproveUnder", "Auto-approve Under", "currencyFormat"],
        ]),
      },
      {
        id: "policy",
        description: "The owner's current spending rules (single row).",
        data: data.policy,
        fields: fields([
          ["monthlyCap", "Monthly Cap", "currencyFormat"],
          ["perPurchaseMax", "Per-purchase Max", "currencyFormat"],
          ["autoApproveUnder", "Auto-approve Under", "currencyFormat"],
          ["blockedCategories", "Blocked Categories", "textFormat"],
          ["updatedAt", "Rules Updated", "dateTimeFormat"],
        ]),
      },
    ],
    relationships: [onCalendar("requests", "createdAt", "day")],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: {
          from: { type: "date", value: dates[0] ?? today },
          to: { type: "date", value: dates.at(-1) ?? today },
        },
        fragments: ["year", "quarter", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions: [
      ratio(
        "budgetUsed",
        "Budget Used",
        "Spent on PURCHASED requests / monthly cap.",
        sumOf("requests.spent"),
        { id: "requests.monthlyCap", aggregation: "avg" }
      ),
      ratio(
        "blockRate",
        "Block Rate",
        "Share of requests the policy engine blocked.",
        sumOf("requests.blocked"),
        { id: "requests.ref", aggregation: "countd" }
      ),
      ratio(
        "autoRate",
        "Auto-approval Rate",
        "Share of requests purchased without owner involvement.",
        sumOf("requests.autoApproved"),
        { id: "requests.ref", aggregation: "countd" }
      ),
    ],
  };
}

import { getLLM } from "./llm";
import type { AuditQuerySpec } from "./llm/types";

/**
 * Natural-language -> filter JSON for the audit grid.
 * The LLM only produces a small JSON spec; it is validated here against a
 * whitelist of fields/operators before the client applies it to AG Grid.
 * The LLM never writes SQL or executable code.
 */

export const ALLOWED_FIELDS = new Set([
  "created_at",
  "product_title",
  "category",
  "amount_cents",
  "currency",
  "status",
  "policy_reason",
  "agent_reasoning",
  "decided_by",
]);

export const ALLOWED_OPERATORS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
]);

const STATUSES = new Set([
  "PURCHASED",
  "WAITING",
  "BLOCKED",
  "REJECTED",
  "FAILED",
]);

export interface ValidatedAuditQuery {
  filters: { field: string; operator: string; value: string }[];
  sort: { field: string; direction: "asc" | "desc" } | null;
  summary: { type: "count" | "sum"; field?: string } | null;
  /** Human-readable echo of what was understood. */
  understood: string;
}

const cache = new Map<string, ValidatedAuditQuery>();

export async function questionToSpec(
  question: string
): Promise<ValidatedAuditQuery> {
  const key = question.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  const spec = await getLLM().auditQuery(question);
  const validated = validate(spec);
  cache.set(key, validated);
  if (cache.size > 100) {
    cache.delete(cache.keys().next().value as string);
  }
  return validated;
}

export function validate(spec: AuditQuerySpec): ValidatedAuditQuery {
  if (!spec || typeof spec !== "object") {
    throw new Error("LLM returned an invalid query spec");
  }

  const filters = (spec.filters ?? [])
    .filter(
      (f) =>
        f &&
        ALLOWED_FIELDS.has(String(f.field)) &&
        ALLOWED_OPERATORS.has(String(f.operator))
    )
    .map((f) => {
      let value = String(f.value);
      if (f.field === "status") value = value.toUpperCase();
      if (f.field === "status" && !STATUSES.has(value)) {
        throw new Error(`unknown status value: ${value}`);
      }
      return { field: String(f.field), operator: String(f.operator), value };
    });

  let sort: ValidatedAuditQuery["sort"] = null;
  if (
    spec.sort &&
    ALLOWED_FIELDS.has(String(spec.sort.field)) &&
    (spec.sort.direction === "asc" || spec.sort.direction === "desc")
  ) {
    sort = { field: String(spec.sort.field), direction: spec.sort.direction };
  }

  let summary: ValidatedAuditQuery["summary"] = null;
  if (spec.summary && (spec.summary.type === "count" || spec.summary.type === "sum")) {
    if (spec.summary.type === "sum") {
      const f = String(spec.summary.field ?? "amount_cents");
      if (!ALLOWED_FIELDS.has(f) || f !== "amount_cents") {
        throw new Error("sum is only allowed on amount_cents");
      }
      summary = { type: "sum", field: "amount_cents" };
    } else {
      summary = { type: "count" };
    }
  }

  const understood =
    filters.length === 0 && !summary
      ? "showing all requests"
      : [
          ...filters.map((f) => `${f.field} ${f.operator} ${f.value}`),
          summary ? `${summary.type}${summary.field ? `(${summary.field})` : ""}` : "",
        ]
          .filter(Boolean)
          .join("; ");

  return { filters, sort, summary, understood };
}

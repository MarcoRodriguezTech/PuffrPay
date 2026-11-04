export type PolicyDecision = "ALLOW" | "ASK" | "BLOCK";

export type PurchaseStatus =
  | "PURCHASED"
  | "WAITING"
  | "BLOCKED"
  | "REJECTED"
  | "FAILED";

export interface Policy {
  id: number;
  monthlyCapCents: number;
  perPurchaseMaxCents: number;
  autoApproveUnderCents: number;
  blockedCategories: string[];
  updatedAt: string;
}

export interface PurchaseRequest {
  id: number;
  createdAt: string;
  productId: string;
  productTitle: string;
  merchantUrl: string | null;
  category: string | null;
  amountCents: number;
  currency: string;
  agentReasoning: string | null;
  policyDecision: PolicyDecision;
  policyReason: string;
  status: PurchaseStatus;
  decidedBy: "policy" | "owner";
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  role: "owner" | "agent" | "system";
  content: string;
  createdAt: string;
}

export interface ProductResult {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  merchantUrl: string | null;
  category: string | null;
  description?: string | null;
}

export interface BudgetInfo {
  spentCents: number;
  capCents: number;
  ratio: number;
}

CREATE TABLE IF NOT EXISTS policies (
  id SERIAL PRIMARY KEY,
  monthly_cap_cents INTEGER NOT NULL,
  per_purchase_max_cents INTEGER NOT NULL,
  auto_approve_under_cents INTEGER NOT NULL,
  blocked_categories TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_requests (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  product_id TEXT NOT NULL,
  product_title TEXT NOT NULL,
  merchant_url TEXT,
  category TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  agent_reasoning TEXT,
  policy_decision TEXT NOT NULL CHECK (policy_decision IN ('ALLOW', 'ASK', 'BLOCK')),
  policy_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PURCHASED', 'WAITING', 'BLOCKED', 'REJECTED', 'FAILED')),
  decided_by TEXT NOT NULL CHECK (decided_by IN ('policy', 'owner')),
  paypal_order_id TEXT,
  paypal_capture_id TEXT,
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests (status);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_created_at ON purchase_requests (created_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'agent', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Persist the PayPal approve URL so open checkouts can be resumed after a
-- page reload instead of living only in transient UI state.
ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS paypal_approve_url TEXT;

-- Sandbox approve links are deterministic from the order id, so already
-- stranded WAITING rows become resumable immediately.
UPDATE purchase_requests
SET paypal_approve_url =
      'https://www.sandbox.paypal.com/checkoutnow?token=' || paypal_order_id
WHERE status = 'WAITING'
  AND paypal_order_id IS NOT NULL
  AND paypal_approve_url IS NULL
  AND paypal_order_id NOT LIKE 'STUB-%';

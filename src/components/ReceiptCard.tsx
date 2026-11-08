import { fmtDollars, storeOf } from "@/lib/ui";

// Minimal purchase shape every receipt surface can supply — the API returns
// full PurchaseRequest rows, chat/paypal-return keep a subset.
export interface ReceiptPurchase {
  productTitle: string;
  imageUrl: string | null;
  merchantUrl: string | null;
  amountCents: number;
  updatedAt?: string;
  createdAt?: string;
  paypalOrderId?: string | null;
  paypalCaptureId?: string | null;
  decidedBy?: "policy" | "owner" | string;
}

// Dev-stub ids are internal noise — a real receipt would show a processor ref,
// so stubs collapse to a readable "sandbox" tag.
const refOr = (id?: string | null) =>
  !id ? null : id.startsWith("STUB-") ? "sandbox" : id;

export function ReceiptCard({
  purchase,
  dense,
}: {
  purchase: ReceiptPurchase;
  /** dense hides the slip rows — used inline in the chat feed */
  dense?: boolean;
}) {
  const p = purchase;
  const when = p.updatedAt ?? p.createdAt;
  const order = refOr(p.paypalOrderId);
  const capture = refOr(p.paypalCaptureId);

  return (
    <article className="receipt-card">
      <div className="rc-head">
        {p.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="rc-thumb" src={p.imageUrl} alt="" width={40} height={40} />
        ) : (
          <span className="rc-thumb rc-thumb-empty" aria-hidden="true">
            {p.productTitle?.[0]?.toUpperCase() ?? "?"}
          </span>
        )}
        <div className="rc-title">
          <strong>{p.productTitle}</strong>
          <span className="muted">{storeOf(p.merchantUrl)}</span>
        </div>
        <span className="rc-amt">{fmtDollars(p.amountCents)}</span>
      </div>

      {!dense && (
        <div className="rc-slip">
          {when && (
            <div>
              <span>Bought</span>
              <span>{new Date(when).toLocaleString()}</span>
            </div>
          )}
          {order && (
            <div>
              <span>Order</span>
              <span>{order}</span>
            </div>
          )}
          {capture && (
            <div>
              <span>Capture</span>
              <span>{capture}</span>
            </div>
          )}
          <div>
            <span>Decided</span>
            <span>
              {p.decidedBy === "owner"
                ? "You approved it"
                : "Puffr auto-approved"}
            </span>
          </div>
        </div>
      )}

      {p.merchantUrl && (
        <a
          className="rc-link"
          href={p.merchantUrl}
          target="_blank"
          rel="noreferrer"
        >
          View product ({storeOf(p.merchantUrl)})
        </a>
      )}
    </article>
  );
}

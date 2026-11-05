import { redirect } from "next/navigation";

// The plain grid moved under /audit/classic; /audit lands on Activity.
export default function AuditRedirect() {
  redirect("/activity");
}

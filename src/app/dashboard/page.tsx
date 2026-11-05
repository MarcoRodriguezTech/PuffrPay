import { redirect } from "next/navigation";

// Dashboard merged into the Activity page.
export default function DashboardRedirect() {
  redirect("/activity");
}

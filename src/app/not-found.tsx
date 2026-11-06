import Link from "next/link";
import Image from "next/image";
import { MASCOT_SRC } from "@/components/PufferGauge";

export default function NotFound() {
  return (
    <main className="page">
      <div className="error-page">
        <Image src={MASCOT_SRC} alt="" width={120} height={120} quality={90} />
        <h1>Nothing lives down here</h1>
        <p className="muted">
          This tidepool is empty — the page you asked for doesn&apos;t exist.
        </p>
        <Link href="/">Back to the Agent</Link>
      </div>
    </main>
  );
}

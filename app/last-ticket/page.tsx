import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import { loadSwitchyardConfig } from "@/lib/switchyard/config";
import LastTicketView from "./LastTicketView";

// Read switchyard.toml on every request so the page reflects local edits.
export const dynamic = "force-dynamic";

export default function LastTicketPage() {
  const config = loadSwitchyardConfig();
  const routes = config.routes.map(({ id, type, answers, models, passthroughTarget }) => ({ id, type, answers, models, passthroughTarget }));
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader active="/last-ticket" />
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-10 space-y-10">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold text-gray-100">What happened to your last ticket</h1>
          <p className="text-gray-400 mt-3">
            The most recent ticket from the <Link href="/" className="text-[#76b900] hover:underline">Demo</Link> tab: which
            route it took, what the judge decided, and what it cost compared with sending it to Sol.
          </p>
        </div>
        <LastTicketView routes={routes} targets={config.targets} />
      </main>
    </div>
  );
}

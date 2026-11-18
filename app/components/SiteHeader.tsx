import Link from "next/link";

const TABS = [
  { href: "/", label: "Demo" },
  { href: "/bulk", label: "Bulk" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/last-ticket", label: "Last ticket" },
];

export default function SiteHeader({ active }: { active: string }) {
  return (
    <header className="border-b border-gray-800 bg-[#0f0f0f]">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#76b900]" />
          <span className="font-semibold text-sm tracking-wide text-gray-200">NVIDIA Switchyard</span>
        </div>
        <span className="text-gray-600 text-sm">×</span>
        <span className="text-gray-400 text-sm">Amazon Bedrock</span>
        <nav className="ml-6 flex gap-1">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={t.href === active
                ? "px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-200"
                : "px-3 py-1.5 text-sm rounded text-gray-500 hover:text-gray-300 transition-colors"}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

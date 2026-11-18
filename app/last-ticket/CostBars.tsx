"use client";

import { useRef, useState } from "react";
import { usd } from "@/lib/modelColors";

export interface Segment {
  key: string;
  label: string;   // e.g. "Answer: Nemotron Nano 30B"
  usd: number;
  color: string;   // mark color
  detail?: string; // tooltip / table extra, e.g. "257 in + 79 out tokens"
}

interface Props {
  title: string;
  subtitle?: string;
  routed: Segment[];     // stacked into the "With Switchyard" bar
  solOnly: Segment;      // the comparison bar
}

const BAR_PX = 20; // <= 24px marks

// Two horizontal bars on one shared scale: the routed cost (stacked by component)
// and the same work on Sol only. A headline states the difference.
export default function CostBars({ title, subtitle, routed, solOnly }: Props) {
  const [hover, setHover] = useState<{ seg: Segment; x: number; row: number } | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const plotLeft = () => plotRef.current?.getBoundingClientRect().left ?? 0;
  const routedTotal = routed.reduce((s, x) => s + x.usd, 0);
  const max = Math.max(routedTotal, solOnly.usd) || 1;
  const diff = solOnly.usd > 0 ? routedTotal / solOnly.usd - 1 : 0;
  const cheaper = diff <= 0;

  const rows = [
    { name: "With Switchyard", total: routedTotal, segs: routed.filter((s) => s.usd > 0) },
    { name: "Sol only", total: solOnly.usd, segs: [solOnly] },
  ];

  return (
    <div className="rounded-xl border border-gray-800 bg-[#111] p-5 space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-200">{title}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>

      <p className="text-gray-100">
        <span className="text-3xl font-semibold">{Math.abs(Math.round(diff * 100))}%</span>{" "}
        <span className="text-sm text-gray-400">{cheaper ? "cheaper than Sol only" : "more than Sol only"}</span>
      </p>

      <div ref={plotRef} className="space-y-3 relative" onMouseLeave={() => setHover(null)}>
        {rows.map((row, ri) => (
          <div key={row.name} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-gray-400">{row.name}</span>
            {/* Right margin keeps room for the value label at the tip of the longest bar. */}
            <div className="flex-1 relative mr-20" style={{ height: BAR_PX }}>
              {/* Segments sit on the surface; the 2px gaps between them are surface color. */}
              <div className="absolute inset-y-0 left-0 flex gap-[2px]" style={{ width: `${(row.total / max) * 100}%`, minWidth: row.total > 0 ? 2 : 0 }}>
                {row.segs.map((seg, si) => (
                  <div
                    key={seg.key}
                    tabIndex={0}
                    role="img"
                    aria-label={`${seg.label}: ${usd(seg.usd)}`}
                    onMouseMove={(e) => setHover({ seg, x: e.clientX - plotLeft(), row: ri })}
                    onFocus={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setHover({ seg, x: r.left - plotLeft() + r.width / 2, row: ri });
                    }}
                    onBlur={() => setHover(null)}
                    className="h-full outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                    style={{
                      background: seg.color,
                      // Share of the bar; raw dollar values sum to < 1 and would leave the bar unfilled.
                      flexGrow: row.total > 0 ? seg.usd / row.total : 1,
                      flexBasis: 0,
                      minWidth: 2,
                      // 4px rounded data-end, square at the baseline
                      borderRadius: si === row.segs.length - 1 ? "0 4px 4px 0" : 0,
                    }}
                  />
                ))}
              </div>
              {/* Value at the bar tip */}
              <span
                className="absolute top-1/2 -translate-y-1/2 pl-2 text-xs text-gray-300 tabular-nums whitespace-nowrap"
                style={{ left: `${(row.total / max) * 100}%` }}
              >
                {usd(row.total)}
              </span>
            </div>
          </div>
        ))}

        {hover && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-gray-700 bg-[#1a1a1a] px-3 py-2 text-xs shadow-lg"
            style={{ left: hover.x, top: hover.row * (BAR_PX + 12) - 52 }}
          >
            <p className="flex items-center gap-1.5 text-gray-200">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: hover.seg.color }} />
              {hover.seg.label}
            </p>
            <p className="text-gray-400 mt-0.5">
              {usd(hover.seg.usd)}
              {hover.row === 0 && routedTotal > 0 && <> · {Math.round((hover.seg.usd / routedTotal) * 100)}% of the routed cost</>}
            </p>
            {hover.seg.detail && <p className="text-gray-500">{hover.seg.detail}</p>}
          </div>
        )}
      </div>

      {/* Legend: always present, identity never by color alone */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-400">
        {[...rows[0].segs, solOnly].map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <details>
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">Show numbers</summary>
        <table className="mt-2 w-full text-xs">
          <tbody>
            {[...rows[0].segs, { ...solOnly, key: "sol-only-row" }].map((s) => (
              <tr key={s.key} className="border-t border-gray-800">
                <td className="py-1.5 text-gray-400">{s.label}</td>
                <td className="py-1.5 text-gray-500">{s.detail}</td>
                <td className="py-1.5 text-right text-gray-200 tabular-nums">{usd(s.usd)}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-700">
              <td className="py-1.5 text-gray-300">With Switchyard, total</td>
              <td />
              <td className="py-1.5 text-right text-gray-100 tabular-nums">{usd(routedTotal)}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );
}

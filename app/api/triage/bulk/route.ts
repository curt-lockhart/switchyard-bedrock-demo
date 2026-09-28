import { NextRequest } from "next/server";
import { z } from "zod";
import { triageTicket } from "@/lib/switchyard/client";

export const runtime = "nodejs";

const BulkSchema = z.object({
  tickets: z.array(z.object({
    id:           z.string(),
    subject:      z.string(),
    body:         z.string(),
    customerTier: z.string().optional().default("standard"),
  })),
  route:       z.string().optional(),
  concurrency: z.number().int().min(1).max(10).optional().default(5),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400 });
  }

  const { tickets, route, concurrency } = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));

      // Process with bounded concurrency
      let idx = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const i = idx++;
          if (i >= tickets.length) break;
          const ticket = tickets[i];
          try {
            const result = await triageTicket(ticket, route);
            send({ ok: true, index: i, ...result });
          } catch (err) {
            send({ ok: false, index: i, ticketId: ticket.id, error: String(err) });
          }
        }
      });

      await Promise.all(workers);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}

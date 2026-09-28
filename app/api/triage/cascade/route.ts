import { NextRequest } from "next/server";
import { z } from "zod";
import { triageTicket } from "@/lib/switchyard/client";

export const runtime = "nodejs";

const TicketSchema = z.object({
  id:           z.string().optional().default(() => `ticket-${Date.now()}`),
  subject:      z.string().min(1),
  body:         z.string().min(1),
  customerTier: z.string().optional().default("standard"),
  route:        z.string().optional(), // UI-selected Switchyard route
});

// POST /api/triage/cascade: one call to Switchyard, which owns the routing
// decision. Replies as SSE with a "result" or "error" event.
// The routing strategies (LLM classifier / 3-tier / baseline) are defined in
// switchyard.toml. The UI picks one per request; SWITCHYARD_ROUTE is the default.

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = TicketSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid ticket payload", details: parsed.error.flatten() }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const ticket = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const { decision, modelUsed, routeUsed, latencyMs, estimatedCostUsd } =
          await triageTicket(ticket, ticket.route);
        send("result", { decision, modelUsed, routeUsed, latencyMs, estimatedCostUsd });
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}

import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

interface Ticket { id: string; subject: string; body: string; customerTier: string }

const COUNT = 20;
// Bitext ticket IDs end in a difficulty bucket: -s simple, -m medium, -c complex.
const BUCKETS = ["s", "m", "c"];
// Where the hand-written high-risk tickets go (0-based), so 5, 10 and 20 ticket
// runs include 1, 2 and 4 of them.
const ESCALATION_POSITIONS = [2, 7, 12, 17];

const readJson = (file: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "data", file), "utf-8")) as Ticket[];

// Returns the bulk view's tickets: Bitext tickets dealt from the buckets in turn
// (s, m, c, s, ...) for variety, plus hand-written high-risk tickets (fraud, data
// loss, chargeback/legal threat, urgent money deadline) that should go to Sol.
// Bitext has almost no tickets like that, so without them every route looks the same.
export function GET() {
  const tickets = readJson("tickets.json");
  const escalations = readJson("escalation-tickets.json");

  const byBucket = BUCKETS.map((b) => tickets.filter((t) => t.id.endsWith(`-${b}`)));
  const routine: Ticket[] = [];
  const routineCount = COUNT - escalations.length;
  for (let i = 0; routine.length < routineCount && byBucket.some((list) => i < list.length); i++) {
    for (const list of byBucket) {
      if (i < list.length && routine.length < routineCount) routine.push(list[i]);
    }
  }

  const mixed = [...routine];
  escalations.forEach((t, i) => mixed.splice(ESCALATION_POSITIONS[i] ?? mixed.length, 0, t));
  return NextResponse.json(mixed.slice(0, COUNT));
}

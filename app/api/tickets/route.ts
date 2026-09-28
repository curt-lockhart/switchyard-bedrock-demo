import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export function GET() {
  const path = join(process.cwd(), "data", "tickets.json");
  const tickets = JSON.parse(readFileSync(path, "utf-8")) as unknown[];
  // Return first 20 for the demo picker
  return NextResponse.json(tickets.slice(0, 20));
}

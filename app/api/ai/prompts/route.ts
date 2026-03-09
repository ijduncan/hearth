import { NextResponse } from "next/server";
import { getTodaysPrompt } from "@/lib/prompts";

export async function GET() {
  const prompt = getTodaysPrompt();
  return NextResponse.json(prompt);
}

import { pruefeGesundheit } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const { status, body } = await pruefeGesundheit(process.env);
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

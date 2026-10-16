import type { OpsSnapshot } from "../../../lib/ops-snapshot";

type PublishedSnapshot = {
  snapshot: OpsSnapshot;
  publishedAt: string;
};

let latestSnapshot: PublishedSnapshot | null = null;

export async function POST(request: Request) {
  const snapshot = (await request.json()) as OpsSnapshot;
  if (
    typeof snapshot?.runId !== "string" ||
    typeof snapshot.stateVersion !== "number" ||
    typeof snapshot.simMinute !== "number" ||
    typeof snapshot.metrics !== "object" ||
    snapshot.metrics === null
  ) {
    return Response.json({ error: "Invalid simulation snapshot" }, { status: 400 });
  }

  latestSnapshot = { snapshot, publishedAt: new Date().toISOString() };
  return Response.json({ ok: true, publishedAt: latestSnapshot.publishedAt });
}

export async function GET() {
  if (!latestSnapshot) {
    return Response.json(
      { error: "No live simulation snapshot has been published yet" },
      { status: 503 },
    );
  }

  return Response.json(latestSnapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}

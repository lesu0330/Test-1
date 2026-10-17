import type { OpsSnapshot } from "../../../lib/ops-snapshot";
import { simulationStateRequest } from "../../../lib/simulation-state";

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

  const published = { snapshot, publishedAt: new Date().toISOString() };
  return simulationStateRequest("/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(published),
  });
}

export async function GET() {
  return simulationStateRequest("/snapshot");
}

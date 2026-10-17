type AssignmentCommand = {
  id: string;
  action: "start" | "pause" | "step_agent" | "reset" | "assign_waiting" | "assign_selected";
  runId: string;
  expectedStateVersion?: number;
  pairings?: Array<{ patientId: string; doctorId: string; roomId: string }>;
  status: "pending" | "applied" | "rejected";
  message?: string;
  assignedCount?: number;
};

const commands: AssignmentCommand[] = [];

export async function GET(request: Request) {
  const commandId = new URL(request.url).searchParams.get("id");
  if (commandId) {
    const command = commands.find((item) => item.id === commandId);
    if (!command) return Response.json({ error: "Unknown simulation command" }, { status: 404 });
    return Response.json(command, { headers: { "Cache-Control": "no-store" } });
  }

  return Response.json(
    { commands: commands.filter((command) => command.status === "pending") },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;

  if (typeof input.commandId === "string") {
    const assignedCount = input.assignedCount;
    let acknowledgedCount: number | undefined;
    if (
      assignedCount !== undefined &&
      (typeof assignedCount !== "number" || !Number.isInteger(assignedCount) || assignedCount < 0)
    ) {
      return Response.json({ error: "Invalid command acknowledgement" }, { status: 400 });
    }
    if (typeof assignedCount === "number") acknowledgedCount = assignedCount;
    if (
      (input.status !== "applied" && input.status !== "rejected") ||
      typeof input.message !== "string"
    ) {
      return Response.json({ error: "Invalid command acknowledgement" }, { status: 400 });
    }
    const command = commands.find((item) => item.id === input.commandId);
    if (!command) return Response.json({ error: "Unknown simulation command" }, { status: 404 });
    if (command.status !== "pending") {
      return Response.json({ error: "Simulation command was already acknowledged" }, { status: 409 });
    }
    command.status = input.status;
    command.message = input.message;
    command.assignedCount = acknowledgedCount;
    return Response.json(command);
  }

  if (
    (!["start", "pause", "step_agent", "reset", "assign_waiting", "assign_selected"].includes(String(input.action))) ||
    typeof input.runId !== "string" ||
    !input.runId
  ) {
    return Response.json({ error: "Invalid simulation command" }, { status: 400 });
  }
  let pairings: AssignmentCommand["pairings"];
  let expectedStateVersion: number | undefined;
  if (input.action === "assign_selected") {
    if (!Number.isInteger(input.expectedStateVersion) || (input.expectedStateVersion as number) < 0) {
      return Response.json({ error: "Provide the snapshot state version for selected assignments" }, { status: 400 });
    }
    expectedStateVersion = input.expectedStateVersion as number;
    if (!Array.isArray(input.pairings) || input.pairings.length < 1 || input.pairings.length > 20) {
      return Response.json({ error: "Provide between 1 and 20 patient-doctor-room pairings" }, { status: 400 });
    }
    const parsedPairings: NonNullable<AssignmentCommand["pairings"]> = [];
    const patientIds = new Set<string>();
    for (const pairing of input.pairings) {
      if (
        typeof pairing !== "object" ||
        pairing === null ||
        Array.isArray(pairing) ||
        typeof pairing.patient_id !== "string" ||
        typeof pairing.doctor_id !== "string" ||
        typeof pairing.room_id !== "string" ||
        !pairing.patient_id ||
        !pairing.doctor_id ||
        !pairing.room_id
      ) {
        return Response.json({ error: "Each pairing must include patient_id, doctor_id, and room_id" }, { status: 400 });
      }
      if (patientIds.has(pairing.patient_id)) {
        return Response.json({ error: `Patient ${pairing.patient_id} appears more than once` }, { status: 400 });
      }
      patientIds.add(pairing.patient_id);
      parsedPairings.push({
        patientId: pairing.patient_id,
        doctorId: pairing.doctor_id,
        roomId: pairing.room_id,
      });
    }
    pairings = parsedPairings;
  }
  if (commands.filter((command) => command.status === "pending").length >= 20) {
    return Response.json({ error: "Simulation command queue is full" }, { status: 429 });
  }

  const command: AssignmentCommand = {
    id: crypto.randomUUID(),
    action: input.action as AssignmentCommand["action"],
    runId: input.runId,
    expectedStateVersion,
    pairings,
    status: "pending",
  };
  commands.push(command);
  if (commands.length > 100) commands.splice(0, commands.length - 100);
  return Response.json(command, { status: 202 });
}

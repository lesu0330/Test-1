import { adviseLocally, COPILOT_SYSTEM_PROMPT, type CopilotMessage } from "../../../lib/ops-copilot";
import type { OpsSnapshot } from "../../../lib/ops-snapshot";

type Payload = {
  question?: string;
  snapshot?: OpsSnapshot;
  history?: CopilotMessage[];
};

async function completeWithModel(snapshot: OpsSnapshot, question: string, history: CopilotMessage[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: COPILOT_SYSTEM_PROMPT },
        { role: "system", content: `Live twin snapshot JSON:\n${JSON.stringify(snapshot)}` },
        ...history.slice(-8),
        { role: "user", content: question },
      ],
    }),
  });

  if (!response.ok) return null;
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content?.trim();
  return content || null;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Payload;
  const question = payload.question?.trim() ?? "";
  const snapshot = payload.snapshot;
  if (!snapshot || !question) {
    return Response.json({ error: "question and snapshot are required" }, { status: 400 });
  }

  const local = adviseLocally(snapshot, question);
  try {
    const modelReply = await completeWithModel(snapshot, question, payload.history ?? []);
    if (modelReply) {
      return Response.json({ ...local, reply: modelReply, source: "model" });
    }
  } catch {
    // Keep the grounded local briefing if the model call is unavailable.
  }
  return Response.json(local);
}

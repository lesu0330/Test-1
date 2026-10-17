import { DurableObject } from "cloudflare:workers";
import type { OpsSnapshot } from "../lib/ops-snapshot";

type PublishedSnapshot = {
  snapshot: OpsSnapshot;
  publishedAt: string;
};

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

const SNAPSHOT_KEY = "latest-snapshot";
const COMMANDS_KEY = "commands";

export class SimulationState extends DurableObject {
  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === "/snapshot" && request.method === "POST") {
      const published = (await request.json()) as PublishedSnapshot;
      await this.ctx.storage.put(SNAPSHOT_KEY, published);
      return Response.json({ ok: true, publishedAt: published.publishedAt });
    }

    if (url.pathname === "/snapshot" && request.method === "GET") {
      const published = await this.ctx.storage.get<PublishedSnapshot>(SNAPSHOT_KEY);
      if (!published) {
        return Response.json(
          { error: "No live simulation snapshot has been published yet" },
          { status: 503 },
        );
      }
      return Response.json(published, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (url.pathname === "/commands" && request.method === "GET") {
      const commands = (await this.ctx.storage.get<AssignmentCommand[]>(COMMANDS_KEY)) ?? [];
      const commandId = url.searchParams.get("id");
      if (commandId) {
        const command = commands.find((item) => item.id === commandId);
        if (!command) {
          return Response.json({ error: "Unknown simulation command" }, { status: 404 });
        }
        return Response.json(command, { headers: { "Cache-Control": "no-store" } });
      }
      return Response.json(
        { commands: commands.filter((command) => command.status === "pending") },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (url.pathname === "/commands" && request.method === "POST") {
      const command = (await request.json()) as AssignmentCommand;
      const result = await this.ctx.storage.transaction(async (transaction) => {
        const commands = (await transaction.get<AssignmentCommand[]>(COMMANDS_KEY)) ?? [];
        if (commands.filter((item) => item.status === "pending").length >= 20) {
          return null;
        }
        commands.push(command);
        if (commands.length > 100) commands.splice(0, commands.length - 100);
        await transaction.put(COMMANDS_KEY, commands);
        return command;
      });
      if (!result) {
        return Response.json({ error: "Simulation command queue is full" }, { status: 429 });
      }
      return Response.json(result, { status: 202 });
    }

    if (url.pathname === "/commands" && request.method === "PATCH") {
      const input = (await request.json()) as {
        commandId: string;
        status: "applied" | "rejected";
        message: string;
        assignedCount?: number;
      };
      const result = await this.ctx.storage.transaction(async (transaction) => {
        const commands = (await transaction.get<AssignmentCommand[]>(COMMANDS_KEY)) ?? [];
        const command = commands.find((item) => item.id === input.commandId);
        if (!command) return { status: 404 as const, error: "Unknown simulation command" };
        if (command.status !== "pending") {
          return { status: 409 as const, error: "Simulation command was already acknowledged" };
        }
        command.status = input.status;
        command.message = input.message;
        command.assignedCount = input.assignedCount;
        await transaction.put(COMMANDS_KEY, commands);
        return { status: 200 as const, command };
      });
      if ("error" in result) {
        return Response.json({ error: result.error }, { status: result.status });
      }
      return Response.json(result.command);
    }

    return Response.json({ error: "Unknown simulation state operation" }, { status: 404 });
  }
}

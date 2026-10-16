import type { OpsSnapshot } from "./ops-snapshot";

export type CopilotMessage = { role: "user" | "assistant"; content: string };

export type CopilotRecommendation = {
  title: string;
  why: string;
  entityId?: string;
  injectHint?: "NEW_PATIENT" | "STAFF_UNAVAILABLE" | "AMBULANCE_DELAY" | "ROOM_FAULT" | "PATIENT_DETERIORATION";
};

export type CopilotAnswer = {
  reply: string;
  recommendations: CopilotRecommendation[];
  source: "local" | "model";
};

function constraintCounts(snapshot: OpsSnapshot) {
  const counts = new Map<string, number>();
  for (const patient of snapshot.waiting) {
    for (const part of (patient.blockedReason ?? "").split(";").map((item) => item.trim()).filter(Boolean)) {
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function atRisk(snapshot: OpsSnapshot) {
  return [...snapshot.waiting]
    .sort((a, b) => {
      const score = (patient: (typeof snapshot.waiting)[number]) =>
        (patient.condition === "critical" ? 30 : patient.condition === "worsening" ? 18 : 0) +
        (6 - patient.severity) * 8 +
        Math.min(patient.waitMinutes, 40) +
        patient.deteriorations * 6;
      return score(b) - score(a);
    })
    .slice(0, 4);
}

function defaultRecommendations(snapshot: OpsSnapshot): CopilotRecommendation[] {
  const recs: CopilotRecommendation[] = [];
  const bottlenecks = constraintCounts(snapshot);
  const risk = atRisk(snapshot)[0];
  const nextIncident = snapshot.upcomingIncidents[0];
  const offline = snapshot.resources.find((resource) => resource.status === "offline");
  const inboundCritical = snapshot.inbound.find((unit) => unit.severity <= 2);

  if (bottlenecks[0]) {
    recs.push({
      title: `Relieve “${bottlenecks[0][0]}”`,
      why: `${bottlenecks[0][1]} waiting patient${bottlenecks[0][1] === 1 ? " is" : "s are"} blocked by this constraint. The autonomous policy cannot start treatment until it clears.`,
      entityId: snapshot.waiting.find((patient) => patient.blockedReason?.includes(bottlenecks[0][0]))?.id,
    });
  }
  if (risk) {
    recs.push({
      title: `Watch ${risk.name} (${risk.id})`,
      why: `P${risk.severity}, ${risk.condition}, waited ${risk.waitMinutes}m${risk.blockedReason ? `; blocked by ${risk.blockedReason}` : ""}. Highest deterioration pressure in the current queue.`,
      entityId: risk.id,
      injectHint: "PATIENT_DETERIORATION",
    });
  }
  if (offline) {
    recs.push({
      title: `Plan around ${offline.label} being offline`,
      why: `Shared capacity is ${offline.used}/${offline.capacity}${offline.offlineUntil ? ` until ${offline.offlineUntil}` : ""}. Delay non-urgent diagnostics that depend on it.`,
      entityId: offline.id,
    });
  } else if (inboundCritical) {
    recs.push({
      title: `Pre-stage for ${inboundCritical.callSign}`,
      why: `${inboundCritical.name} (P${inboundCritical.severity}) is ${inboundCritical.etaMinutes}m out. Hold a compatible room and trauma coverage if still free.`,
      entityId: inboundCritical.patientId,
      injectHint: "AMBULANCE_DELAY",
    });
  } else if (nextIncident) {
    recs.push({
      title: `Prepare for ${nextIncident.time}: ${nextIncident.title}`,
      why: "The scenario feed is deterministic. Use the next scheduled shock to test whether the current assignment policy still holds.",
    });
  }
  if (snapshot.metrics.activeConflicts === 0 && snapshot.metrics.waiting > 0) {
    recs.push({
      title: "Let the baseline policy keep assigning",
      why: "No blocked assignments right now. Stepping the twin is more useful than injecting a disruption.",
    });
  }
  return recs.slice(0, 3);
}

function situationBrief(snapshot: OpsSnapshot) {
  const lines = [
    `At ${snapshot.simTime} (v${snapshot.stateVersion}) the twin is ${snapshot.complete ? "complete" : "in progress"}: ${snapshot.metrics.waiting} waiting, ${snapshot.metrics.treating} in treatment, ${snapshot.metrics.inbound} inbound, ${snapshot.metrics.activeConflicts} blocked assignments, ${snapshot.metrics.resourcePressure}% resource pressure.`,
  ];
  const blocked = snapshot.waiting.filter((patient) => patient.blockedReason);
  if (blocked.length) {
    lines.push(
      `Blocked queue: ${blocked
        .slice(0, 5)
        .map((patient) => `${patient.name} P${patient.severity} (${patient.blockedReason})`)
        .join("; ")}.`,
    );
  } else if (snapshot.waiting.length) {
    lines.push("The waiting list has no current assignment conflicts; the head-nurse policy can place the next eligible patient.");
  }
  if (snapshot.inbound.length) {
    lines.push(
      `Inbound: ${snapshot.inbound.map((unit) => `${unit.callSign} ${unit.name} P${unit.severity} in ${unit.etaMinutes}m`).join("; ")}.`,
    );
  }
  const bottlenecks = constraintCounts(snapshot);
  if (bottlenecks.length) lines.push(`Dominant constraints: ${bottlenecks.slice(0, 3).map(([label, count]) => `${label} ×${count}`).join(", ")}.`);
  if (snapshot.upcomingIncidents[0]) lines.push(`Next scheduled incident at ${snapshot.upcomingIncidents[0].time}: ${snapshot.upcomingIncidents[0].title}.`);
  lines.push("This is operational decision support on synthetic data, not clinical guidance. The copilot does not change the simulation.");
  return lines.join(" ");
}

export function adviseLocally(snapshot: OpsSnapshot, question: string): CopilotAnswer {
  const q = question.trim().toLowerCase();
  const recs = defaultRecommendations(snapshot);
  const mentioned = [...snapshot.waiting, ...snapshot.treating].find((patient) =>
    q.includes(patient.id.toLowerCase()) || q.includes(patient.name.toLowerCase()),
  );
  const mentionedRoom = snapshot.rooms.find((room) => q.includes(room.id.toLowerCase()) || q.includes(room.label.toLowerCase()));
  const mentionedResource = snapshot.resources.find((resource) => q.includes(resource.label.toLowerCase()) || q.includes(resource.id.toLowerCase()));

  let reply = situationBrief(snapshot);

  if (/bottleneck|constraint|blocked|conflict|pressure/.test(q)) {
    const bottlenecks = constraintCounts(snapshot);
    reply = bottlenecks.length
      ? `Current bottlenecks at ${snapshot.simTime}: ${bottlenecks.map(([label, count]) => `${label} (${count})`).join("; ")}. ${situationBrief(snapshot)}`
      : `No assignment bottlenecks at ${snapshot.simTime}. ${situationBrief(snapshot)}`;
  } else if (/deterior|risk|critical|acuity|worsen/.test(q)) {
    const risk = atRisk(snapshot);
    reply = risk.length
      ? `Highest operational risk: ${risk
          .map((patient) => `${patient.name} ${patient.id} P${patient.severity} ${patient.condition}, ${patient.waitMinutes}m wait${patient.blockedReason ? `, blocked (${patient.blockedReason})` : ""}`)
          .join("; ")}. ${situationBrief(snapshot)}`
      : `No waiting patients currently sit on the deterioration-risk list. ${situationBrief(snapshot)}`;
  } else if (/inject|disrupt|next action|recommend|what should|judge/.test(q)) {
    reply = recs.length
      ? `Recommended operator moves (advisory only): ${recs.map((item) => `${item.title} — ${item.why}`).join(" ")}`
      : situationBrief(snapshot);
  } else if (/staff|nurse|doctor|team/.test(q)) {
    const available = snapshot.staff.filter((member) => member.status === "available");
    reply = `Team: ${snapshot.staff.length} on roster, ${available.length} available (${available.map((member) => member.name).join(", ") || "none"}). ${situationBrief(snapshot)}`;
  } else if (/room|bed|resus|floor/.test(q)) {
    reply = `Rooms: ${snapshot.rooms.map((room) => `${room.label} ${room.status}`).join(", ")}. ${situationBrief(snapshot)}`;
  } else if (/ambulance|inbound|eta|bay/.test(q)) {
    reply = snapshot.inbound.length
      ? `Ambulance bay: ${snapshot.inbound.map((unit) => `${unit.callSign} ${unit.name} P${unit.severity} ETA ${unit.etaMinutes}m`).join("; ")}. ${situationBrief(snapshot)}`
      : `Ambulance bay is clear. ${situationBrief(snapshot)}`;
  } else if (mentioned) {
    reply = `${mentioned.name} (${mentioned.id}) is ${"waitMinutes" in mentioned ? `waiting ${mentioned.waitMinutes}m as P${mentioned.severity} ${mentioned.condition}${mentioned.blockedReason ? `; blocked by ${mentioned.blockedReason}` : ""}` : `in treatment with ${mentioned.remainingMinutes}m remaining`}. The copilot will not reassign this patient; use this as a briefing for the operator.`;
  } else if (mentionedRoom) {
    reply = `${mentionedRoom.label} is ${mentionedRoom.status}${mentionedRoom.patientId ? ` with ${mentionedRoom.patientId}` : ""}.`;
  } else if (mentionedResource) {
    reply = `${mentionedResource.label} is ${mentionedResource.status} (${mentionedResource.used}/${mentionedResource.capacity})${mentionedResource.offlineUntil ? `, restore ${mentionedResource.offlineUntil}` : ""}.`;
  } else if (q && !/what.*(happen|status|going)|brief|summar|overview|hello|hi\b/.test(q)) {
    reply = `I can only brief this live twin. ${situationBrief(snapshot)} Ask about bottlenecks, deterioration risk, inbound ambulances, or the next operator move.`;
  }

  return { reply, recommendations: recs, source: "local" };
}

export const COPILOT_SYSTEM_PROMPT = `You are UNIQ Ops Copilot, an emergency-operations advisor for a synthetic ER digital twin.
Rules:
- Use only the provided snapshot. Do not invent patients, rooms, times, or resources.
- Give concise operational briefings: bottlenecks, who is blocked, inbound pressure, and 2-3 next actions.
- Never claim to change the simulation. Never give medical treatment advice.
- If asked for clinical care, refuse and redirect to operational constraints.
- Mention entity IDs (P-101, R-01, RES-CT) so the operator can inspect them.`;

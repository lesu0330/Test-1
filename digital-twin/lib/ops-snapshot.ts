import { formatSimTime } from "../simulation/engine";
import type { SimulationState } from "../simulation/types";

export type OpsSnapshot = {
  runId: string;
  scenarioId: string;
  seed: number;
  simTime: string;
  simMinute: number;
  stateVersion: number;
  complete: boolean;
  metrics: SimulationState["metrics"];
  waiting: Array<{
    id: string;
    name: string;
    severity: number;
    condition: string;
    waitMinutes: number;
    room: string;
    resources: string[];
    specialty: string;
    blockedReason?: string;
    deteriorations: number;
  }>;
  treating: Array<{
    id: string;
    name: string;
    severity: number;
    roomId?: string;
    remainingMinutes: number;
  }>;
  inbound: Array<{
    callSign: string;
    patientId: string;
    name: string;
    severity: number;
    etaMinutes: number;
  }>;
  rooms: Array<{ id: string; label: string; type: string; status: string; patientId?: string }>;
  staff: Array<{
    id: string;
    name: string;
    role: string;
    specialty: string;
    status: string;
    patientId?: string;
    roomId?: string;
  }>;
  resources: Array<{
    id: string;
    label: string;
    status: string;
    used: number;
    capacity: number;
    offlineUntil?: string;
  }>;
  upcomingIncidents: Array<{ minute: number; time: string; title: string }>;
  occurredIncidents: string[];
  recentEvents: Array<{ time: string; level: string; summary: string; details: string }>;
};

export function buildOpsSnapshot(state: SimulationState): OpsSnapshot {
  return {
    runId: state.runId,
    scenarioId: state.scenarioId,
    seed: state.seed,
    simTime: formatSimTime(state.simMinute),
    simMinute: state.simMinute,
    stateVersion: state.stateVersion,
    complete: state.patients.length > 0 && state.patients.every((patient) => patient.status === "discharged"),
    metrics: state.metrics,
    waiting: state.patients
      .filter((patient) => patient.status === "waiting")
      .sort((a, b) => a.severity - b.severity || b.waitMinutes - a.waitMinutes)
      .map((patient) => ({
        id: patient.id,
        name: patient.name,
        severity: patient.severity,
        condition: patient.condition,
        waitMinutes: patient.waitMinutes,
        room: patient.requiredRoomType,
        resources: patient.requiredResources,
        specialty: patient.requiredSpecialty ?? "General",
        blockedReason: patient.blockedReason,
        deteriorations: patient.deteriorationEvents,
      })),
    treating: state.patients
      .filter((patient) => patient.status === "treating")
      .map((patient) => ({
        id: patient.id,
        name: patient.name,
        severity: patient.severity,
        roomId: patient.assignedRoomId,
        remainingMinutes: patient.remainingMinutes,
      })),
    inbound: state.ambulances
      .filter((ambulance) => ambulance.status === "inbound")
      .map((ambulance) => {
        const patient = state.patients.find((item) => item.id === ambulance.patientId);
        return {
          callSign: ambulance.callSign,
          patientId: ambulance.patientId,
          name: patient?.name ?? ambulance.patientId,
          severity: patient?.severity ?? 5,
          etaMinutes: ambulance.etaMinutes,
        };
      }),
    rooms: state.rooms.map((room) => ({
      id: room.id,
      label: room.label,
      type: room.type,
      status: room.status,
      patientId: room.patientId,
    })),
    staff: state.staff.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      specialty: member.specialty,
      status: member.status,
      patientId: member.patientId,
      roomId: member.roomId,
    })),
    resources: state.resources.map((resource) => ({
      id: resource.id,
      label: resource.label,
      status: resource.status,
      used: resource.assignedPatientIds.length,
      capacity: resource.capacity,
      offlineUntil: resource.offlineUntilMinute ? formatSimTime(resource.offlineUntilMinute) : undefined,
    })),
    upcomingIncidents: state.incidents
      .filter((incident) => incident.status === "scheduled")
      .slice(0, 4)
      .map((incident) => ({
        minute: incident.minute,
        time: formatSimTime(incident.minute),
        title: incident.title,
      })),
    occurredIncidents: state.incidents.filter((incident) => incident.status === "occurred").map((incident) => incident.title),
    recentEvents: state.events.slice(-12).map((event) => ({
      time: formatSimTime(event.simMinute),
      level: event.level,
      summary: event.summary,
      details: event.details,
    })),
  };
}

import { nextRandom } from "./rng";
import { createInitialState } from "./scenario";
import type { AuditEvent, DisruptionType, LogCategory, LogLevel, Patient, ResourceType, SimulationMetrics, SimulationState } from "./types";

type EventInput = Omit<AuditEvent, "id" | "correlationId" | "simMinute" | "stateVersion"> & { correlationId?: string };

function addEvent(state: SimulationState, event: EventInput) {
  state.eventSequence += 1;
  const id = `EVT-${String(state.eventSequence).padStart(4, "0")}`;
  state.events.push({ ...event, id, correlationId: event.correlationId ?? id, simMinute: state.simMinute, stateVersion: state.stateVersion });
}

function updateResourceStatuses(state: SimulationState) {
  for (const resource of state.resources) {
    if (resource.status === "offline") continue;
    resource.status = resource.assignedPatientIds.length >= resource.capacity ? "constrained" : "available";
  }
}

function recalculateMetrics(state: SimulationState): SimulationMetrics {
  const waiting = state.patients.filter((patient) => patient.status === "waiting").length;
  const treating = state.patients.filter((patient) => patient.status === "treating").length;
  const discharged = state.patients.filter((patient) => patient.status === "discharged").length;
  const critical = state.patients.filter((patient) => patient.condition === "critical" && patient.status !== "discharged").length;
  const occupiedRooms = state.rooms.filter((room) => room.status === "occupied").length;
  const completedWaits = state.patients.filter((patient) => patient.status === "treating" || patient.status === "discharged").map((patient) => patient.waitMinutes);
  const meanWait = completedWaits.length ? completedWaits.reduce((sum, value) => sum + value, 0) / completedWaits.length : 0;
  const totalResourceCapacity = state.resources.reduce((sum, resource) => sum + resource.capacity, 0);
  const usedResourceCapacity = state.resources.reduce((sum, resource) => sum + resource.assignedPatientIds.length, 0);
  return {
    waiting,
    treating,
    discharged,
    critical,
    occupiedRooms,
    roomUtilization: Math.round((occupiedRooms / state.rooms.length) * 100),
    meanWait: Math.round(meanWait * 10) / 10,
    peakQueue: Math.max(state.metrics.peakQueue, waiting),
    deteriorationEvents: state.patients.reduce((sum, patient) => sum + patient.deteriorationEvents, 0),
    inbound: state.ambulances.filter((ambulance) => ambulance.status === "inbound").length,
    activeConflicts: state.patients.filter((patient) => patient.status === "waiting" && patient.blockedReason).length,
    offlineResources: state.resources.filter((resource) => resource.status === "offline").length,
    resourcePressure: totalResourceCapacity ? Math.round((usedResourceCapacity / totalResourceCapacity) * 100) : 0,
  };
}

export function initializeSimulation(seed = 42) {
  const state = createInitialState(seed);
  updateResourceStatuses(state);
  addEvent(state, { type: "SIMULATION_STARTED", category: "simulation", level: "success", source: "Simulation engine", summary: "Cascading mass-casualty scenario initialized", details: `Run ${state.runId} started with deterministic seed ${state.seed}, ten synthetic patients, four inbound ambulances, and nine scheduled incidents.`, entityIds: [] });
  addEvent(state, { type: "CAPACITY_WARNING", category: "validation", level: "warning", source: "Constraint validator", summary: "Emergency department begins near capacity", details: "Two rooms, two doctors, two nurses, and one ventilator are already committed before the casualty surge arrives.", entityIds: ["R-01", "R-02", "D-01", "D-02", "N-01", "N-02", "RES-VENT"] });
  addEvent(state, { type: "AMBULANCE_WAVE_INBOUND", category: "ambulance", level: "critical", source: "Ambulance feed", summary: "Four casualty transports are converging", details: "Arrival estimates are staggered over ten minutes; three patients may require resuscitation capacity.", entityIds: state.ambulances.map((ambulance) => ambulance.id) });
  state.metrics = recalculateMetrics(state);
  return state;
}

function releaseStaff(state: SimulationState, patientId: string) {
  for (const member of state.staff.filter((item) => item.patientId === patientId)) {
    member.status = "available";
    delete member.patientId;
    delete member.roomId;
    addEvent(state, { type: "STAFF_AVAILABLE", category: "staff", level: "info", source: "Workflow engine", summary: `${member.name} is available`, details: `Assignment to ${patientId} ended after treatment completion.`, entityIds: [member.id, patientId] });
  }
}

function releaseResources(state: SimulationState, patientId: string) {
  const released = state.resources.filter((resource) => resource.assignedPatientIds.includes(patientId));
  for (const resource of released) resource.assignedPatientIds = resource.assignedPatientIds.filter((id) => id !== patientId);
  if (released.length) addEvent(state, { type: "CRITICAL_RESOURCES_RELEASED", category: "system", level: "success", source: "Resource coordinator", summary: `Critical resources released by ${patientId}`, details: `${released.map((resource) => resource.label).join(", ")} returned to the shared capacity pool.`, entityIds: [patientId, ...released.map((resource) => resource.id)] });
  updateResourceStatuses(state);
}

function updateTreatments(state: SimulationState) {
  for (const patient of state.patients.filter((item) => item.status === "treating")) {
    patient.remainingMinutes = Math.max(0, patient.remainingMinutes - 1);
    if (patient.remainingMinutes > 0) continue;
    patient.status = "discharged";
    patient.condition = "stable";
    const room = state.rooms.find((item) => item.id === patient.assignedRoomId);
    if (room) { room.status = "dirty"; delete room.patientId; room.cleaningMinutesRemaining = 4; }
    releaseStaff(state, patient.id);
    releaseResources(state, patient.id);
    addEvent(state, { type: "TREATMENT_COMPLETED", category: "patient", level: "success", source: "Treatment workflow", summary: `${patient.name} completed simulated treatment`, details: `${patient.id} was discharged. ${room?.label ?? "The room"} now requires turnover.`, entityIds: [patient.id, ...(room ? [room.id] : [])], before: { status: "treating" }, after: { status: "discharged" } });
  }
}

function updateRooms(state: SimulationState) {
  for (const room of state.rooms) {
    if (room.status === "dirty") {
      room.status = "cleaning";
      addEvent(state, { type: "ROOM_CLEANING_STARTED", category: "room", level: "info", source: "Room workflow", summary: `${room.label} turnover started`, details: `Estimated ready time is ${room.cleaningMinutesRemaining} minutes.`, entityIds: [room.id] });
      continue;
    }
    if (room.status !== "cleaning") continue;
    room.cleaningMinutesRemaining = Math.max(0, room.cleaningMinutesRemaining - 1);
    if (room.cleaningMinutesRemaining > 0) continue;
    room.status = room.reservedForPatientId ? "reserved" : "ready";
    addEvent(state, { type: "ROOM_READY", category: "room", level: "success", source: "Room workflow", summary: `${room.label} is ${room.status}`, details: room.reservedForPatientId ? `Room is ready and held for ${room.reservedForPatientId}.` : "Room is clean and available for assignment.", entityIds: [room.id, ...(room.reservedForPatientId ? [room.reservedForPatientId] : [])] });
  }
}

function processScheduledIncidents(state: SimulationState) {
  for (const incident of state.incidents.filter((item) => item.status === "scheduled" && item.minute === state.simMinute)) {
    incident.status = "occurred";
    if (incident.type === "MCI_DECLARED") {
      addEvent(state, { type: incident.type, category: "system", level: "critical", source: "Regional incident feed", summary: incident.title, details: "The ER enters mass-casualty mode. Incoming demand now exceeds ordinary resuscitation and trauma capacity.", entityIds: incident.entityIds });
    } else if (incident.type === "CT_OFFLINE") {
      const resource = state.resources.find((item) => item.id === "RES-CT")!;
      const impacted = [...resource.assignedPatientIds];
      resource.status = "offline";
      resource.offlineUntilMinute = 22;
      for (const patientId of impacted) {
        const patient = state.patients.find((item) => item.id === patientId);
        if (patient) patient.remainingMinutes += 5;
      }
      addEvent(state, { type: incident.type, category: "system", level: "critical", source: "Equipment telemetry", summary: incident.title, details: `CT capacity is unavailable until minute 22.${impacted.length ? ` ${impacted.join(", ")} receives a five-minute treatment delay.` : ""}`, entityIds: [resource.id, ...impacted], before: { status: "available" }, after: { status: "offline", expectedRestoreMinute: 22 } });
    } else if (incident.type === "ACUITY_UPDATE") {
      const patient = state.patients.find((item) => item.id === "P-108")!;
      const before = { severity: patient.severity, condition: patient.condition, requiredRoomType: patient.requiredRoomType };
      patient.severity = 1; patient.condition = "critical"; patient.requiredRoomType = "resus"; patient.requiredResources = ["ct", "blood"]; delete patient.blockedReason;
      addEvent(state, { type: incident.type, category: "ambulance", level: "critical", source: "Medic 21 telemetry", summary: incident.title, details: "New hypotension and abdominal findings invalidate the original acute-room plan and create another resuscitation, CT, blood, and trauma-team conflict.", entityIds: incident.entityIds, before, after: { severity: 1, condition: "critical", requiredRoomType: "resus", requiredResources: patient.requiredResources } });
    } else if (incident.type === "STAFF_LOSS") {
      const nurse = state.staff.find((item) => item.id === "N-04")!;
      const before = nurse.status;
      if (nurse.status === "available") nurse.status = "unavailable";
      addEvent(state, { type: incident.type, category: "staff", level: "warning", source: "Staffing feed", summary: incident.title, details: before === "available" ? "One of two initially available nurses is no longer assignable during the surge." : "The roster change was received, but the nurse was already committed to active care.", entityIds: [nurse.id], before: { status: before }, after: { status: nurse.status } });
    } else if (incident.type === "ROOM_FAULT") {
      const room = state.rooms.find((item) => item.id === "R-06")!;
      const before = room.status;
      if (room.status === "ready") room.status = "unavailable";
      addEvent(state, { type: incident.type, category: "room", level: "warning", source: "Facilities telemetry", summary: incident.title, details: room.status === "unavailable" ? "The room is removed from the assignment pool while demand is rising." : "The fault could not take the occupied room offline immediately and requires manual coordination.", entityIds: [room.id], before: { status: before }, after: { status: room.status } });
    } else if (incident.type === "SECONDARY_DETERIORATION") {
      const patient = state.patients.find((item) => item.id === "P-110")!;
      const before = { severity: patient.severity, condition: patient.condition, requiredRoomType: patient.requiredRoomType };
      patient.severity = 1; patient.condition = "critical"; patient.requiredRoomType = "resus"; patient.requiredResources = ["isolation", "ventilator"]; patient.deteriorationEvents += 1; delete patient.blockedReason;
      addEvent(state, { type: incident.type, category: "patient", level: "critical", source: "Bedside monitoring feed", summary: incident.title, details: "A patient already inside the ER now competes with incoming casualties for a resuscitation room, ventilator, nurse, and isolation capacity.", entityIds: [patient.id], before, after: { severity: 1, condition: "critical", requiredRoomType: "resus", requiredResources: patient.requiredResources } });
    } else if (incident.type === "CT_RESTORED") {
      const resource = state.resources.find((item) => item.id === "RES-CT")!;
      delete resource.offlineUntilMinute;
      resource.status = resource.assignedPatientIds.length >= resource.capacity ? "constrained" : "available";
      addEvent(state, { type: incident.type, category: "system", level: "success", source: "Equipment telemetry", summary: incident.title, details: "Diagnostic capacity is restored, but queued demand must still be sequenced against the single scanner.", entityIds: [resource.id], before: { status: "offline" }, after: { status: resource.status } });
    } else if (incident.type === "SURGE_TEAM_ARRIVES") {
      state.staff.push(
        { id: "D-04", name: "Dr. Mensah", role: "doctor", specialty: "Trauma", status: "available" },
        { id: "N-05", name: "Nurse Novak", role: "nurse", specialty: "Critical care", status: "available" },
      );
      addEvent(state, { type: incident.type, category: "staff", level: "success", source: "Staffing feed", summary: incident.title, details: "One trauma doctor and one critical-care nurse join the active assignment pool.", entityIds: incident.entityIds });
    } else {
      const resource = state.resources.find((item) => item.id === "RES-BLOOD")!;
      const before = resource.capacity;
      resource.capacity = 3;
      addEvent(state, { type: incident.type, category: "system", level: "success", source: "Supply feed", summary: incident.title, details: "Emergency blood capacity increases from one to three concurrent allocations.", entityIds: [resource.id], before: { capacity: before }, after: { capacity: resource.capacity } });
    }
  }
  updateResourceStatuses(state);
}

function updateAmbulances(state: SimulationState) {
  for (const ambulance of state.ambulances.filter((item) => item.status === "inbound")) {
    ambulance.etaMinutes = Math.max(0, ambulance.etaMinutes - 1);
    if (ambulance.etaMinutes === 1) addEvent(state, { type: "AMBULANCE_FINAL_APPROACH", category: "ambulance", level: "warning", source: "Ambulance feed", summary: `${ambulance.callSign} is one minute away`, details: "Room, specialist, staff, and critical-resource readiness will be checked on arrival.", entityIds: [ambulance.id, ambulance.patientId] });
    if (ambulance.etaMinutes > 0) continue;
    ambulance.status = "arrived";
    const patient = state.patients.find((item) => item.id === ambulance.patientId);
    if (patient) patient.status = "waiting";
    addEvent(state, { type: "AMBULANCE_ARRIVED", category: "ambulance", level: patient?.severity === 1 ? "critical" : "warning", source: "Ambulance feed", summary: `${ambulance.callSign} arrived with ${patient?.name ?? "patient"}`, details: "The patient entered the ER queue; all room, team, specialty, and equipment constraints will be validated before treatment.", entityIds: [ambulance.id, ambulance.patientId] });
  }
}

function updateWaitingPatients(state: SimulationState) {
  for (const patient of state.patients.filter((item) => item.status === "waiting")) {
    patient.waitMinutes += 1;
    const conditionFactor = patient.condition === "worsening" ? 2.2 : patient.condition === "critical" ? 3.2 : 1;
    const hazard = patient.baseHazard * (1 + patient.waitMinutes / 30) * conditionFactor;
    if (nextRandom(state) >= 1 - Math.exp(-hazard)) continue;
    const before = patient.condition;
    patient.condition = before === "stable" ? "worsening" : "critical";
    patient.severity = Math.max(1, patient.severity - 1) as Patient["severity"];
    if (patient.condition === "critical") {
      patient.requiredRoomType = "resus";
      if (!patient.requiredResources.includes("ventilator")) patient.requiredResources.push("ventilator");
    }
    patient.deteriorationEvents += 1;
    delete patient.blockedReason;
    addEvent(state, { type: "PATIENT_DETERIORATED", category: "patient", level: "critical", source: "Synthetic deterioration model", summary: `${patient.name} deteriorated while waiting`, details: `Synthetic transition from ${before} to ${patient.condition}; operational priority is now ${patient.severity} and requirements were revalidated.`, entityIds: [patient.id], before: { condition: before }, after: { condition: patient.condition, severity: patient.severity, requiredRoomType: patient.requiredRoomType, requiredResources: patient.requiredResources } });
  }
}

function resourceConflict(state: SimulationState, type: ResourceType) {
  const resource = state.resources.find((item) => item.type === type);
  if (!resource) return `missing ${type} resource`;
  if (resource.status === "offline") return `${resource.label} offline`;
  if (resource.assignedPatientIds.length >= resource.capacity) return `${resource.label} at capacity`;
  return null;
}

export type PatientRoomPairing = {
  patientId: string;
  doctorId: string;
  roomId: string;
};

export type PatientRoomPairingResult = PatientRoomPairing & {
  assigned: boolean;
  message: string;
};

function assignPatients(state: SimulationState, requestedPairings?: PatientRoomPairing[]) {
  const waiting = requestedPairings
    ? requestedPairings
        .map((pairing) => state.patients.find((patient) => patient.id === pairing.patientId && patient.status === "waiting"))
        .filter((patient): patient is Patient => Boolean(patient))
    : state.patients.filter((patient) => patient.status === "waiting").sort((a, b) => a.severity - b.severity || b.waitMinutes - a.waitMinutes);
  for (const patient of waiting) {
    const pairing = requestedPairings?.find((item) => item.patientId === patient.id);
    const room = pairing
      ? state.rooms.find((item) => item.id === pairing.roomId)
      : state.rooms.find((item) => item.type === patient.requiredRoomType && (item.status === "ready" || (item.status === "reserved" && item.reservedForPatientId === patient.id)));
    const availableDoctors = state.staff.filter((item) => item.role === "doctor" && item.status === "available");
    const doctor = pairing
      ? state.staff.find((item) => item.id === pairing.doctorId)
      : patient.requiredSpecialty ? availableDoctors.find((item) => item.specialty === patient.requiredSpecialty) : availableDoctors[0];
    const nurse = state.staff.find((item) => item.role === "nurse" && item.status === "available");
    const resourceProblems = patient.requiredResources.map((type) => resourceConflict(state, type)).filter((item): item is string => Boolean(item));
    const roomProblems = !room
      ? [pairing ? `room ${pairing.roomId} not found` : `no ${patient.requiredRoomType} room`]
      : [
          ...(room.type !== patient.requiredRoomType ? [`requires ${patient.requiredRoomType} room, selected ${room.type}`] : []),
          ...(!(room.status === "ready" || (room.status === "reserved" && room.reservedForPatientId === patient.id)) ? [`${room.label} is not available`] : []),
        ];
    const doctorProblems = !doctor
      ? [pairing ? `doctor ${pairing.doctorId} not found` : `no available ${patient.requiredSpecialty ? `${patient.requiredSpecialty.toLowerCase()} ` : ""}doctor`]
      : [
          ...(doctor.role !== "doctor" ? [`${doctor.name} is not a doctor`] : []),
          ...(doctor.status !== "available" ? [`${doctor.name} is not available`] : []),
          ...(patient.requiredSpecialty && doctor.specialty !== patient.requiredSpecialty ? [`${patient.requiredSpecialty} specialty required`] : []),
        ];
    const blockers = [
      ...roomProblems,
      ...doctorProblems,
      ...(!nurse ? ["no available nurse"] : []),
      ...resourceProblems,
    ];

    if (blockers.length) {
      const reason = blockers.join("; ");
      if (patient.blockedReason !== reason) {
        const previous = patient.blockedReason;
        patient.blockedReason = reason;
        addEvent(state, { type: "ASSIGNMENT_BLOCKED", category: "validation", level: patient.severity <= 2 ? "critical" : "warning", source: "Constraint validator", summary: `${patient.name} blocked by ${blockers.length} constraint${blockers.length === 1 ? "" : "s"}`, details: reason, entityIds: [patient.id, ...patient.requiredResources.map((type) => state.resources.find((resource) => resource.type === type)?.id).filter((id): id is string => Boolean(id))], before: previous ? { blockedReason: previous } : undefined, after: { blockedReason: reason } });
      }
      continue;
    }

    const selectedRoom = room!;
    const selectedDoctor = doctor!;
    const selectedNurse = nurse!;
    const resolvedConflict = patient.blockedReason;
    delete patient.blockedReason;
    patient.status = "treating"; patient.assignedRoomId = selectedRoom.id; patient.assignedDoctorId = selectedDoctor.id; patient.assignedNurseId = selectedNurse.id;
    selectedRoom.status = "occupied"; selectedRoom.patientId = patient.id; delete selectedRoom.reservedForPatientId;
    for (const member of [selectedDoctor, selectedNurse]) { member.status = "busy"; member.patientId = patient.id; member.roomId = selectedRoom.id; }
    for (const type of patient.requiredResources) state.resources.find((resource) => resource.type === type)!.assignedPatientIds.push(patient.id);
    updateResourceStatuses(state);
    const correlationId = `CARE-${patient.id}-${state.simMinute}`;
    const resourceNames = patient.requiredResources.map((type) => state.resources.find((resource) => resource.type === type)!.label);
    addEvent(state, { type: "ASSIGNMENT_VALIDATED", category: "validation", level: "success", source: "Constraint validator", summary: `Assignment validated for ${patient.name}`, details: `${selectedRoom.label}, ${selectedDoctor.name}, and ${selectedNurse.name} are compatible.${resourceNames.length ? ` Allocated: ${resourceNames.join(", ")}.` : ""}${resolvedConflict ? ` Resolved conflict: ${resolvedConflict}.` : ""}`, entityIds: [patient.id, selectedRoom.id, selectedDoctor.id, selectedNurse.id, ...patient.requiredResources.map((type) => state.resources.find((resource) => resource.type === type)!.id)], correlationId });
    addEvent(state, { type: "TREATMENT_STARTED", category: "patient", level: patient.severity <= 2 ? "notice" : "info", source: "Autonomous head-nurse policy", summary: `${patient.name} moved to ${selectedRoom.label}`, details: `${selectedDoctor.name} and ${selectedNurse.name} assigned after ${patient.waitMinutes} simulated minutes of waiting.`, entityIds: [patient.id, selectedRoom.id, selectedDoctor.id, selectedNurse.id], correlationId, before: { status: "waiting" }, after: { status: "treating", roomId: selectedRoom.id } });
  }
}

export function assignSelectedPatientsNow(
  state: SimulationState,
  pairings: PatientRoomPairing[],
): { state: SimulationState; results: PatientRoomPairingResult[] } {
  const next = structuredClone(state);
  next.stateVersion += 1;
  assignPatients(next, pairings);
  updateResourceStatuses(next);
  next.metrics = recalculateMetrics(next);
  const results = pairings.map((pairing): PatientRoomPairingResult => {
    const patient = next.patients.find((item) => item.id === pairing.patientId);
    const assigned = patient?.status === "treating"
      && patient.assignedDoctorId === pairing.doctorId
      && patient.assignedRoomId === pairing.roomId;
    if (assigned) return { ...pairing, assigned: true, message: "assigned" };
    const originalPatient = state.patients.find((item) => item.id === pairing.patientId);
    const message = originalPatient?.status !== "waiting"
      ? `patient is ${originalPatient?.status ?? "unknown"}`
      : patient?.blockedReason ?? "assignment could not be completed";
    return { ...pairing, assigned: false, message };
  });
  const assignedCount = results.filter((result) => result.assigned).length;
  addEvent(next, {
    type: "NOTEBOOK_PAIRINGS_REQUESTED",
    category: "decision",
    level: assignedCount > 0 ? "success" : "notice",
    source: "Notebook control",
    summary: `${assignedCount} of ${pairings.length} selected pairing${pairings.length === 1 ? "" : "s"} assigned`,
    details: results.map((result) => `${result.patientId}: ${result.message}`).join("; "),
    entityIds: results.filter((result) => result.assigned).flatMap((result) => [result.patientId, result.doctorId, result.roomId]),
  });
  return { state: next, results };
}

export function assignWaitingPatientsNow(state: SimulationState): SimulationState {
  const next = structuredClone(state);
  next.stateVersion += 1;
  const waitingBefore = next.patients.filter((patient) => patient.status === "waiting").length;
  assignPatients(next);
  updateResourceStatuses(next);
  next.metrics = recalculateMetrics(next);
  const assigned = next.patients.filter((patient) => patient.status === "treating").length - state.patients.filter((patient) => patient.status === "treating").length;
  addEvent(next, {
    type: "NOTEBOOK_ASSIGNMENT_REQUESTED",
    category: "decision",
    level: assigned > 0 ? "success" : "notice",
    source: "Notebook control",
    summary: assigned > 0 ? `${assigned} waiting patient${assigned === 1 ? "" : "s"} assigned` : "No waiting patients could be assigned",
    details: `${waitingBefore} patient${waitingBefore === 1 ? "" : "s"} were waiting when the request was processed. Existing room, staffing, specialty, and resource constraints were applied.`,
    entityIds: next.patients.filter((patient) => patient.status === "treating" && !state.patients.some((previous) => previous.id === patient.id && previous.status === "treating")).map((patient) => patient.id),
  });
  return next;
}

export function isSimulationComplete(state: SimulationState) {
  return state.patients.length > 0 && state.patients.every((patient) => patient.status === "discharged");
}

export function advanceSimulation(state: SimulationState): SimulationState {
  if (isSimulationComplete(state)) return state;
  const next = structuredClone(state);
  next.simMinute += 1; next.stateVersion += 1;
  processScheduledIncidents(next);
  updateTreatments(next);
  updateRooms(next);
  updateAmbulances(next);
  updateWaitingPatients(next);
  assignPatients(next);
  updateResourceStatuses(next);
  next.metrics = recalculateMetrics(next);
  if (next.simMinute % 5 === 0) addEvent(next, { type: "PRESSURE_SNAPSHOT", category: "simulation", level: next.metrics.activeConflicts || next.metrics.offlineResources ? "warning" : "info", source: "Metrics engine", summary: `Operational pressure snapshot at minute ${next.simMinute}`, details: `${next.metrics.waiting} waiting, ${next.metrics.inbound} inbound, ${next.metrics.activeConflicts} blocked assignments, ${next.metrics.critical} critical patients, and ${next.metrics.offlineResources} offline resources.`, entityIds: [] });
  if (isSimulationComplete(next)) addEvent(next, { type: "SIMULATION_COMPLETED", category: "simulation", level: "success", source: "Simulation engine", summary: "All patients cleared from the emergency department", details: `Run ${next.runId} completed at minute ${next.simMinute} with ${next.metrics.discharged} discharged patients, ${next.metrics.deteriorationEvents} deterioration events, and ${next.metrics.activeConflicts} unresolved assignment conflicts.`, entityIds: next.patients.map((patient) => patient.id) });
  return next;
}

function pushDisruptionEvent(state: SimulationState, type: string, category: LogCategory, level: LogLevel, summary: string, details: string, entityIds: string[]) {
  addEvent(state, { type, category, level, source: "Judge control", summary, details, entityIds });
}

export function injectDisruption(state: SimulationState, disruption: DisruptionType): SimulationState {
  const next = structuredClone(state); next.stateVersion += 1;
  if (disruption === "NEW_PATIENT") {
    const index = next.patients.length + 101; const id = `P-${index}`;
    const severity = (1 + Math.floor(nextRandom(next) * 4)) as Patient["severity"];
    const requiredResources: ResourceType[] = severity <= 2 ? [nextRandom(next) > 0.5 ? "ventilator" : "blood"] : [];
    next.patients.push({ id, name: `Walk-in ${index}`, age: 28 + Math.floor(nextRandom(next) * 45), injury: "Unscheduled surge case", severity, initialSeverity: severity, condition: severity === 1 ? "critical" : "stable", status: "waiting", requiredRoomType: severity === 1 ? "resus" : severity === 2 ? "acute" : "exam", requiredResources, waitMinutes: 0, treatmentMinutes: 14 + severity * 2, remainingMinutes: 14 + severity * 2, baseHazard: severity <= 2 ? 0.014 : 0.004, deteriorationEvents: 0 });
    pushDisruptionEvent(next, "PATIENT_CREATED", "patient", "warning", `New priority ${severity} walk-in arrived`, `An unscheduled synthetic patient was added with ${requiredResources.length ? requiredResources.join(", ") : "no"} critical-resource requirements.`, [id]);
  } else if (disruption === "STAFF_UNAVAILABLE") {
    const member = next.staff.find((item) => item.status === "available");
    if (member) { member.status = "unavailable"; pushDisruptionEvent(next, "STAFF_UNAVAILABLE", "staff", "warning", `${member.name} became unavailable`, "Temporary unavailability was injected. Existing assignments were not interrupted.", [member.id]); }
    else pushDisruptionEvent(next, "DISRUPTION_REJECTED", "validation", "notice", "No available staff member to remove", "The disruption was safely rejected because all staff are assigned or already unavailable.", []);
  } else if (disruption === "AMBULANCE_DELAY") {
    const ambulance = next.ambulances.find((item) => item.status === "inbound");
    if (ambulance) { const before = ambulance.etaMinutes; ambulance.etaMinutes += 3; addEvent(next, { type: "AMBULANCE_ETA_CHANGED", category: "ambulance", level: "warning", source: "Judge control", summary: `${ambulance.callSign} delayed by 3 minutes`, details: `ETA changed from ${before} to ${ambulance.etaMinutes} minutes.`, entityIds: [ambulance.id, ambulance.patientId], before: { etaMinutes: before }, after: { etaMinutes: ambulance.etaMinutes } }); }
  } else if (disruption === "ROOM_FAULT") {
    const room = next.rooms.find((item) => item.status === "ready");
    if (room) { room.status = "unavailable"; pushDisruptionEvent(next, "ROOM_UNAVAILABLE", "room", "warning", `${room.label} taken offline`, "A synthetic equipment fault made this room unavailable for new assignments.", [room.id]); }
  } else {
    const patient = next.patients.filter((item) => item.status === "waiting").sort((a, b) => a.severity - b.severity || b.waitMinutes - a.waitMinutes)[0];
    if (patient) { const before = patient.condition; patient.condition = "critical"; patient.severity = Math.max(1, patient.severity - 1) as Patient["severity"]; patient.requiredRoomType = "resus"; if (!patient.requiredResources.includes("ventilator")) patient.requiredResources.push("ventilator"); patient.deteriorationEvents += 1; delete patient.blockedReason; addEvent(next, { type: "PATIENT_DETERIORATED", category: "patient", level: "critical", source: "Judge control", summary: `${patient.name} deteriorated`, details: "A synthetic deterioration event added a resuscitation-room and ventilator requirement.", entityIds: [patient.id], before: { condition: before }, after: { condition: patient.condition, severity: patient.severity, requiredResources: patient.requiredResources } }); }
  }
  updateResourceStatuses(next);
  next.metrics = recalculateMetrics(next);
  return next;
}

export function formatSimTime(minute: number) {
  const total = 7 * 60 + 30 + minute;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

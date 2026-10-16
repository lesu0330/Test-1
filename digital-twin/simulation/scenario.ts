import type { CriticalResource, Patient, Room, ScenarioIncident, SimulationState, StaffMember } from "./types";

const patients: Patient[] = [
  { id: "P-101", name: "Riley Chen", age: 46, injury: "Serious head injury", severity: 2, initialSeverity: 2, condition: "worsening", status: "waiting", requiredRoomType: "acute", requiredResources: ["ct"], requiredSpecialty: "Trauma", waitMinutes: 11, treatmentMinutes: 24, remainingMinutes: 24, baseHazard: 0.012, deteriorationEvents: 0 },
  { id: "P-102", name: "Sofia Karim", age: 31, injury: "Deep wound with blood loss", severity: 2, initialSeverity: 2, condition: "worsening", status: "waiting", requiredRoomType: "resus", requiredResources: ["blood"], waitMinutes: 9, treatmentMinutes: 22, remainingMinutes: 22, baseHazard: 0.014, deteriorationEvents: 0 },
  { id: "P-103", name: "Noah Williams", age: 58, injury: "Severe respiratory failure", severity: 1, initialSeverity: 1, condition: "critical", status: "treating", requiredRoomType: "resus", requiredResources: ["ventilator"], waitMinutes: 3, treatmentMinutes: 28, remainingMinutes: 16, assignedRoomId: "R-01", assignedDoctorId: "D-01", assignedNurseId: "N-01", baseHazard: 0.018, deteriorationEvents: 0 },
  { id: "P-104", name: "Maya Rossi", age: 22, injury: "Complex ankle fracture", severity: 4, initialSeverity: 4, condition: "stable", status: "treating", requiredRoomType: "exam", requiredResources: [], waitMinutes: 15, treatmentMinutes: 16, remainingMinutes: 8, assignedRoomId: "R-02", assignedDoctorId: "D-02", assignedNurseId: "N-02", baseHazard: 0.001, deteriorationEvents: 0 },
  { id: "P-105", name: "Elias Berg", age: 39, injury: "Burns to both hands", severity: 3, initialSeverity: 3, condition: "stable", status: "waiting", requiredRoomType: "exam", requiredResources: [], waitMinutes: 21, treatmentMinutes: 18, remainingMinutes: 18, baseHazard: 0.004, deteriorationEvents: 0 },
  { id: "P-106", name: "Amina Patel", age: 67, injury: "Major multi-system trauma", severity: 1, initialSeverity: 1, condition: "critical", status: "inbound", requiredRoomType: "resus", requiredResources: ["ct", "blood"], requiredSpecialty: "Trauma", waitMinutes: 0, treatmentMinutes: 38, remainingMinutes: 38, ambulanceId: "AMB-7", baseHazard: 0.025, deteriorationEvents: 0 },
  { id: "P-107", name: "Jonas Meyer", age: 42, injury: "Crush injury to chest", severity: 1, initialSeverity: 1, condition: "critical", status: "inbound", requiredRoomType: "resus", requiredResources: ["ventilator", "blood"], requiredSpecialty: "Trauma", waitMinutes: 0, treatmentMinutes: 34, remainingMinutes: 34, ambulanceId: "AMB-12", baseHazard: 0.023, deteriorationEvents: 0 },
  { id: "P-108", name: "Leila Hassan", age: 12, injury: "Blunt abdominal trauma", severity: 3, initialSeverity: 3, condition: "worsening", status: "inbound", requiredRoomType: "acute", requiredResources: ["ct"], requiredSpecialty: "Trauma", waitMinutes: 0, treatmentMinutes: 30, remainingMinutes: 30, ambulanceId: "AMB-21", baseHazard: 0.017, deteriorationEvents: 0 },
  { id: "P-109", name: "Owen Brooks", age: 54, injury: "Smoke inhalation", severity: 2, initialSeverity: 2, condition: "worsening", status: "inbound", requiredRoomType: "resus", requiredResources: ["ventilator"], waitMinutes: 0, treatmentMinutes: 26, remainingMinutes: 26, ambulanceId: "AMB-31", baseHazard: 0.018, deteriorationEvents: 0 },
  { id: "P-110", name: "Ingrid Dahl", age: 76, injury: "Possible sepsis with confusion", severity: 3, initialSeverity: 3, condition: "worsening", status: "waiting", requiredRoomType: "exam", requiredResources: ["isolation"], waitMinutes: 17, treatmentMinutes: 32, remainingMinutes: 32, baseHazard: 0.016, deteriorationEvents: 0 },
];

const staff: StaffMember[] = [
  { id: "D-01", name: "Dr. Avery", role: "doctor", specialty: "Emergency", status: "busy", patientId: "P-103", roomId: "R-01" },
  { id: "D-02", name: "Dr. Okafor", role: "doctor", specialty: "General", status: "busy", patientId: "P-104", roomId: "R-02" },
  { id: "D-03", name: "Dr. Lind", role: "doctor", specialty: "Trauma", status: "available" },
  { id: "N-01", name: "Nurse Kim", role: "nurse", specialty: "Critical care", status: "busy", patientId: "P-103", roomId: "R-01" },
  { id: "N-02", name: "Nurse Silva", role: "nurse", specialty: "Emergency", status: "busy", patientId: "P-104", roomId: "R-02" },
  { id: "N-03", name: "Nurse Anders", role: "nurse", specialty: "Trauma", status: "available" },
  { id: "N-04", name: "Nurse Vega", role: "nurse", specialty: "General", status: "available" },
];

const rooms: Room[] = [
  { id: "R-01", label: "Resus 1", type: "resus", status: "occupied", patientId: "P-103", cleaningMinutesRemaining: 0 },
  { id: "R-02", label: "Exam 1", type: "exam", status: "occupied", patientId: "P-104", cleaningMinutesRemaining: 0 },
  { id: "R-03", label: "Acute 1", type: "acute", status: "ready", cleaningMinutesRemaining: 0 },
  { id: "R-04", label: "Resus 2", type: "resus", status: "cleaning", reservedForPatientId: "P-106", cleaningMinutesRemaining: 3 },
  { id: "R-05", label: "Exam 2", type: "exam", status: "ready", cleaningMinutesRemaining: 0 },
  { id: "R-06", label: "Exam 3", type: "exam", status: "ready", cleaningMinutesRemaining: 0 },
  { id: "R-07", label: "Flex bay", type: "acute", status: "ready", cleaningMinutesRemaining: 0 },
];

const resources: CriticalResource[] = [
  { id: "RES-CT", label: "CT scanner", type: "ct", status: "available", capacity: 1, assignedPatientIds: [] },
  { id: "RES-VENT", label: "Ventilators", type: "ventilator", status: "available", capacity: 2, assignedPatientIds: ["P-103"] },
  { id: "RES-BLOOD", label: "Emergency blood", type: "blood", status: "available", capacity: 1, assignedPatientIds: [] },
  { id: "RES-ISO", label: "Isolation capacity", type: "isolation", status: "available", capacity: 1, assignedPatientIds: [] },
];

const incidents: ScenarioIncident[] = [
  { id: "INC-01", minute: 2, type: "MCI_DECLARED", title: "Multi-vehicle collision declared", status: "scheduled", entityIds: ["AMB-7", "AMB-12", "AMB-21", "AMB-31"] },
  { id: "INC-02", minute: 4, type: "CT_OFFLINE", title: "CT scanner cooling fault", status: "scheduled", entityIds: ["RES-CT"] },
  { id: "INC-03", minute: 6, type: "ACUITY_UPDATE", title: "Pediatric patient upgraded to priority 1", status: "scheduled", entityIds: ["P-108", "AMB-21"] },
  { id: "INC-04", minute: 8, type: "STAFF_LOSS", title: "Nurse removed from the active roster", status: "scheduled", entityIds: ["N-04"] },
  { id: "INC-05", minute: 11, type: "ROOM_FAULT", title: "Exam room equipment fault", status: "scheduled", entityIds: ["R-06"] },
  { id: "INC-06", minute: 14, type: "SECONDARY_DETERIORATION", title: "Waiting patient develops respiratory failure", status: "scheduled", entityIds: ["P-110"] },
  { id: "INC-07", minute: 22, type: "CT_RESTORED", title: "CT scanner restored", status: "scheduled", entityIds: ["RES-CT"] },
  { id: "INC-08", minute: 26, type: "SURGE_TEAM_ARRIVES", title: "Trauma surge team arrives", status: "scheduled", entityIds: ["D-04", "N-05"] },
  { id: "INC-09", minute: 30, type: "BLOOD_RESTOCKED", title: "Emergency blood delivery received", status: "scheduled", entityIds: ["RES-BLOOD"] },
];

export function createInitialState(seed = 42): SimulationState {
  return {
    runId: `RUN-${seed}-MCI`, scenarioId: "MCI-CASCADE-01", seed, rngState: seed >>> 0,
    simMinute: 0, durationMinutes: 60, stateVersion: 1, eventSequence: 0,
    patients: structuredClone(patients), staff: structuredClone(staff), rooms: structuredClone(rooms),
    ambulances: [
      { id: "AMB-7", callSign: "Medic 7", patientId: "P-106", etaMinutes: 4, status: "inbound" },
      { id: "AMB-12", callSign: "Medic 12", patientId: "P-107", etaMinutes: 6, status: "inbound" },
      { id: "AMB-21", callSign: "Medic 21", patientId: "P-108", etaMinutes: 8, status: "inbound" },
      { id: "AMB-31", callSign: "Medic 31", patientId: "P-109", etaMinutes: 10, status: "inbound" },
    ],
    resources: structuredClone(resources), incidents: structuredClone(incidents), events: [],
    metrics: { waiting: 0, treating: 0, discharged: 0, critical: 0, occupiedRooms: 0, roomUtilization: 0, meanWait: 0, peakQueue: 0, deteriorationEvents: 0, inbound: 0, activeConflicts: 0, offlineResources: 0, resourcePressure: 0 },
  };
}

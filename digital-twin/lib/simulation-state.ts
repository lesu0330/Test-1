import { env } from "cloudflare:workers";

export async function simulationStateRequest(path: string, init?: RequestInit) {
  const namespace = env.SIMULATION_STATE;
  const id = namespace.idFromName("simulation");
  const response = await namespace.get(id).fetch(
    new Request(`https://simulation-state.internal${path}`, init),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

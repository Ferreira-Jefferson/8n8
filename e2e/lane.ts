// The ports of a test run and its lanes. Not a spec: Playwright only runs *.e2e.ts.
//
// The config draws one free block of ports per run (E2E_PORT_BASE), so two runs at
// once (two chats) and the app on 8148 never meet. The workers inherit the variable.
//
// One lane per Playwright worker: every server a test reaches (the fake LLM, the
// keyless server, the keyed ones, the history one) and their cache dirs. The specs wipe
// and count them, and the coverage map (e2e/test.ts) reads each test's own servers, so
// two workers never share one.

/** The lane of this worker (TEST_PARALLEL_INDEX); 0 outside a worker (the config). */
export const LANE = Number(process.env.TEST_PARALLEL_INDEX ?? 0);

/** Ports of the run itself: the installed CLI that cli.e2e.ts starts. */
export const RUN = { cli: 0 } as const;
/** Ports of a lane, after the run's own. */
export const LANE_PORT = {
  fake: 0,
  real: 1,
  defaultModel: 2,
  settings: 3,
  offline: 4,
  history: 5,
} as const;
/**
 * With E2E_COVERAGE=1 a server's inspector listens on its port plus this (e2e/test.ts):
 * every offset stays under it, so the inspector stays inside the lane.
 */
export const INSPECT_OFFSET = 10;
/** Ports a lane takes; the run takes the same before the first lane. */
const STRIDE = 2 * INSPECT_OFFSET;

function base(): number {
  const value = Number(process.env.E2E_PORT_BASE);
  if (!value)
    throw new Error("E2E_PORT_BASE: a config do Playwright sorteia a faixa");
  return value;
}

/** A port of the run. */
export const runPort = (offset: number) => base() + offset;

/** A port of a lane: lane n takes the block after the run's and the n before it. */
export const lanePort = (offset: number, lane = LANE) =>
  base() + STRIDE * (lane + 1) + offset;

/** The ports a run of `lanes` lanes takes, from E2E_PORT_BASE on. */
export const portsTaken = (lanes: number) => STRIDE * (lanes + 1);

/** The name of a dir under .cache for a lane: lane 0 keeps the base name. */
export const laneDir = (name: string, lane = LANE) =>
  lane === 0 ? name : `${name}-${lane}`;

// In a worker, E2E_PORT names its lane's keyless server: the specs read it to reach it.
if (process.env.TEST_PARALLEL_INDEX !== undefined) {
  process.env.E2E_PORT = String(lanePort(LANE_PORT.offline));
}

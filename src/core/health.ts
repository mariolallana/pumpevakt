// /health summary (docs/05 §2): pure reduction of recent runs rows into per-job status.

export interface RunLike {
  startedAt: string;
  finishedAt: string | null;
  ok: number | null; // 1 ok, 0 failed, null = started but never finished (e.g. killed)
  detail: Record<string, unknown>;
}

export interface JobHealth {
  lastRun: { at: string; ok: boolean | null } | null;
  lastOk: string | null; // finished_at of the newest successful run
  lastError: { at: string; error: string } | null; // newest failed run
  consecutiveFailures: number; // failed runs since the last success (unfinished runs count as failures)
  [extra: string]: unknown;
}

/** `runs` must be newest first. `extraKeys` are copied from the newest successful run's detail (e.g. nFresh). */
export function jobHealth(runs: RunLike[], extraKeys: string[] = []): JobHealth {
  const first = runs[0];
  const lastOkRun = runs.find((r) => r.ok === 1);
  const lastErrRun = runs.find((r) => r.ok === 0);
  let consecutiveFailures = 0;
  for (const r of runs) {
    if (r.ok === 1) break;
    consecutiveFailures++;
  }
  const h: JobHealth = {
    lastRun: first ? { at: first.startedAt, ok: first.ok === null ? null : first.ok === 1 } : null,
    lastOk: lastOkRun ? (lastOkRun.finishedAt ?? lastOkRun.startedAt) : null,
    lastError: lastErrRun
      ? { at: lastErrRun.finishedAt ?? lastErrRun.startedAt, error: String(lastErrRun.detail.error ?? 'unknown') }
      : null,
    consecutiveFailures,
  };
  for (const k of extraKeys) h[k] = lastOkRun?.detail[k] ?? null;
  return h;
}

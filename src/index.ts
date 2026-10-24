// Worker entry: fetch() (GET /health now; /telegram and /api/* in later phases) + scheduled() crons.
// Only the default export lives here (workerd treats every named export of the entry as a handler).
import { handleFetch, runScheduled } from './routes';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    return handleFetch(request, env);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },
} satisfies ExportedHandler<Env>;

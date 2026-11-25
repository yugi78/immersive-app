import { clearCookie, json, type Ctx } from '../_lib/auth';

/** POST /api/logout : efface le cookie de session. */
export async function onRequestPost(_: Ctx) {
  return json(200, { ok: true }, { 'set-cookie': clearCookie() });
}

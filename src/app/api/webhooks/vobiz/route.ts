// `src/app/api/webhooks/vobiz/route.ts` is the legacy webhook route.
// The canonical handler lives at `/api/v1/webhooks/vobiz` (referenced by the
// voice pipeline, call worker, dashboard tools and connect flow). This route is
// kept for backwards compatibility and simply delegates — so Vobiz callbacks
// sent to either path behave identically.
export { POST } from "@/app/api/v1/webhooks/vobiz/route";
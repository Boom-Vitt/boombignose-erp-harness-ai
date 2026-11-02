// Local liveness check for the bundled server. It does not read a database
// and it does not call a cloud service. `app` lets the desktop launcher tell this
// ERP from any other web server that happens to hold the port.
export function GET() {
  return Response.json({ ok: true, app: "boombignose-erp" })
}

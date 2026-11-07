import { proxyNativeAuth } from "@/lib/supabase/native-auth-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ path: string[] }> }
async function relay(request: Request, context: Context) {
  return proxyNativeAuth(request, (await context.params).path)
}
export { relay as GET, relay as POST, relay as DELETE }

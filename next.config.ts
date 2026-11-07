import type { NextConfig } from "next"

const edition = process.env.BBN_EDITION ?? "community"
if (edition !== "community" && edition !== "pro") throw new Error("BBN_EDITION must be community or pro")

const nextConfig: NextConfig = {
  output: "standalone",
  // Required for build-time client license closure; the wrapper archives maps
  // outside public static assets after collection, including for `pnpm start`.
  productionBrowserSourceMaps: process.env.BBN_PRIVATE_SOURCE_MAPS === "1",
  images: { unoptimized: true },
  outputFileTracingIncludes: {
    "/*": ["./boombignose/bin/boombignose-image", "./boombignose/bin/boombignose-image.exe"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "**/node_modules/sharp/**/*",
      "**/node_modules/@img/sharp*/**/*",
      "**/node_modules/.pnpm/sharp@*/**/*",
      "**/node_modules/.pnpm/@img+sharp*/**/*",
      "**/node_modules/@napi-rs/canvas*/**/*",
      "**/node_modules/.pnpm/@napi-rs+canvas*/**/*",
    ],
  },
  experimental: { authInterrupts: true, serverActions: { bodySizeLimit: "11mb" } },
  typescript: { tsconfigPath: edition === "pro" ? "tsconfig.pro.json" : "tsconfig.json" },
  // Pin the workspace root to this project. A stray lockfile in a parent
  // directory can otherwise make Next infer the wrong root.
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig

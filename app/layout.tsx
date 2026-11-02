import type { Metadata } from "next"
import { Bricolage_Grotesque, Geist_Mono, IBM_Plex_Sans_Thai } from "next/font/google"
import { ThemeProvider } from "next-themes"
import "./globals.css"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PublicEnvScript } from "@/lib/supabase/public-env"

// Body: Plex Sans Thai sets Thai and Latin together with tabular figures for ERP data.
const fontBody = IBM_Plex_Sans_Thai({
  variable: "--font-body",
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600", "700"],
})

// Display: titles and big numbers. Latin only, Thai falls back to the body face.
const fontDisplay = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
})

const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "BoomBigNose ERP",
  description:
    "Open-source ERP — CRM, sales, purchasing, inventory, projects, finance, automation, and management dashboards.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontBody.className} ${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-full">
        <PublicEnvScript />
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          defaultTheme="dark"
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}

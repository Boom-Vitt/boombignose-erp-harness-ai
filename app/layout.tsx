import type { Metadata } from "next"
import { Geist, Geist_Mono, Mali } from "next/font/google"
import { ThemeProvider } from "next-themes"
import "./globals.css"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PublicEnvScript } from "@/lib/supabase/public-env"

const fontSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
})

const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const fontDeck = Mali({
  variable: "--font-deck",
  subsets: ["latin", "thai"],
  weight: ["500", "600", "700"],
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
      className={`${fontSans.variable} ${fontMono.variable} ${fontDeck.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-full">
        <PublicEnvScript />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@/components/analytics";
import { LocaleProvider, SiteFooter } from "@/components/locale";
import { SiteHeader } from "@/components/site-header";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://animindly.com"),
  title: { default: "Animindly", template: "%s · Animindly" },
  description: "Create characters, scripts, and scenes for talking animation.",
  applicationName: "Animindly",
  appleWebApp: { capable: true, title: "Animindly", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/192", apple: "/icons/180" },
  openGraph: {
    type: "website",
    siteName: "Animindly",
    locale: "en_US",
    url: "https://animindly.com",
  },
  twitter: { card: "summary" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <LocaleProvider>
          <SiteHeader />
          <main className="flex flex-1 flex-col">{children}</main>
          <SiteFooter />
          <Toaster position="top-center" />
          <SwRegister />
          <Analytics />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

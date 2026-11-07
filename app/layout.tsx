import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/site-header";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://animindly.com"),
  title: { default: "Animindly", template: "%s · Animindly" },
  description: "Crie personagens, roteiros e cenários para animações falantes.",
  applicationName: "Animindly",
  appleWebApp: { capable: true, title: "Animindly", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/192", apple: "/icons/180" },
  openGraph: {
    type: "website",
    siteName: "Animindly",
    locale: "pt_BR",
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
    <html lang="pt-BR" suppressHydrationWarning className={`${geist.variable} h-full antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <SiteHeader />
          <main className="flex flex-1 flex-col">{children}</main>
          <footer className="px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground/70">Paródia • Gerado por IA em todo vídeo</footer>
          <Toaster position="top-center" />
          <SwRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}

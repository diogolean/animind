import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/site-header";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Animind", template: "%s · Animind" },
  description: "Personagens falantes em três cliques.",
  applicationName: "Animind",
  appleWebApp: { capable: true, title: "Animind", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/192", apple: "/icons/180" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${geist.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <SiteHeader />
          <main className="flex flex-1 flex-col">{children}</main>
          <footer className="py-6 text-center text-xs text-muted-foreground/70">Paródia • Gerado por IA em todo vídeo</footer>
          <Toaster position="top-center" />
          <SwRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}

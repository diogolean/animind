"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { pageLocation, pageTitle, sanitizePath } from "@/lib/analytics";
import { setAnalyticsHandler } from "@/lib/analytics-client";

const CONSENT = "animindly-consent";

type Consent = "granted" | "denied" | "unknown";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function Analytics() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [measurementId, setMeasurementId] = useState("");
  const [consent, setConsent] = useState<Consent>("unknown");
  const loaded = useRef(false);
  const lastPath = useRef("");

  useEffect(() => {
    const stored = window.localStorage.getItem(CONSENT);
    if (stored === "granted" || stored === "denied") setConsent(stored);
    fetch("/api/analytics/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { enabled?: boolean; measurementId?: string }) => {
        if (body.enabled && body.measurementId && /^G-[A-Z0-9]+$/.test(body.measurementId)) {
          setEnabled(true);
          setMeasurementId(body.measurementId);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled || consent !== "granted" || !measurementId || loaded.current) return;
    loaded.current = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
    window.gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    window.gtag("consent", "update", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.dataset.animindly = "ga4";
    document.head.appendChild(script);
    setAnalyticsHandler((name, params) => {
      window.gtag?.("event", name, params);
    });
  }, [enabled, consent, measurementId]);

  useEffect(() => {
    if (!enabled || consent !== "granted" || !measurementId || !window.gtag) return;
    const path = sanitizePath(pathname || "/");
    if (lastPath.current === path) return;
    lastPath.current = path;
    window.gtag("event", "page_view", {
      page_path: path,
      page_title: pageTitle(path),
      page_location: pageLocation(window.location.origin, path),
    });
  }, [enabled, consent, measurementId, pathname]);

  if (!enabled || consent !== "unknown") return null;
  return (
    <div
      data-testid="consent-banner"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl flex-col gap-3 rounded-3xl border border-white/15 bg-neutral-950/95 p-4 shadow-2xl sm:flex-row sm:items-center"
    >
      <p className="text-sm text-muted-foreground">A medição de audiência só começa se você permitir. Ela não envia o texto das ideias.</p>
      <div className="flex gap-2">
        <button type="button" data-testid="consent-deny" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm" onClick={() => {
          window.localStorage.setItem(CONSENT, "denied");
          setConsent("denied");
        }}>
          Recusar
        </button>
        <button type="button" data-testid="consent-grant" className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-medium text-black" onClick={() => {
          window.localStorage.setItem(CONSENT, "granted");
          setConsent("granted");
        }}>
          Permitir
        </button>
      </div>
    </div>
  );
}

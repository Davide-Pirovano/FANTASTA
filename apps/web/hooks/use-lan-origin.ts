"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "fantasta-share-origin";

function isLoopbackHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
}

/**
 * Scopre l'IP locale della macchina dal browser (trucco RTCPeerConnection).
 * Serve a generare URL/QR che funzionino dal telefono: la pagina è servita
 * da localhost, ma il telefono deve raggiungere il Mac tramite la sua IP
 * sulla rete locale.
 */
function isRfc1918(ip: string) {
  return ip.startsWith("192.168.") || ip.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** 169.254/16 = link-local (APIPA): nessun dispositivo della rete può raggiungerlo. */
function isLinkLocal(ip: string) {
  return ip.startsWith("169.254.");
}

/**
 * Scopre l'IP locale della macchina dai candidati ICE host (trucco RTCPeerConnection).
 * Raccolti TUTTI i candidati, poi sceglie: primo IP privato RFC1918 (rete locale
 * reale) escludendo link-local, loopback e 0.x. Senza questa selezione su macchine
 * con più interfacce (es. 192.168.1.x + 169.254.x) si rischia di pubblicare un IP
 * irraggiungibile dal telefono.
 */
function detectLanIp(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("RTCPeerConnection" in window)) {
      resolve(null);
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: [] });
    const candidates = new Set<string>();
    let settled = false;
    const done = (ip: string | null) => {
      if (settled) return;
      settled = true;
      try {
        pc.close();
      } catch {
        // ignore
      }
      resolve(ip);
    };
    const pick = () => {
      const usable = [...candidates].filter(
        (ip) => !isLinkLocal(ip) && !ip.startsWith("0.") && ip !== "127.0.0.1"
      );
      return usable.find(isRfc1918) ?? usable[0] ?? null;
    };
    try {
      pc.createDataChannel("");
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => done(pick()));
    } catch {
      done(pick());
      return;
    }
    const timeout = setTimeout(() => done(pick()), 2500);
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        // raccolta completata: scegli il candidato migliore
        clearTimeout(timeout);
        done(pick());
        return;
      }
      if (!event.candidate.candidate.includes(" typ host ")) return;
      const match = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(event.candidate.candidate);
      if (match) candidates.add(match[1]);
    };
  });
}

/**
 * Origin da usare nei link di invito (QR + copia link).
 *
 * - Pagina servita da un host reale (es. deploy): quello stesso origin.
 * - Pagina servita da localhost: l'IP locale del Mac, così il telefono sulla
 *   stessa rete Wi-Fi può aprire l'app. Sovrascrivibile manualmente (persiste
 *   in localStorage) per casi in cui il rilevamento fallisce (VPN, ecc.).
 */
export function useLanOrigin() {
  const [origin, setOrigin] = useState<string | null>(null);
  const [isOverridden, setIsOverridden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Deferra di un microtask: niente setState sincrono dentro l'effect.
      await Promise.resolve();
      const host = window.location.hostname;
      let resolved: string;
      if (!isLoopbackHost(host)) {
        resolved = window.location.origin;
      } else {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          resolved = stored;
          setIsOverridden(true);
        } else {
          const ip = await detectLanIp();
          resolved = ip ? `http://${ip}:${window.location.port || "3000"}` : window.location.origin;
        }
      }
      if (!cancelled) setOrigin(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function override(next: string) {
    const clean = next.trim().replace(/\/+$/, "");
    if (!clean) return;
    setOrigin(clean);
    setIsOverridden(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, clean);
    } catch {
      // storage non disponibile: l'override vale solo per questa sessione
    }
  }

  return { origin, isOverridden, override };
}

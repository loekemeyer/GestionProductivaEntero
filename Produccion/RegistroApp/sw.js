// Service Worker para sincronización en background
const CACHE_NAME = "registro-app-v2";
const APP_TAG = "_Cervantes";
const VERSION = "_v2_supa";
const LS_QUEUE = `prod_queue${APP_TAG}${VERSION}`;
const TABLA_REGISTROS = "Registros Produccion Cervantes";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
      // Forzar reload de tabs abiertas al activar nueva version
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        try { await client.navigate(client.url); } catch { /* ignore */ }
        try { client.postMessage({ type: "SW_UPDATED", version: CACHE_NAME }); } catch {}
      }
    })()
  );
});

// Sincronizar cuando hay internet (Background Sync API)
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-queue") {
    event.waitUntil(syncQueue());
  }
});

async function syncQueue() {
  try {
    const data = await self.clients.matchAll();
    if (data.length === 0) return;

    // Obtener la cola desde el almacenamiento
    const allClients = await self.clients.matchAll();
    let queue = [];

    // Pedir la cola al cliente principal
    for (const client of allClients) {
      client.postMessage({
        type: "REQUEST_QUEUE"
      });
    }

    // Esperar respuesta (timeout 2s)
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err) {
    console.error("Error en sync:", err);
  }
}

// Escuchar mensajes del app (queue para sincronizar)
self.addEventListener("message", async (event) => {
  if (event.data.type === "SYNC_QUEUE") {
    const queue = event.data.queue || [];
    if (queue.length > 0) {
      await procesarCola(queue);
    }
  }
});

async function procesarCola(queue) {
  try {
    const batch = queue.slice(0, 20);
    const resultados = [];

    for (const item of batch) {
      try {
        const payload = {
          id: item.id,
          legajo: item.legajo,
          opcion: item.opcion,
          descripcion: item.descripcion,
          texto: item.texto || "",
          ts_event: item.ts_event,
          hs_inicio: item.hs_inicio || "",
          matriz: item.matriz || ""
        };

        const response = await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(TABLA_REGISTROS)}?on_conflict=id`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Prefer": "resolution=ignore-duplicates,return=minimal"
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          resultados.push({ id: item.id, status: "sent" });
        } else {
          resultados.push({ id: item.id, status: "failed", error: response.statusText });
        }
      } catch (err) {
        resultados.push({ id: item.id, status: "failed", error: err.message });
      }
    }

    // Notificar al cliente sobre los resultados
    const clients = await self.clients.matchAll();
    for (const client of clients) {
      client.postMessage({
        type: "SYNC_RESULTS",
        resultados: resultados
      });
    }
  } catch (err) {
    console.error("Error procesando cola:", err);
  }
}

// Interceptar requests para cache si es necesario
self.addEventListener("fetch", (event) => {
  // Solo cachear GETs
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === "basic") {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    }).catch(() => {
      // Si no hay cache ni conexión, continuar
      return new Response("Offline", { status: 503 });
    })
  );
});

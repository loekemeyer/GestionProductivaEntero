document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /* ================= SUPABASE ================= */
  const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const EDGE_FN_URL = SUPABASE_URL + "/functions/v1/send-whatsapp";

  /* ================= DOM ================= */
  const statusDot      = document.getElementById("statusDot");
  const statusLabel    = document.getElementById("statusLabel");
  const toastContainer = document.getElementById("toastContainer");

  const badgeSinTiempo = document.getElementById("badgeSinTiempo");
  const bodySinTiempo  = document.getElementById("bodySinTiempo");
  const checkSinTiempo = document.getElementById("checkSinTiempo");

  const badgeRM = document.getElementById("badgeRM");
  const bodyRM  = document.getElementById("bodyRM");
  const checkRM = document.getElementById("checkRM");

  const badgePM = document.getElementById("badgePM");
  const bodyPM  = document.getElementById("bodyPM");
  const checkPM = document.getElementById("checkPM");

  const btnTestWA = document.getElementById("btnTestWA");

  /* ================= TOAST ================= */
  function showToast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 5000);
  }

  /* ================= BROWSER NOTIFICATION ================= */
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  /* ================= WHATSAPP VIA EDGE FUNCTION ================= */
  // plantilla: "problemas_en_matriz_reducido" (4 params) o "problema_en_matriz_completo" (5 params)
  // datos = { problema, matriz, descripcion, operario, horaEvento }
  async function sendWhatsAppToAll(plantilla, datos, { test = false } = {}) {
    let parametros;

    if (plantilla === "problema_en_matriz_completo") {
      parametros = [
        datos.problema || "",
        datos.matriz || "",
        datos.descripcion || "",
        datos.operario || "",
        datos.horaEvento || ""
      ];
    } else {
      parametros = [
        datos.problema || "",
        datos.matriz || "",
        datos.descripcion || "",
        datos.horaEvento || ""
      ];
    }

    try {
      await fetch(EDGE_FN_URL, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + SUPABASE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          parametros,
          plantilla,
          idioma: "es_AR",
          test
        })
      });
    } catch (err) {
      console.error("Error edge function:", err);
    }
  }

  /* ================= HELPERS RENDER ================= */
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function formatNow() {
    return new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  }

  /* ================= 1) MATRICES SIN TIEMPO ================= */
  let notifiedSinTiempo = new Set(JSON.parse(localStorage.getItem("alertas_notified_st") || "[]"));

  function renderSinTiempo(matrices) {
    const count = matrices.length;
    badgeSinTiempo.textContent = count;
    badgeSinTiempo.className = "alert-badge badge-red" + (count === 0 ? " ok" : "");
    checkSinTiempo.textContent = "Ultima verificacion: " + formatNow();

    if (count === 0) {
      bodySinTiempo.innerHTML = '<p class="empty-msg">Todas las matrices tienen tiempo asignado.</p>';
      return;
    }
    let html = "<table><thead><tr><th>N\u00b0 Matriz</th><th>Nombre</th><th>Tiempo</th><th>Estado</th></tr></thead><tbody>";
    for (const m of matrices) {
      html += `<tr><td><strong>${esc(m.N_Matriz)}</strong></td><td>${esc(m.Matriz)}</td><td>${m.Tiempo_Historico ?? 0}</td><td><span class="tag-alerta tag-sin-tiempo">Sin Tiempo</span></td></tr>`;
    }
    html += "</tbody></table>";
    bodySinTiempo.innerHTML = html;
  }

  async function fetchSinTiempo() {
    const { data } = await sb.from("Matrices").select("*").or("Tiempo_Historico.eq.0,Tiempo_Historico.is.null");
    renderSinTiempo(data || []);

    const nuevas = (data || []).filter(m => !notifiedSinTiempo.has(String(m.id ?? m.N_Matriz)));
    if (nuevas.length > 0) {
      nuevas.forEach(m => notifiedSinTiempo.add(String(m.id ?? m.N_Matriz)));
      localStorage.setItem("alertas_notified_st", JSON.stringify([...notifiedSinTiempo]));
      showToast(`${nuevas.length} nueva(s) matrices sin tiempo`, "warn");
    }
  }

  /* ================= 2) RM y PM (de db_n8n_espejo, hoy) ================= */
  function todayDateParts() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    return {
      dia: Number(parts.find(p => p.type === "day")?.value || 0),
      mes: Number(parts.find(p => p.type === "month")?.value || 0)
    };
  }

  function renderEventos(bodyEl, badgeEl, checkEl, rows, tagText, tagClass) {
    const count = rows.length;
    badgeEl.textContent = count;
    badgeEl.className = "alert-badge badge-red" + (count === 0 ? " ok" : "");
    checkEl.textContent = "Ultima verificacion: " + formatNow();

    if (count === 0) {
      bodyEl.innerHTML = `<p class="empty-msg">Sin eventos hoy.</p>`;
      return;
    }
    let html = "<table><thead><tr><th>Hora</th><th>Legajo</th><th>Empleado</th><th>Matriz</th><th>Nombre Matriz</th></tr></thead><tbody>";
    for (const r of rows) {
      html += `<tr><td>${esc(r.Hora_Inicio)}</td><td>${esc(r.Legajo)}</td><td>${esc(r.Nombre_Empleado)}</td><td><strong>${esc(r.Matriz)}</strong></td><td>${esc(r.Nombre_Matriz)}</td></tr>`;
    }
    html += "</tbody></table>";
    bodyEl.innerHTML = html;
  }

  async function fetchRM() {
    const { dia, mes } = todayDateParts();
    const { data } = await sb.from("db_n8n_espejo")
      .select("Hora_Inicio,Legajo,Nombre_Empleado,Matriz,Nombre_Matriz")
      .eq("Dia", dia).eq("Mes", mes)
      .like("Nombre_Matriz", "RM %")
      .is("Eliminar", null)
      .order("Hora_Inicio", { ascending: false });
    renderEventos(bodyRM, badgeRM, checkRM, data || [], "Rotura", "tag-sin-tiempo");
  }

  async function fetchPM() {
    const { dia, mes } = todayDateParts();
    const { data } = await sb.from("db_n8n_espejo")
      .select("Hora_Inicio,Legajo,Nombre_Empleado,Matriz,Nombre_Matriz")
      .eq("Dia", dia).eq("Mes", mes)
      .like("Nombre_Matriz", "PM %")
      .is("Eliminar", null)
      .order("Hora_Inicio", { ascending: false });
    renderEventos(bodyPM, badgePM, checkPM, data || [], "Pare", "tag-sin-tiempo");
  }

  /* ================= REALTIME ================= */
  function setupRealtime() {
    // Matrices -> sin tiempo
    sb.channel("matrices-alertas")
      .on("postgres_changes", { event: "*", schema: "public", table: "Matrices" }, () => fetchSinTiempo())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          statusDot.className = "status-dot";
          statusLabel.textContent = "Tiempo real activo";
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          statusDot.className = "status-dot offline";
          statusLabel.textContent = "Desconectado";
        }
      });

    // db_n8n_espejo -> RM / PM
    sb.channel("espejo-alertas")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "db_n8n_espejo" }, (payload) => {
        const nombre = String(payload.new?.Nombre_Matriz || "");
        if (nombre.startsWith("RM ")) fetchRM();
        if (nombre.startsWith("PM ")) fetchPM();
      })
      .subscribe();
  }

  /* ================= CONFIG EVENTS ================= */
  btnTestWA.addEventListener("click", async () => {
    await sendWhatsAppToAll("problemas_en_matriz_reducido", {
      problema: "Prueba",
      matriz: "000",
      descripcion: "Mensaje de prueba desde Alertas",
      horaEvento: formatNow()
    }, { test: true });
    showToast("Prueba enviada (plantilla reducido)", "success");
  });

  /* ================= INIT ================= */
  (async () => {
    await Promise.all([fetchSinTiempo(), fetchRM(), fetchPM()]);
    setupRealtime();
  })();
});

// Auth guard - redirigir a login si no hay sesión válida
if (sessionStorage.getItem("gp_auth") !== "ok") {
  window.location.href = "../../login.html";
}

/* =========================================================
   Loekemeyer - Chat Bot Ventas - Logica principal
   Matcher local + stub para Claude API (opcional)
   ========================================================= */

const ChatBot = (() => {
  let knowledge = null;
  let mode = 'local'; // 'local' | 'ai'

  // ---------- Carga de conocimiento ----------
  async function loadKnowledge(url = 'data/respuestas.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No pude cargar ${url}`);
    knowledge = await res.json();
    return knowledge;
  }

  // ---------- Normalizacion de texto ----------
  function normalize(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // saca tildes
      .replace(/[^\w\s]/g, ' ')         // saca puntuacion
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---------- Matcher local (scoring por triggers - flexible word-based) ----------
  function findBestMatch(userMessage) {
    if (!knowledge) return null;
    const msgNorm = normalize(userMessage);
    const msgWords = msgNorm.split(' ').filter(w => w.length > 0);

    let best = { score: 0, respuesta: null };

    for (const resp of knowledge.respuestas) {
      let score = 0;
      for (const trigger of resp.triggers) {
        const triggerNorm = normalize(trigger);
        const triggerWords = triggerNorm.split(' ').filter(w => w.length > 0);

        // Contar cuantas palabras del trigger aparecen en el mensaje
        let matchCount = 0;
        for (const tWord of triggerWords) {
          // Ignorar palabras muy cortas (stopwords: el, la, un, a, etc)
          if (tWord.length <= 2) continue;

          // Match más estricto: exacto O parcial solo si ambas son suficientemente largas
          const isMatch = msgWords.some(mWord => {
            if (mWord === tWord) return true; // match exacto
            // Match parcial solo si ambas palabras son largas (>4 chars) y una contiene la otra
            if (tWord.length > 4 && mWord.length > 4) {
              return mWord.includes(tWord) || tWord.includes(mWord);
            }
            return false;
          });

          if (isMatch) matchCount++;
        }

        // Si hay al menos 1 palabra clave que matchea, sumar puntos
        if (matchCount >= 1) {
          score += matchCount * 2 + (resp.prioridad || 1);
        }
      }
      if (score > best.score) {
        best = { score, respuesta: resp };
      }
    }

    // umbral minimo para no matchear cualquier cosa
    return best.score >= 3 ? best.respuesta : null;
  }

  // ---------- Reemplazo de placeholders ----------
  // Reemplaza {campo} con [FALTA: campo] asi el operario sabe que completar
  function fillPlaceholders(text, values = {}) {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      return values[key] !== undefined ? values[key] : `[COMPLETAR: ${key}]`;
    });
  }

  // ---------- Respuesta local ----------
  function answerLocal(userMessage) {
    const match = findBestMatch(userMessage);
    if (match) {
      return {
        text: fillPlaceholders(match.respuesta),
        source: 'local',
        matchedId: match.id,
        category: match.categoria
      };
    }
    return {
      text: knowledge.respuesta_default,
      source: 'default',
      matchedId: null,
      category: null
    };
  }

  // ---------- Respuesta via Claude API (OPCIONAL) ----------
  // Para activar esto necesitas un backend que agregue el API key.
  // NUNCA poner el API key en el front. Ver README.md para detalles.
  async function answerAI(userMessage, history = []) {
    const systemPrompt = buildSystemPrompt();

    // Esto apunta a TU backend (ej: Netlify Function, Worker, N8N webhook)
    // que inyecta el API key y llama a Anthropic. Ver README.md
    const BACKEND_URL = '/api/chat'; // <-- CAMBIAR AL DEPLOY

    try {
      const res = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          messages: [
            ...history,
            { role: 'user', content: userMessage }
          ]
        })
      });

      if (!res.ok) throw new Error(`Backend respondio ${res.status}`);
      const data = await res.json();
      return {
        text: data.text || data.content,
        source: 'ai',
        matchedId: null,
        category: null
      };
    } catch (err) {
      console.warn('Fallback a local por error de backend:', err);
      return answerLocal(userMessage);
    }
  }

  // ---------- System prompt a partir del JSON ----------
  function buildSystemPrompt() {
    const respuestasText = knowledge.respuestas.map(r =>
      `[${r.id}] categoria: ${r.categoria}\nRespuesta modelo:\n${r.respuesta}`
    ).join('\n\n---\n\n');

    return `Sos "Leo", asistente del Dpto. de Ventas de Loekemeyer, una fabrica argentina de utensilios de cocina.
Hablas en espaniol rioplatense, cordial y profesional.

Tenes las siguientes respuestas modelo pre-aprobadas por ventas. Usa estas respuestas como base, adaptandolas al contexto del usuario. No inventes datos (precios, fechas, numeros de contacto). Si te piden algo que no esta en las respuestas, deriva al mail ventas@loekemeyer.com o al WhatsApp 1131181021.

DATOS DE CONTACTO OFICIALES:
- Ventas mail: ${knowledge.contactos.ventas_mail}
- Ventas WhatsApp: ${knowledge.contactos.ventas_whatsapp}
- Cobranzas mail: ${knowledge.contactos.cobranzas_mail_lk} o ${knowledge.contactos.cobranzas_mail_chef}
- Cobranzas WhatsApp: ${knowledge.contactos.cobranzas_whatsapp}
- Retiro pedidos: ${knowledge.contactos.deposito_retiro}, horario ${knowledge.contactos.horario_retiro}
- Cambios/garantia: Villa Devoto, ${knowledge.contactos.horario_cambios}
- Monto minimo compra: $${knowledge.contactos.monto_minimo_compra.toLocaleString('es-AR')}
- Monto minimo retiro: $${knowledge.contactos.monto_minimo_retiro.toLocaleString('es-AR')}
- Catalogo: ${knowledge.contactos.catalogo_url}

RESPUESTAS MODELO:
${respuestasText}`;
  }

  // ---------- API publica ----------
  async function answer(userMessage, history = []) {
    if (!knowledge) await loadKnowledge();

    if (mode === 'ai') {
      return await answerAI(userMessage, history);
    }
    return answerLocal(userMessage);
  }

  function setMode(newMode) {
    mode = newMode;
  }

  function getMode() {
    return mode;
  }

  function getKnowledge() {
    return knowledge;
  }

  return {
    loadKnowledge,
    answer,
    setMode,
    getMode,
    getKnowledge,
    // expuesto para testing manual:
    _findBestMatch: findBestMatch,
    _normalize: normalize
  };
})();

// =========================================================
// UI - Manejo del DOM
// =========================================================

const UI = (() => {
  const $ = sel => document.querySelector(sel);
  let scrollEl, inputEl, sendBtn;

  function init() {
    scrollEl = $('#chatScroll');
    inputEl = $('#chatInput');
    sendBtn = $('#sendBtn');

    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    inputEl.addEventListener('input', autoResize);
    sendBtn.addEventListener('click', handleSend);

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ChatBot.setMode(btn.dataset.mode);
      });
    });

    document.querySelectorAll('.example-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        inputEl.value = btn.textContent;
        autoResize();
        handleSend();
      });
    });
  }

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  }

  function clearWelcome() {
    const welcome = $('#welcome');
    if (welcome) welcome.remove();
  }

  function addUserMessage(text) {
    clearWelcome();
    const el = document.createElement('div');
    el.className = 'message user';
    el.innerHTML = `
      <div class="avatar user">VOS</div>
      <div class="bubble-wrapper">
        <div class="bubble"></div>
      </div>
    `;
    el.querySelector('.bubble').textContent = text;
    scrollEl.appendChild(el);
    scroll();
  }

  function addBotMessage(payload) {
    const { text, source, matchedId, category } = payload;
    const el = document.createElement('div');
    el.className = 'message bot';
    const tagClass = source === 'local' ? 'local' : source === 'ai' ? 'ai' : 'default';
    const tagText = source === 'local' ? 'LOCAL' : source === 'ai' ? 'IA' : 'DEFAULT';
    const metaRight = matchedId ? `<span>${matchedId}</span>` : category ? `<span>${category}</span>` : '';
    el.innerHTML = `
      <div class="avatar bot">LK</div>
      <div class="bubble-wrapper">
        <div class="bubble"></div>
        <div class="meta">
          <span class="tag ${tagClass}">${tagText}</span>
          ${metaRight}
        </div>
      </div>
    `;
    el.querySelector('.bubble').textContent = text;
    scrollEl.appendChild(el);
    scroll();
  }

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'message bot typing';
    el.id = 'typingIndicator';
    el.innerHTML = `
      <div class="avatar bot">LK</div>
      <div class="bubble-wrapper">
        <div class="bubble">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      </div>
    `;
    scrollEl.appendChild(el);
    scroll();
  }

  function removeTyping() {
    const el = $('#typingIndicator');
    if (el) el.remove();
  }

  function scroll() {
    requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    autoResize();
    sendBtn.disabled = true;

    addUserMessage(text);
    addTyping();

    // delay artificial para que se sienta natural
    const delay = new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    const [response] = await Promise.all([ChatBot.answer(text), delay]);

    removeTyping();
    addBotMessage(response);
    sendBtn.disabled = false;
    inputEl.focus();
  }

  function renderStats(knowledge) {
    const total = knowledge.respuestas.length;
    const cats = [...new Set(knowledge.respuestas.map(r => r.categoria))];
    $('#statTotal').textContent = total;
    $('#statCategorias').textContent = cats.length;

    const catList = $('#categoryList');
    if (catList) {
      catList.innerHTML = cats.map(c => `<span class="cat-chip">${c}</span>`).join('');
    }
  }

  return { init, renderStats };
})();

// =========================================================
// Boot
// =========================================================
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const kb = await ChatBot.loadKnowledge();
    UI.init();
    UI.renderStats(kb);
    console.log('[ChatBot] cargado:', kb.respuestas.length, 'respuestas');
  } catch (err) {
    console.error('[ChatBot] error al bootear:', err);
    document.body.innerHTML = `
      <div style="padding:40px;color:#e8ecef;font-family:monospace">
        <h2>Error al cargar</h2>
        <p>${err.message}</p>
        <p style="margin-top:12px;color:#a8b0b8">Si abriste el archivo con doble click, usa un servidor local. Desde la terminal, parado en la carpeta: <code>python -m http.server 8000</code> y despues entra a <code>http://localhost:8000</code></p>
      </div>
    `;
  }
});

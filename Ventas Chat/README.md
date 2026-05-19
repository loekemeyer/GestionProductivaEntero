# Chat Bot Ventas — Loekemeyer

Modulo portable de chat bot para el Dpto. de Ventas. Self-contained: todo lo necesario esta en esta carpeta.

## Estructura

```
ventas-chat/
├── index.html              # Simulador standalone (abrir esto)
├── assets/
│   ├── chat.css            # Estilos
│   └── chatbot.js          # Logica (matcher + stub IA)
├── data/
│   └── respuestas.json     # ⭐ BASE DE CONOCIMIENTO — editar aca
└── README.md
```

## Como probarlo YA

### Opcion A — Servidor local (recomendado)

Desde la terminal, parado en `ventas-chat/`:

```bash
# Python (viene con Windows/Mac/Linux)
python -m http.server 8000

# O con Node si lo tenes
npx serve .
```

Despues abri `http://localhost:8000` en el navegador.

### Opcion B — Doble click

Abrir `index.html` directamente **NO funciona** porque los navegadores bloquean `fetch()` a archivos locales por seguridad (CORS). Si lo haces, vas a ver el mensaje de error con las instrucciones.

---

## Como funciona

Hay **dos modos** (toggle en la esquina superior derecha):

### Modo LOCAL (default, gratis)
- Matchea las palabras del usuario contra los `triggers` del JSON.
- Scoring: trigger mas largo + prioridad mayor = mas puntos.
- Umbral minimo de 3 puntos para evitar matches fantasma.
- Si nada matchea → respuesta default.

### Modo IA (opcional, requiere backend)
- Manda el mensaje + historial a un backend tuyo.
- Ese backend llama a la API de Claude con el JSON como contexto en el system prompt.
- Claude adapta la respuesta al caso particular, pero siempre tomando como base las respuestas modelo.
- **No pongas el API key en el frontend.** Setup en seccion final.

---

## Como editar las respuestas

Todo esta en `data/respuestas.json`. Cada entrada:

```json
{
  "id": "pedido_programado_con_fecha",
  "categoria": "programacion",
  "triggers": ["cuando llega mi pedido", "fecha de entrega", "..."],
  "placeholders": ["fecha"],
  "prioridad": 8,
  "respuesta": "Estimado Cliente: Su pedido ya fue programado para el dia {fecha}..."
}
```

**Campos:**
- `id`: identificador unico (snake_case). Se muestra en la UI al hacer match.
- `categoria`: agrupa respuestas del mismo tema.
- `triggers`: palabras/frases que activan la respuesta. Minusculas, sin tildes (el matcher normaliza).
- `placeholders`: campos dinamicos entre llaves `{campo}` que tenes que completar.
- `prioridad`: 1 (baja) a 10 (alta). Mas alta gana en caso de empate.
- `respuesta`: el texto final. Podes usar `\n` para saltos de linea.

**Agregar una respuesta nueva:** copiar un objeto, cambiar los campos, listo. El bot la levanta automaticamente al recargar.

**Triggers — tip:** poner varias variantes reales que diria un cliente. "Cuando llega mi pedido" es mejor que "entrega" porque es mas especifico y puntua mas.

---

## Instrucciones para Claude Code (VS Code)

Cuando abras esta carpeta con Claude Code, empeza la conversacion diciendole:

> Este proyecto es un chat bot de ventas. La base de conocimiento esta en `data/respuestas.json` — cada entrada tiene `id`, `categoria`, `triggers`, `placeholders`, `prioridad` y `respuesta`. La logica del matcher esta en `assets/chatbot.js`. La UI standalone es `index.html`.
>
> Cuando te pida agregar respuestas, editar el JSON manteniendo el schema. Cuando te pida cambiar el comportamiento del matcher, editar `chatbot.js` (funcion `findBestMatch`).

Claude Code entiende JSON estructurado perfectamente. Si le pedis "agrega una respuesta para cuando preguntan por el horario de atencion", va a saber donde y con que formato.

---

## Integrar en Gestion Productiva

Tu app ya tiene un menu principal con botones (Produccion, StockFlejes, Informes, etc). Para sumar el modulo Ventas:

### Paso 1 — Copiar la carpeta

Pega la carpeta `ventas-chat/` dentro del proyecto de Gestion Productiva.

### Paso 2 — Agregar el boton en el menu

En el HTML principal de Gestion Productiva, agregar algo como:

```html
<a href="ventas-chat/index.html" class="modulo-btn">
  <span class="icono">💬</span>
  <span>Ventas</span>
</a>
```

El link abre el chat en la misma pestaña. Si preferis una pestaña nueva, agrega `target="_blank"`.

### Paso 3 — Proteger con login (opcional)

Si queres que solo el personal autorizado vea el chat (igual que StockFlejes, Informes, etc), usa el mismo patron que ya tenes con la tabla `app_login` y password `1515`. Agrega al principio de `assets/chatbot.js`:

```js
// Verificacion de sesion (copiar el patron que ya usas en Gestion Productiva)
if (!sessionStorage.getItem('loggedIn')) {
  window.location.href = '../login.html';
}
```

### Paso 4 — Mover a otro proyecto (portabilidad)

La carpeta es 100% autocontenida. Para mudarla a otro lado:
1. Copiar `ventas-chat/` completo.
2. Pegar en el proyecto destino.
3. Agregar el link/boton donde corresponda.
4. Listo.

Las unicas dependencias externas son las fuentes de Google Fonts (con fallback a system fonts si no hay internet).

---

## Upgrade a modo IA (Claude API)

Cuando quieras que el bot sea mas inteligente y conteste fuera del script, necesitas un backend que llame a la API de Anthropic. **NUNCA expongas el API key en el frontend.**

### Opcion 1 — N8N (tu stack actual)

Ya tenes N8N self-hosted con Docker. Crea un workflow:

1. **Webhook node** → recibe POST con `{ system, messages }`.
2. **HTTP Request node** → POST a `https://api.anthropic.com/v1/messages` con header `x-api-key` y body `{ model: "claude-sonnet-4-5", max_tokens: 1024, system, messages }`.
3. **Respond to Webhook** → devuelve `{ text: $json.content[0].text }`.

En `assets/chatbot.js`, cambiar:
```js
const BACKEND_URL = '/api/chat';
```
por la URL de tu webhook de N8N:
```js
const BACKEND_URL = 'https://tu-n8n.loekemeyer.com/webhook/chat-ventas';
```

### Opcion 2 — Netlify Function / Cloudflare Worker

Si alguna vez mudas la app a hosting serverless, haces una funcion que inyecte el API key desde variables de entorno y llame a Anthropic.

---

## Troubleshooting

**"No pude cargar data/respuestas.json"**
→ Estas abriendo `index.html` con doble click. Usa un servidor local (ver arriba).

**JSON invalido**
→ Validar con [jsonlint.com](https://jsonlint.com). Error tipico: coma extra al final del ultimo item de un array.

**El bot no encuentra match**
→ Revisar que el trigger tenga palabras reales del mensaje. El matcher normaliza tildes y mayusculas, pero no entiende sinonimos ni errores de tipeo. Para eso pasa a modo IA.

**Quiero traquear que preguntas hacen mas**
→ En `handleSend()` de `chatbot.js`, agregar un `fetch` a Supabase para insertar en una tabla `chat_logs`. Ya tenes la infra para eso en el proyecto `hrxfctzncixxqmpfhskv`.

---

## Checklist antes de mover a produccion

- [ ] Revise las 24 respuestas en `respuestas.json` y ajuste placeholders.
- [ ] Probe los 10 ejemplos del sidebar y devuelven lo esperado.
- [ ] Probe 5 consultas random del dia a dia y funcionan.
- [ ] Defini si va el modo IA o solo Local.
- [ ] Si va IA: tengo el webhook de N8N andando y apunte `BACKEND_URL` al webhook correcto.
- [ ] Agregue el boton en el menu principal de Gestion Productiva.
- [ ] Probe el login (si corresponde).

---

_Generado el 2026-04-20. 24 respuestas transcritas de las hojas originales del Dpto. de Ventas._

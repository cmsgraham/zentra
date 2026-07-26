/**
 * Alexa skill handler for adding items to a Zentra shopping list.
 *
 * Talks to POST {ZENTRA_API_BASE}/alexa/add-item, which authenticates with a
 * shared secret rather than a user token. That is why this skill needs no
 * account linking: the endpoint is already bound to one Zentra user via
 * ALEXA_USER_ID on the server.
 *
 * Environment (set on the Lambda, not in code):
 *   ZENTRA_API_BASE   e.g. https://usezentra.app/api
 *   ZENTRA_API_KEY    must equal ALEXA_API_KEY on the server
 *   ZENTRA_LISTS      optional JSON map of spoken name -> list UUID, e.g.
 *                     {"casa":"uuid-1","oficina":"uuid-2"}
 *                     Omit to always use the server's default list.
 */

const API_BASE = process.env.ZENTRA_API_BASE || 'https://usezentra.app/api';
const API_KEY = process.env.ZENTRA_API_KEY || '';

// Spoken list names are matched loosely: lowercase, accents stripped, so
// "Oficina" and "oficina" both resolve.
const LIST_MAP = (() => {
  try {
    const raw = JSON.parse(process.env.ZENTRA_LISTS || '{}');
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [fold(k), v]));
  } catch {
    return {};
  }
})();

function fold(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function speak(text, { end = true } = {}) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession: end,
    },
  };
}

function slot(request, name) {
  const v = request?.intent?.slots?.[name]?.value;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

async function addItem(item, listId) {
  const res = await fetch(`${API_BASE}/alexa/add-item`, {
    method: 'POST',
    headers: {
      // charset matters: Spanish items carry accents.
      'Content-Type': 'application/json; charset=utf-8',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(listId ? { item, listId } : { item }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Zentra responded ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export const handler = async (event) => {
  const request = event?.request ?? {};

  if (request.type === 'LaunchRequest') {
    return speak('Dime qué quieres agregar a la lista.', { end: false });
  }

  if (request.type === 'IntentRequest') {
    const intent = request.intent?.name;

    if (intent === 'AMAZON.HelpIntent') {
      return speak('Puedes decir: agrega leche a la lista.', { end: false });
    }
    if (intent === 'AMAZON.CancelIntent' || intent === 'AMAZON.StopIntent') {
      return speak('De acuerdo.');
    }

    if (intent === 'AddItemIntent') {
      const item = slot(request, 'item');
      if (!item) {
        return speak('No entendí qué agregar. Intenta decir: agrega leche.', { end: false });
      }

      const spokenList = slot(request, 'list');
      const listId = spokenList ? LIST_MAP[fold(spokenList)] : undefined;

      // Naming a list we do not recognise should not silently file the item
      // somewhere else — say so instead.
      if (spokenList && !listId) {
        return speak(`No conozco la lista ${spokenList}. No agregué nada.`);
      }

      try {
        await addItem(item, listId);
        return speak(spokenList ? `Listo, agregué ${item} a ${spokenList}.` : `Listo, agregué ${item}.`);
      } catch (err) {
        console.error('add-item failed', err);
        return speak('No pude agregarlo a Zentra en este momento.');
      }
    }
  }

  if (request.type === 'SessionEndedRequest') {
    return speak('');
  }

  return speak('No entendí. Intenta decir: agrega leche a la lista.', { end: false });
};

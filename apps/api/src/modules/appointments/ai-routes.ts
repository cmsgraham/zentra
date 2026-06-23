import type { FastifyInstance } from 'fastify';
import { BadRequestError } from '../../lib/errors.js';
import { assertAllowedImage } from '../../lib/file-validation.js';
import { getEnv } from '../../lib/env.js';

/**
 * Convert a local wall-clock date+time in the given IANA timezone to a UTC ISO
 * string. E.g. localInTimezoneToUtcIso('2026-04-23', '14:00', 'America/New_York')
 * returns the ISO instant when a clock in New York reads 14:00 on that date.
 *
 * Uses only the platform Intl API; no dependencies.
 */
function localInTimezoneToUtcIso(dateStr: string, timeStr: string, tz: string): string | null {
  // dateStr: 'YYYY-MM-DD', timeStr: 'HH:mm'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{1,2}:\d{2}$/.test(timeStr)) return null;
  const [hh, mm] = timeStr.split(':').map((n) => parseInt(n, 10));
  const [y, mo, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  if ([y, mo, d, hh, mm].some((n) => Number.isNaN(n))) return null;

  // Start by treating the wall clock as if it were UTC, then subtract the tz
  // offset at that instant to arrive at the true UTC time.
  const asUtcMs = Date.UTC(y, mo - 1, d, hh, mm, 0);

  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = dtf.formatToParts(new Date(asUtcMs));
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    // Intl can emit '24' for midnight in some locales; normalise.
    const hourVal = map.hour === '24' ? 0 : parseInt(map.hour, 10);
    const tzAsIfUtcMs = Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      hourVal,
      parseInt(map.minute, 10),
      parseInt(map.second, 10),
    );
    const offsetMs = tzAsIfUtcMs - asUtcMs;
    return new Date(asUtcMs - offsetMs).toISOString();
  } catch {
    // Unknown timezone — fall back to treating as UTC (old behaviour).
    return new Date(asUtcMs).toISOString();
  }
}

const SYSTEM_PROMPT = `You are an AI system that extracts calendar events from images.

The user will upload a screenshot of a schedule.

## Your task

Extract all visible events with:

* title
* date
* start time
* end time

## Rules

1. Group events by their correct date
2. Convert all times to 24-hour format (HH:MM)
3. If date is written as "Monday, April 20, 2026", convert to: "2026-04-20"
4. Ignore avatars, icons, and visual decorations
5. Only extract real events with time ranges
6. If end time is not visible, estimate a reasonable duration (usually 30-60 min)
7. If the date is not visible, use the fallback date provided in the user message

## Output format (STRICT JSON)

{
  "events": [
    {
      "title": "Event name",
      "date": "YYYY-MM-DD",
      "start": "HH:MM",
      "end": "HH:MM"
    }
  ]
}

Do not include any explanation or extra text.`;

export default async function appointmentAIRoutes(app: FastifyInstance) {
  // Extract events from an uploaded schedule image
  app.post('/appointments/ai/extract-from-image', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request) => {
    const env = getEnv();
    if (!env.OPENAI_API_KEY) {
      throw new BadRequestError('AI features are not configured');
    }

    const file = await request.file();
    if (!file) {
      throw new BadRequestError('Image file is required');
    }

    const buffer = await file.toBuffer();
    await assertAllowedImage(buffer, file.mimetype);

    // Convert to base64 data URI for OpenAI Vision
    const base64 = buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${base64}`;

    // Parse fallback date from fields if provided
    let fallbackDate = new Date().toISOString().slice(0, 10);
    // Multipart fields may come before or after the file
    const fields = (request as any).body;
    if (fields?.fallbackDate) {
      fallbackDate = String(fields.fallbackDate);
    }

    const userContent = [
      {
        type: 'text',
        text: `Extract all calendar events from this image. If any date is not visible, use ${fallbackDate} as the fallback date.`,
      },
      { type: 'image_url', image_url: { url: dataUri } },
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL_VISION,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_completion_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      app.log.error({ status: response.status, err }, 'OpenAI Vision API error');
      throw new BadRequestError('Failed to process image. Please try again.');
    }

    const data = await response.json() as any;
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new BadRequestError('AI returned empty response');
    }

    // Parse JSON from response
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new BadRequestError('AI returned invalid format');
      }
    }

    if (!parsed.events || !Array.isArray(parsed.events)) {
      return { events: [] };
    }

    // Validate and normalize events
    const events = parsed.events
      .filter((e: any) => e.title && e.start)
      .map((e: any) => ({
        title: String(e.title).slice(0, 500),
        date: String(e.date || fallbackDate).slice(0, 10),
        start: String(e.start).slice(0, 5),
        end: String(e.end || e.start).slice(0, 5),
      }));

    return { events };
  });

  // Bulk import extracted events as appointments
  app.post('/appointments/ai/import', {
    preHandler: [app.authenticate],
  }, async (request, reply) => {
    const body = request.body as any;

    if (!body?.events || !Array.isArray(body.events) || body.events.length === 0) {
      throw new BadRequestError('No events to import');
    }

    if (body.events.length > 50) {
      throw new BadRequestError('Maximum 50 events per import');
    }

    const userId = request.user.sub;
    const created: any[] = [];

    // Resolve user's timezone once so the wall-clock times extracted from the
    // screenshot are interpreted in the user's zone (not server UTC).
    const tzRow = await app.pg.query(`SELECT timezone FROM users WHERE id = $1`, [userId]);
    const userTz: string = tzRow.rows[0]?.timezone || 'UTC';

    for (const event of body.events) {
      if (!event.title || !event.date || !event.start) continue;

      const startsAt = localInTimezoneToUtcIso(event.date, event.start, userTz);
      const endsAt = event.end
        ? localInTimezoneToUtcIso(event.date, event.end, userTz)
        : null;

      // Validate date
      if (!startsAt || isNaN(new Date(startsAt).getTime())) continue;
      if (endsAt && isNaN(new Date(endsAt).getTime())) continue;

      const result = await app.pg.query(
        `INSERT INTO appointments
          (owner_user_id, title, starts_at, ends_at, status)
         VALUES ($1, $2, $3, $4, 'scheduled')
         RETURNING *`,
        [userId, event.title, startsAt, endsAt],
      );

      const row = result.rows[0];
      created.push({
        id: row.id,
        title: row.title,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      });
    }

    return reply.status(201).send({ imported: created.length, items: created });
  });
}

import type { FastifyInstance } from 'fastify';
import { BadRequestError } from '../../lib/errors.js';
import { assertAllowedImage } from '../../lib/file-validation.js';
import { getEnv } from '../../lib/env.js';

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

    for (const event of body.events) {
      if (!event.title || !event.date || !event.start) continue;

      const startsAt = new Date(`${event.date}T${event.start}:00`).toISOString();
      const endsAt = event.end
        ? new Date(`${event.date}T${event.end}:00`).toISOString()
        : null;

      // Validate date
      if (isNaN(new Date(startsAt).getTime())) continue;
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

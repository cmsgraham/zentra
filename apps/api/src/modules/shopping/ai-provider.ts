import { getEnv } from '../../lib/env.js';

const SHOPPING_TEXT_SYSTEM_PROMPT = `You are an AI assistant for a smart shopping list app.
Your job is to extract shopping items from messy text, notes, or copied messages.
Rules:
1. Extract individual shopping items.
2. If quantities or units are mentioned, include them.
3. If a category is obvious, suggest one from: groceries, cleaning, personal_care, kitchen, hardware, pets, pharmacy, miscellaneous.
4. Split multi-item lines into separate items.
5. Normalize item names to be clear and concise but natural.
6. Set confidence_score lower for ambiguous or partial entries.
7. If text is unclear, add ambiguity_flags to explain.
8. Do NOT add non-shopping items (e.g. "call dentist" is not a shopping item).
9. Output must follow the schema exactly.`;

const SHOPPING_IMAGE_SYSTEM_PROMPT = `You are an AI assistant reading an image of handwritten or typed shopping notes, grocery lists, or similar.
Extract shopping items conservatively.
If text is hard to read, lower confidence and add ambiguity flags.
Use the same output schema as text extraction.`;

export async function extractShoppingItemsFromText(text: string): Promise<any> {
  const env = getEnv();

  const userPrompt = `Extract shopping items from this text:

${text}

Return JSON with this schema:
{
  "items": [
    {
      "name": "string (item name, clear and concise)",
      "quantity": number or null,
      "unit": "string or null (e.g. lbs, oz, kg, pack, bottle, can, box, dozen, each)",
      "category": "groceries|cleaning|personal_care|kitchen|hardware|pets|pharmacy|miscellaneous or null",
      "confidence_score": 0.0-1.0,
      "ambiguity_flags": ["string"],
      "original_text_snippet": "string"
    }
  ]
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL_TEXT,
      messages: [
        { role: 'system', content: SHOPPING_TEXT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${err}`);
  }

  const data = await response.json() as any;
  const content = data.choices[0].message.content;
  const parsed = JSON.parse(content);
  if (!parsed.items || !Array.isArray(parsed.items)) {
    return { items: [] };
  }
  return parsed;
}

export async function extractShoppingItemsFromImage(imageUrl: string): Promise<any> {
  const env = getEnv();

  const userContent = [
    {
      type: 'text',
      text: `Extract shopping items from this image. Return JSON with this schema:
{
  "items": [
    {
      "name": "string",
      "quantity": number or null,
      "unit": "string or null",
      "category": "groceries|cleaning|personal_care|kitchen|hardware|pets|pharmacy|miscellaneous or null",
      "confidence_score": 0.0-1.0,
      "ambiguity_flags": ["string"],
      "original_text_snippet": "string"
    }
  ]
}`,
    },
    { type: 'image_url', image_url: { url: imageUrl } },
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
        { role: 'system', content: SHOPPING_IMAGE_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_completion_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI Vision API error: ${response.status} ${err}`);
  }

  const data = await response.json() as any;
  const content = data.choices[0].message.content;

  // Try to extract JSON from response
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      return { items: [] };
    }
  }

  if (!parsed.items || !Array.isArray(parsed.items)) {
    return { items: [] };
  }
  return parsed;
}

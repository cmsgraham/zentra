import { getEnv } from '../../lib/env.js';

export interface AIProvider {
  generateTaskDrafts(input: string, context: Record<string, unknown>): Promise<any>;
  generateTaskDraftsFromImage(imageUrl: string, context: Record<string, unknown>): Promise<any>;
  improveTask(task: Record<string, unknown>, similarTasks: Record<string, unknown>[]): Promise<any>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  chat(systemPrompt: string, userMessage: string): Promise<string>;
}

const EXTRACTION_SYSTEM_PROMPT = `You are an AI assistant for a collaborative task management app.
Your job is to extract actionable tasks from messy text.
Rules:
1. Extract only actionable tasks.
2. Ignore non-actionable commentary unless it clearly implies a task.
3. Split multiple actions into separate tasks.
4. Use concise, clear titles.
5. Suggested status values: pending, in_progress, blocked, done.
6. Suggested priority values: low, medium, high, critical.
7. If blocked is suggested, provide a blocker reason when possible.
8. If a due date is implied but uncertain, include it in ambiguity flags instead of inventing a specific date.
9. Never fabricate an assignee if context does not justify it.
10. Output must follow the schema exactly.`;

const IMPROVEMENT_SYSTEM_PROMPT = `You improve existing task wording for clarity and usefulness.
You may suggest a better title, description, and priority, but you must preserve intent.
Use similar past tasks for naming consistency.`;

const IMAGE_SYSTEM_PROMPT = `You are an AI assistant reading an image of handwritten or typed notes.
Extract actionable tasks conservatively.
If text is difficult to read, lower confidence and add ambiguity flags.
Return structured JSON with the same schema as text-to-task extraction.`;

export class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private textModel: string;
  private visionModel: string;
  private embeddingModel: string;

  constructor() {
    const env = getEnv();
    this.apiKey = env.OPENAI_API_KEY;
    this.textModel = env.OPENAI_MODEL_TEXT;
    this.visionModel = env.OPENAI_MODEL_VISION;
    this.embeddingModel = env.OPENAI_EMBEDDING_MODEL;
  }

  private async callChat(messages: any[], model?: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: model || this.textModel,
        messages,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${err}`);
    }

    const data = await response.json() as any;
    return data.choices[0].message.content;
  }

  async generateTaskDrafts(input: string, context: Record<string, unknown>): Promise<any> {
    const userPrompt = `Context:
- Workspace name: ${context.workspaceName || 'Unknown'}
- Known users: ${JSON.stringify(context.knownUsers || [])}
- Known tags: ${JSON.stringify(context.knownTags || [])}
- Similar past tasks: ${JSON.stringify(context.similarTasks || [])}

Raw text:
${input}

Return JSON with this schema:
{
  "items": [
    {
      "title": "string",
      "description": "string|null",
      "suggested_status": "pending|in_progress|blocked|done",
      "suggested_priority": "low|medium|high|critical",
      "blocked_reason": "string|null",
      "suggested_assignee_id": "uuid|null",
      "suggested_due_date": "ISO-8601 datetime|null",
      "confidence_score": 0.0-1.0,
      "ambiguity_flags": ["string"],
      "original_text_snippet": "string"
    }
  ]
}`;

    const content = await this.callChat([
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    return this.parseAndValidate(content);
  }

  async generateTaskDraftsFromImage(imageUrl: string, context: Record<string, unknown>): Promise<any> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const userContent = [
      {
        type: 'text',
        text: `Context:
- Workspace name: ${context.workspaceName || 'Unknown'}
- Known users: ${JSON.stringify(context.knownUsers || [])}

Extract actionable tasks from this image. Return JSON with this schema:
{
  "items": [
    {
      "title": "string",
      "description": "string|null",
      "suggested_status": "pending|in_progress|blocked|done",
      "suggested_priority": "low|medium|high|critical",
      "blocked_reason": "string|null",
      "suggested_assignee_id": "uuid|null",
      "suggested_due_date": null,
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
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.visionModel,
        messages: [
          { role: 'system', content: IMAGE_SYSTEM_PROMPT },
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
    return this.parseAndValidate(content);
  }

  async improveTask(task: Record<string, unknown>, similarTasks: Record<string, unknown>[]): Promise<any> {
    const userPrompt = `Task:
${JSON.stringify(task)}

Similar past tasks:
${JSON.stringify(similarTasks)}

Return JSON:
{
  "suggested_title": "string",
  "suggested_description": "string|null",
  "suggested_priority": "low|medium|high|critical",
  "rationale": "string",
  "similar_task_ids": ["uuid"]
}`;

    const content = await this.callChat([
      { role: 'system', content: IMPROVEMENT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    return JSON.parse(content);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.embeddingModel,
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI Embedding API error: ${response.status} ${err}`);
    }

    const data = await response.json() as any;
    return data.data.map((d: any) => d.embedding);
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    return this.callChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]);
  }

  private parseAndValidate(content: string): any {
    try {
      const parsed = JSON.parse(content);
      if (!parsed.items || !Array.isArray(parsed.items)) {
        throw new Error('Missing items array');
      }
      return parsed;
    } catch (firstErr) {
      // Retry with repair: try to extract JSON from content
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.items && Array.isArray(parsed.items)) return parsed;
        } catch { /* fall through */ }
      }
      throw new Error(`Invalid AI response JSON: ${(firstErr as Error).message}`);
    }
  }
}

let providerInstance: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (!providerInstance) {
    providerInstance = new OpenAIProvider();
  }
  return providerInstance;
}

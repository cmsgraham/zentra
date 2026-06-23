import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const ALLOWED_FIELDS = ['quantity', 'price', 'vendor', 'category', 'notes', 'url', 'custom'] as const;
const enabledFieldsSchema = z
  .array(z.enum(ALLOWED_FIELDS))
  .max(ALLOWED_FIELDS.length)
  .optional();

const createListSchema = z.object({
  title: z.string().min(1).max(200),
  enabledFields: enabledFieldsSchema,
  customFieldLabel: z.string().max(50).nullable().optional(),
});

const updateListSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  archived: z.boolean().optional(),
  enabledFields: enabledFieldsSchema,
  customFieldLabel: z.string().max(50).nullable().optional(),
});

const shareListSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'editor']).default('editor'),
});

// Restrict product URLs to http(s) so the link is safe to render as an
// anchor target without exposing javascript: or data: URI XSS vectors.
const urlSchema = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), 'URL must start with http:// or https://');

const createItemSchema = z.object({
  displayName: z.string().min(1).max(500),
  quantity: z.number().positive().optional(),
  price: z.number().nonnegative().nullable().optional(),
  vendor: z.string().max(200).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  url: urlSchema.nullable().optional(),
  customValue: z.string().max(500).nullable().optional(),
  isSection: z.boolean().optional(),
});

const updateItemSchema = z.object({
  displayName: z.string().min(1).max(500).optional(),
  quantity: z.number().positive().nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  vendor: z.string().max(200).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  url: urlSchema.nullable().optional(),
  customValue: z.string().max(500).nullable().optional(),
});

const reorderSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

function normalizeItemName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Recompute each unchecked item's section (store) membership from its position
// in sort_order, so the grouping is explicit and survives check/uncheck and
// reorder. Checked items keep whatever section they had when last positioned —
// that's what lets an unchecked item return to its original store. Accepts any
// object exposing pg-style `query` (the pool or a transaction client).
async function assignSectionIds(
  db: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
  listId: string,
): Promise<void> {
  const { rows } = await db.query(
    'SELECT id, is_section, checked FROM shopping_list_items WHERE list_id = $1 ORDER BY sort_order ASC, created_at ASC',
    [listId],
  );
  let currentSection: string | null = null;
  for (const r of rows) {
    if (r.is_section) {
      currentSection = r.id as string;
      continue;
    }
    // Preserve checked items' section so they pop back into the right store.
    if (r.checked) continue;
    await db.query('UPDATE shopping_list_items SET section_id = $1 WHERE id = $2', [currentSection, r.id]);
  }
}

async function checkListAccess(app: FastifyInstance, listId: string, userId: string): Promise<string> {
  // Check if user is owner or member
  const ownerCheck = await app.pg.query(
    'SELECT id FROM shopping_lists WHERE id = $1 AND owner_user_id = $2',
    [listId, userId],
  );
  if (ownerCheck.rows.length > 0) return 'owner';

  const memberCheck = await app.pg.query(
    'SELECT role FROM shopping_list_members WHERE list_id = $1 AND user_id = $2',
    [listId, userId],
  );
  if (memberCheck.rows.length > 0) return memberCheck.rows[0].role;

  throw new ForbiddenError();
}

export default async function shoppingRoutes(app: FastifyInstance) {
  // ========================
  // SHOPPING LISTS CRUD
  // ========================

  // List all shopping lists for current user
  app.get('/shopping/lists', { preHandler: [app.authenticate] }, async (request) => {
    const { page, pageSize } = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const offset = (page - 1) * pageSize;

    const countResult = await app.pg.query(
      `SELECT count(DISTINCT sl.id)
       FROM shopping_lists sl
       LEFT JOIN shopping_list_members slm ON slm.list_id = sl.id
       WHERE (sl.owner_user_id = $1 OR slm.user_id = $1) AND sl.archived = false`,
      [userId],
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT DISTINCT sl.*, u.name AS owner_name, lower(sl.title) AS sort_title,
        (SELECT count(*) FROM shopping_list_items sli WHERE sli.list_id = sl.id AND sli.checked = false) AS unchecked_count,
        (SELECT count(*) FROM shopping_list_items sli WHERE sli.list_id = sl.id) AS total_items
       FROM shopping_lists sl
       JOIN users u ON u.id = sl.owner_user_id
       LEFT JOIN shopping_list_members slm ON slm.list_id = sl.id
       WHERE (sl.owner_user_id = $1 OR slm.user_id = $1) AND sl.archived = false
       ORDER BY sort_title ASC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        title: r.title,
        ownerName: r.owner_name,
        isOwner: r.owner_user_id === userId,
        uncheckedCount: parseInt(r.unchecked_count, 10),
        totalItems: parseInt(r.total_items, 10),
        archived: r.archived,
        enabledFields: r.enabled_fields ?? ['quantity'],
        customFieldLabel: r.custom_field_label ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      pagination: { page, pageSize, total },
    };
  });

  // Create shopping list
  app.post('/shopping/lists', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createListSchema.parse(request.body);
    const userId = request.user.sub;

    const enabledFields = body.enabledFields !== undefined
      ? Array.from(new Set(body.enabledFields))
      : ['quantity'];

    const result = await app.pg.query(
      `INSERT INTO shopping_lists (owner_user_id, title, enabled_fields, custom_field_label) VALUES ($1, $2, $3, $4)
       RETURNING id, title, archived, enabled_fields, custom_field_label, created_at, updated_at`,
      [userId, body.title, enabledFields, body.customFieldLabel?.trim() || null],
    );
    const list = result.rows[0];

    return reply.status(201).send({
      id: list.id,
      title: list.title,
      archived: list.archived,
      enabledFields: list.enabled_fields ?? ['quantity'],
      customFieldLabel: list.custom_field_label ?? null,
      createdAt: list.created_at,
      updatedAt: list.updated_at,
    });
  });

  // Get single shopping list
  app.get('/shopping/lists/:listId', { preHandler: [app.authenticate] }, async (request) => {
    const { listId } = request.params as { listId: string };
    const userId = request.user.sub;
    await checkListAccess(app, listId, userId);

    const result = await app.pg.query(
      `SELECT sl.*, u.name AS owner_name FROM shopping_lists sl
       JOIN users u ON u.id = sl.owner_user_id WHERE sl.id = $1`,
      [listId],
    );
    if (result.rows.length === 0) throw new NotFoundError();
    const r = result.rows[0];

    // Get members
    const members = await app.pg.query(
      `SELECT slm.user_id, slm.role, u.name, u.email FROM shopping_list_members slm
       JOIN users u ON u.id = slm.user_id WHERE slm.list_id = $1`,
      [listId],
    );

    return {
      id: r.id,
      title: r.title,
      ownerUserId: r.owner_user_id,
      ownerName: r.owner_name,
      isOwner: r.owner_user_id === userId,
      archived: r.archived,
      enabledFields: r.enabled_fields ?? ['quantity'],
      customFieldLabel: r.custom_field_label ?? null,
      members: members.rows.map(m => ({
        userId: m.user_id,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });

  // Update shopping list
  app.patch('/shopping/lists/:listId', { preHandler: [app.authenticate] }, async (request) => {
    const { listId } = request.params as { listId: string };
    const body = updateListSchema.parse(request.body);
    const userId = request.user.sub;
    await checkListAccess(app, listId, userId);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.title !== undefined) { sets.push(`title = $${idx++}`); values.push(body.title); }
    if (body.archived !== undefined) { sets.push(`archived = $${idx++}`); values.push(body.archived); }
    if (body.enabledFields !== undefined) {
      sets.push(`enabled_fields = $${idx++}`);
      values.push(Array.from(new Set(body.enabledFields)));
    }
    if (body.customFieldLabel !== undefined) {
      sets.push(`custom_field_label = $${idx++}`);
      values.push(body.customFieldLabel?.trim() || null);
    }

    if (sets.length === 0) throw new BadRequestError('No fields to update');

    values.push(listId);
    const result = await app.pg.query(
      `UPDATE shopping_lists SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    const r = result.rows[0];
    return {
      id: r.id,
      title: r.title,
      archived: r.archived,
      enabledFields: r.enabled_fields ?? ['quantity'],
      customFieldLabel: r.custom_field_label ?? null,
      updatedAt: r.updated_at,
    };
  });

  // Delete shopping list (owner only)
  app.delete('/shopping/lists/:listId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { listId } = request.params as { listId: string };
    const userId = request.user.sub;

    const check = await app.pg.query('SELECT owner_user_id FROM shopping_lists WHERE id = $1', [listId]);
    if (check.rows.length === 0) throw new NotFoundError();
    if (check.rows[0].owner_user_id !== userId) throw new ForbiddenError();

    await app.pg.query('DELETE FROM shopping_lists WHERE id = $1', [listId]);
    return reply.status(204).send();
  });

  // ========================
  // SHARING / MEMBERS
  // ========================

  // Share list with a user
  app.post('/shopping/lists/:listId/share', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { listId } = request.params as { listId: string };
    const body = shareListSchema.parse(request.body);
    const userId = request.user.sub;

    // Only owner can share
    const check = await app.pg.query('SELECT owner_user_id FROM shopping_lists WHERE id = $1', [listId]);
    if (check.rows.length === 0) throw new NotFoundError();
    if (check.rows[0].owner_user_id !== userId) throw new ForbiddenError();

    // Check target user exists and is a friend
    const friendCheck = await app.pg.query(
      `SELECT id FROM friendships
       WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [userId, body.userId],
    );
    if (friendCheck.rows.length === 0) throw new BadRequestError('User must be a friend');

    await app.pg.query(
      `INSERT INTO shopping_list_members (list_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (list_id, user_id) DO UPDATE SET role = $3`,
      [listId, body.userId, body.role],
    );

    return reply.status(201).send({ ok: true });
  });

  // Remove member from list
  app.delete('/shopping/lists/:listId/members/:memberId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { listId, memberId } = request.params as { listId: string; memberId: string };
    const userId = request.user.sub;

    const check = await app.pg.query('SELECT owner_user_id FROM shopping_lists WHERE id = $1', [listId]);
    if (check.rows.length === 0) throw new NotFoundError();
    if (check.rows[0].owner_user_id !== userId && memberId !== userId) throw new ForbiddenError();

    await app.pg.query('DELETE FROM shopping_list_members WHERE list_id = $1 AND user_id = $2', [listId, memberId]);
    return reply.status(204).send();
  });

  // List members
  app.get('/shopping/lists/:listId/members', { preHandler: [app.authenticate] }, async (request) => {
    const { listId } = request.params as { listId: string };
    const userId = request.user.sub;
    await checkListAccess(app, listId, userId);

    const owner = await app.pg.query(
      `SELECT u.id AS user_id, u.name, u.email, 'owner' AS role
       FROM shopping_lists sl JOIN users u ON u.id = sl.owner_user_id WHERE sl.id = $1`,
      [listId],
    );
    const members = await app.pg.query(
      `SELECT slm.user_id, u.name, u.email, slm.role::text FROM shopping_list_members slm
       JOIN users u ON u.id = slm.user_id WHERE slm.list_id = $1`,
      [listId],
    );

    return {
      items: [...owner.rows, ...members.rows].map(m => ({
        userId: m.user_id,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
    };
  });

  // ========================
  // SHOPPING LIST ITEMS
  // ========================

  // List items in a shopping list
  app.get('/shopping/lists/:listId/items', { preHandler: [app.authenticate] }, async (request) => {
    const { listId } = request.params as { listId: string };
    const userId = request.user.sub;
    await checkListAccess(app, listId, userId);

    const result = await app.pg.query(
      `SELECT sli.*, u.name AS created_by_name, cu.name AS checked_by_name,
        sim.total_added_count AS memory_added_count, sim.total_checked_count AS memory_checked_count,
        sim.last_checked_at AS memory_last_checked, sim.avg_days_between_checks AS memory_avg_days
       FROM shopping_list_items sli
       JOIN users u ON u.id = sli.created_by_user_id
       LEFT JOIN users cu ON cu.id = sli.checked_by_user_id
       LEFT JOIN shopping_item_memory sim ON sim.id = sli.item_memory_id
       WHERE sli.list_id = $1
       ORDER BY sli.checked ASC, sli.sort_order ASC, sli.created_at ASC`,
      [listId],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        listId: r.list_id,
        displayName: r.display_name,
        normalizedName: r.normalized_name,
        quantity: r.quantity ? parseFloat(r.quantity) : null,
        unit: r.unit,
        notes: r.notes,
        category: r.category,
        price: r.price != null ? parseFloat(r.price) : null,
        vendor: r.vendor,
        url: r.url,
        customValue: r.custom_value,
        isSection: r.is_section ?? false,
        sectionId: r.section_id ?? null,
        checked: r.checked,
        checkedAt: r.checked_at,
        checkedByName: r.checked_by_name,
        createdByName: r.created_by_name,
        createdByUserId: r.created_by_user_id,
        sortOrder: r.sort_order,
        memoryStats: r.memory_added_count ? {
          addedCount: r.memory_added_count,
          checkedCount: r.memory_checked_count,
          lastChecked: r.memory_last_checked,
          avgDaysBetween: r.memory_avg_days ? parseFloat(r.memory_avg_days) : null,
        } : null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  });

  // Add item to shopping list
  app.post('/shopping/lists/:listId/items', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { listId } = request.params as { listId: string };
    const body = createItemSchema.parse(request.body);
    const userId = request.user.sub;
    await checkListAccess(app, listId, userId);

    const normalized = normalizeItemName(body.displayName);

    // Find or create item memory
    const memResult = await app.pg.query(
      `INSERT INTO shopping_item_memory (user_id, normalized_name, preferred_display_name, default_category, default_unit, total_added_count, last_added_at)
       VALUES ($1, $2, $3, $4, $5, 1, now())
       ON CONFLICT (user_id, normalized_name) DO UPDATE SET
         total_added_count = shopping_item_memory.total_added_count + 1,
         last_added_at = now(),
         preferred_display_name = COALESCE(EXCLUDED.preferred_display_name, shopping_item_memory.preferred_display_name),
         default_category = COALESCE(EXCLUDED.default_category, shopping_item_memory.default_category)
       RETURNING id`,
      [userId, normalized, body.displayName, null, null],
    );
    const memoryId = memResult.rows[0].id;

    // Get sort_order extents — new rows always go to the top so they're
    // immediately visible without scrolling.
    const sortBounds = await app.pg.query(
      'SELECT COALESCE(MAX(sort_order), -1) AS max_sort, COALESCE(MIN(sort_order), 0) AS min_sort FROM shopping_list_items WHERE list_id = $1',
      [listId],
    );
    const newSort = sortBounds.rows[0].min_sort - 1;

    const result = await app.pg.query(
      `INSERT INTO shopping_list_items (list_id, item_memory_id, display_name, normalized_name, quantity, unit, notes, category, price, vendor, url, custom_value, is_section, created_by_user_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        listId,
        memoryId,
        body.displayName,
        normalized,
        body.quantity || null,
        null,
        body.notes?.trim() || null,
        body.category ?? null,
        body.price ?? null,
        body.vendor?.trim() || null,
        body.url?.trim() || null,
        body.customValue?.trim() || null,
        body.isSection ?? false,
        userId,
        newSort,
      ],
    );
    const item = result.rows[0];

    // Log event
    await app.pg.query(
      `INSERT INTO shopping_item_events (item_id, list_id, item_memory_id, event_type, actor_user_id, item_name)
       VALUES ($1, $2, $3, 'added', $4, $5)`,
      [item.id, listId, memoryId, userId, body.displayName],
    );

    // Touch list updated_at
    await app.pg.query('UPDATE shopping_lists SET updated_at = now() WHERE id = $1', [listId]);

    return reply.status(201).send({
      id: item.id,
      listId: item.list_id,
      displayName: item.display_name,
      normalizedName: item.normalized_name,
      quantity: item.quantity ? parseFloat(item.quantity) : null,
      unit: item.unit,
      notes: item.notes,
      category: item.category,
      price: item.price != null ? parseFloat(item.price) : null,
      vendor: item.vendor,
      url: item.url,
      customValue: item.custom_value,
      isSection: item.is_section ?? false,
      sectionId: item.section_id ?? null,
      checked: item.checked,
      sortOrder: item.sort_order,
      createdAt: item.created_at,
    });
  });

  // Update item
  app.patch('/shopping/items/:itemId', { preHandler: [app.authenticate] }, async (request) => {
    const { itemId } = request.params as { itemId: string };
    const body = updateItemSchema.parse(request.body);
    const userId = request.user.sub;

    const existing = await app.pg.query('SELECT * FROM shopping_list_items WHERE id = $1', [itemId]);
    if (existing.rows.length === 0) throw new NotFoundError();
    await checkListAccess(app, existing.rows[0].list_id, userId);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.displayName !== undefined) {
      sets.push(`display_name = $${idx++}`, `normalized_name = $${idx++}`);
      values.push(body.displayName, normalizeItemName(body.displayName));
    }
    if (body.quantity !== undefined) { sets.push(`quantity = $${idx++}`); values.push(body.quantity); }
    if (body.price !== undefined) { sets.push(`price = $${idx++}`); values.push(body.price); }
    if (body.vendor !== undefined) { sets.push(`vendor = $${idx++}`); values.push(body.vendor?.trim() || null); }
    if (body.url !== undefined) { sets.push(`url = $${idx++}`); values.push(body.url?.trim() || null); }
    if (body.category !== undefined) { sets.push(`category = $${idx++}`); values.push(body.category); }
    if (body.notes !== undefined) { sets.push(`notes = $${idx++}`); values.push(body.notes?.trim() || null); }
    if (body.customValue !== undefined) { sets.push(`custom_value = $${idx++}`); values.push(body.customValue?.trim() || null); }

    if (sets.length === 0) throw new BadRequestError('No fields to update');

    values.push(itemId);
    const result = await app.pg.query(
      `UPDATE shopping_list_items SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    const item = result.rows[0];

    // Log event
    await app.pg.query(
      `INSERT INTO shopping_item_events (item_id, list_id, item_memory_id, event_type, actor_user_id, item_name)
       VALUES ($1, $2, $3, 'edited', $4, $5)`,
      [itemId, item.list_id, item.item_memory_id, userId, item.display_name],
    );

    await app.pg.query('UPDATE shopping_lists SET updated_at = now() WHERE id = $1', [item.list_id]);

    return {
      id: item.id,
      displayName: item.display_name,
      quantity: item.quantity ? parseFloat(item.quantity) : null,
      unit: item.unit,
      notes: item.notes,
      category: item.category,
      price: item.price != null ? parseFloat(item.price) : null,
      vendor: item.vendor,
      url: item.url,
      customValue: item.custom_value,
      checked: item.checked,
      updatedAt: item.updated_at,
    };
  });

  // Check/uncheck item
  app.post('/shopping/items/:itemId/toggle', { preHandler: [app.authenticate] }, async (request) => {
    const { itemId } = request.params as { itemId: string };
    const userId = request.user.sub;

    const existing = await app.pg.query('SELECT * FROM shopping_list_items WHERE id = $1', [itemId]);
    if (existing.rows.length === 0) throw new NotFoundError();
    const item = existing.rows[0];
    await checkListAccess(app, item.list_id, userId);

    const newChecked = !item.checked;

    await app.pg.query(
      `UPDATE shopping_list_items SET checked = $1, checked_at = $2, checked_by_user_id = $3 WHERE id = $4`,
      [newChecked, newChecked ? new Date() : null, newChecked ? userId : null, itemId],
    );

    // Update memory stats
    if (newChecked && item.item_memory_id) {
      // Calculate avg days between checks
      const prevCheck = await app.pg.query(
        `SELECT last_checked_at, total_checked_count, avg_days_between_checks
         FROM shopping_item_memory WHERE id = $1`,
        [item.item_memory_id],
      );
      const mem = prevCheck.rows[0];
      let newAvg = mem.avg_days_between_checks;
      if (mem.last_checked_at) {
        const daysSinceLast = (Date.now() - new Date(mem.last_checked_at).getTime()) / (1000 * 60 * 60 * 24);
        const prevTotal = mem.total_checked_count || 0;
        const prevAvg = parseFloat(mem.avg_days_between_checks || '0');
        newAvg = prevTotal > 0 ? ((prevAvg * prevTotal) + daysSinceLast) / (prevTotal + 1) : daysSinceLast;
      }
      await app.pg.query(
        `UPDATE shopping_item_memory SET total_checked_count = total_checked_count + 1, last_checked_at = now(), avg_days_between_checks = $1 WHERE id = $2`,
        [newAvg, item.item_memory_id],
      );
    }

    // Log event
    await app.pg.query(
      `INSERT INTO shopping_item_events (item_id, list_id, item_memory_id, event_type, actor_user_id, item_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [itemId, item.list_id, item.item_memory_id, newChecked ? 'checked' : 'unchecked', userId, item.display_name],
    );

    await app.pg.query('UPDATE shopping_lists SET updated_at = now() WHERE id = $1', [item.list_id]);

    return { id: itemId, checked: newChecked, checkedAt: newChecked ? new Date() : null };
  });

  // Delete item
  app.delete('/shopping/items/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string };
    const userId = request.user.sub;

    const existing = await app.pg.query('SELECT * FROM shopping_list_items WHERE id = $1', [itemId]);
    if (existing.rows.length === 0) throw new NotFoundError();
    await checkListAccess(app, existing.rows[0].list_id, userId);

    // Log event before delete
    await app.pg.query(
      `INSERT INTO shopping_item_events (item_id, list_id, item_memory_id, event_type, actor_user_id, item_name)
       VALUES ($1, $2, $3, 'removed', $4, $5)`,
      [itemId, existing.rows[0].list_id, existing.rows[0].item_memory_id, userId, existing.rows[0].display_name],
    );

    await app.pg.query('DELETE FROM shopping_list_items WHERE id = $1', [itemId]);
    await app.pg.query('UPDATE shopping_lists SET updated_at = now() WHERE id = $1', [existing.rows[0].list_id]);

    return reply.status(204).send();
  });

  // Reorder items
  app.post('/shopping/lists/:listId/reorder', { preHandler: [app.authenticate] }, async (request) => {
    const { listId } = request.params as { listId: string };
    const body = reorderSchema.parse(request.body);
    const userId = request.user.sub;
    await checkListAccess(app, listId, userId);

    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < body.itemIds.length; i++) {
        await client.query(
          'UPDATE shopping_list_items SET sort_order = $1 WHERE id = $2 AND list_id = $3',
          [i, body.itemIds[i], listId],
        );
      }
      // Re-derive section membership from the new ordering so items dragged
      // under a different store header are reassigned, while checked items keep
      // their store.
      await assignSectionIds(client, listId);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { ok: true };
  });

  // ========================
  // HISTORY & STATS
  // ========================

  // Get activity/history for a list
  app.get('/shopping/lists/:listId/history', { preHandler: [app.authenticate] }, async (request) => {
    const { listId } = request.params as { listId: string };
    const { page, pageSize } = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    await checkListAccess(app, listId, userId);
    const offset = (page - 1) * pageSize;

    const countResult = await app.pg.query(
      'SELECT count(*) FROM shopping_item_events WHERE list_id = $1', [listId],
    );

    const result = await app.pg.query(
      `SELECT sie.*, u.name AS actor_name FROM shopping_item_events sie
       JOIN users u ON u.id = sie.actor_user_id
       WHERE sie.list_id = $1
       ORDER BY sie.created_at DESC LIMIT $2 OFFSET $3`,
      [listId, pageSize, offset],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        eventType: r.event_type,
        itemName: r.item_name,
        actorName: r.actor_name,
        metadata: r.metadata,
        createdAt: r.created_at,
      })),
      pagination: { page, pageSize, total: parseInt(countResult.rows[0].count, 10) },
    };
  });

  // Frequent items (from item memory)
  app.get('/shopping/stats/frequent', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { pageSize } = paginationSchema.parse(request.query);

    const result = await app.pg.query(
      `SELECT * FROM shopping_item_memory WHERE user_id = $1
       ORDER BY total_checked_count DESC, total_added_count DESC LIMIT $2`,
      [userId, pageSize],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        name: r.preferred_display_name,
        normalizedName: r.normalized_name,
        category: r.default_category,
        unit: r.default_unit,
        addedCount: r.total_added_count,
        checkedCount: r.total_checked_count,
        lastAdded: r.last_added_at,
        lastChecked: r.last_checked_at,
        avgDaysBetween: r.avg_days_between_checks ? parseFloat(r.avg_days_between_checks) : null,
      })),
    };
  });

  // Recently bought items
  app.get('/shopping/stats/recent', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { pageSize } = paginationSchema.parse(request.query);

    const result = await app.pg.query(
      `SELECT * FROM shopping_item_memory WHERE user_id = $1 AND last_checked_at IS NOT NULL
       ORDER BY last_checked_at DESC LIMIT $2`,
      [userId, pageSize],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        name: r.preferred_display_name,
        category: r.default_category,
        lastChecked: r.last_checked_at,
        checkedCount: r.total_checked_count,
        avgDaysBetween: r.avg_days_between_checks ? parseFloat(r.avg_days_between_checks) : null,
      })),
    };
  });

  // Suggested re-adds (items due soon based on frequency)
  app.get('/shopping/stats/suggestions', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const result = await app.pg.query(
      `SELECT *,
        EXTRACT(EPOCH FROM (now() - last_checked_at)) / 86400 AS days_since_last,
        avg_days_between_checks AS avg_days
       FROM shopping_item_memory
       WHERE user_id = $1 AND avg_days_between_checks IS NOT NULL AND total_checked_count >= 2
       ORDER BY (EXTRACT(EPOCH FROM (now() - last_checked_at)) / 86400) / avg_days_between_checks DESC
       LIMIT 20`,
      [userId],
    );

    return {
      items: result.rows.map(r => {
        const daysSince = parseFloat(r.days_since_last || '0');
        const avgDays = parseFloat(r.avg_days || '0');
        const ratio = avgDays > 0 ? daysSince / avgDays : 0;
        let urgency: 'overdue' | 'due_soon' | 'normal' = 'normal';
        if (ratio >= 1.2) urgency = 'overdue';
        else if (ratio >= 0.8) urgency = 'due_soon';

        return {
          id: r.id,
          name: r.preferred_display_name,
          category: r.default_category,
          lastChecked: r.last_checked_at,
          avgDaysBetween: avgDays,
          daysSinceLast: Math.round(daysSince),
          urgency,
          checkedCount: r.total_checked_count,
        };
      }).filter(i => i.urgency !== 'normal'),
    };
  });

  // Shopping stats summary
  app.get('/shopping/stats/summary', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const [totalLists, totalItems, totalChecked, categoryStats, topItems] = await Promise.all([
      app.pg.query(
        `SELECT count(DISTINCT sl.id) FROM shopping_lists sl
         LEFT JOIN shopping_list_members slm ON slm.list_id = sl.id
         WHERE (sl.owner_user_id = $1 OR slm.user_id = $1) AND sl.archived = false`, [userId]),
      app.pg.query('SELECT count(*) FROM shopping_item_memory WHERE user_id = $1', [userId]),
      app.pg.query('SELECT COALESCE(SUM(total_checked_count), 0) AS total FROM shopping_item_memory WHERE user_id = $1', [userId]),
      app.pg.query(
        `SELECT default_category AS category, count(*) AS count, SUM(total_checked_count) AS checked
         FROM shopping_item_memory WHERE user_id = $1 AND default_category IS NOT NULL
         GROUP BY default_category ORDER BY checked DESC`, [userId]),
      app.pg.query(
        `SELECT preferred_display_name AS name, total_checked_count AS count
         FROM shopping_item_memory WHERE user_id = $1
         ORDER BY total_checked_count DESC LIMIT 10`, [userId]),
    ]);

    return {
      totalActiveLists: parseInt(totalLists.rows[0].count, 10),
      totalUniqueItems: parseInt(totalItems.rows[0].count, 10),
      totalPurchases: parseInt(totalChecked.rows[0].total, 10),
      categoryBreakdown: categoryStats.rows.map(r => ({
        category: r.category,
        uniqueItems: parseInt(r.count, 10),
        totalPurchases: parseInt(r.checked, 10),
      })),
      topItems: topItems.rows.map(r => ({
        name: r.name,
        purchaseCount: r.count,
      })),
    };
  });

  // Autocomplete / quick add from memory
  app.get('/shopping/memory/search', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;
    const { q } = request.query as { q?: string };
    if (!q || q.length < 1) return { items: [] };

    const result = await app.pg.query(
      `SELECT id, preferred_display_name, default_category, default_unit, total_checked_count
       FROM shopping_item_memory WHERE user_id = $1 AND normalized_name LIKE $2
       ORDER BY total_checked_count DESC LIMIT 10`,
      [userId, `%${normalizeItemName(q)}%`],
    );

    return {
      items: result.rows.map(r => ({
        id: r.id,
        name: r.preferred_display_name,
        category: r.default_category,
        unit: r.default_unit,
        purchaseCount: r.total_checked_count,
      })),
    };
  });

  // ========================
  // ALEXA INTEGRATION (single-user, scalable)
  // ========================
  // Auth via shared secret in `apiKey` body field or `x-api-key` header.
  // Configured via env: ALEXA_API_KEY, ALEXA_USER_ID, ALEXA_DEFAULT_LIST_ID.
  // No JWT here because Alexa skill calls server-to-server with the secret.
  const ALEXA_API_KEY = process.env.ALEXA_API_KEY || '';
  const ALEXA_USER_ID = process.env.ALEXA_USER_ID || '';
  const ALEXA_DEFAULT_LIST_ID = process.env.ALEXA_DEFAULT_LIST_ID || '';

  const alexaAddItemSchema = z.object({
    item: z.string().min(1).max(500),
    listId: z.string().uuid().optional(),
    apiKey: z.string().optional(),
  });

  app.post('/alexa/add-item', async (request, reply) => {
    if (!ALEXA_API_KEY || !ALEXA_USER_ID || !ALEXA_DEFAULT_LIST_ID) {
      throw new ForbiddenError('Alexa integration not configured');
    }
    const body = alexaAddItemSchema.safeParse(request.body);
    if (!body.success) throw new BadRequestError('Invalid request');
    const { item, listId, apiKey } = body.data;
    const headerKey = request.headers['x-api-key'];
    const providedKey = apiKey || (typeof headerKey === 'string' ? headerKey : '');
    if (providedKey !== ALEXA_API_KEY) {
      throw new ForbiddenError('Invalid API key');
    }
    const userId = ALEXA_USER_ID;
    const targetListId = listId || ALEXA_DEFAULT_LIST_ID;

    const listCheck = await app.pg.query(
      'SELECT id FROM shopping_lists WHERE id = $1 AND owner_user_id = $2',
      [targetListId, userId],
    );
    if (listCheck.rows.length === 0) throw new NotFoundError('List not found');

    const normalized = normalizeItemName(item);
    const memResult = await app.pg.query(
      `INSERT INTO shopping_item_memory (user_id, normalized_name, preferred_display_name, total_added_count, last_added_at)
       VALUES ($1, $2, $3, 1, now())
       ON CONFLICT (user_id, normalized_name) DO UPDATE SET
         total_added_count = shopping_item_memory.total_added_count + 1,
         last_added_at = now(),
         preferred_display_name = COALESCE(EXCLUDED.preferred_display_name, shopping_item_memory.preferred_display_name)
       RETURNING id`,
      [userId, normalized, item],
    );
    const memoryId = memResult.rows[0].id;

    const sortBounds = await app.pg.query(
      'SELECT COALESCE(MIN(sort_order), 0) AS min_sort FROM shopping_list_items WHERE list_id = $1',
      [targetListId],
    );
    const newSort = sortBounds.rows[0].min_sort - 1;

    const result = await app.pg.query(
      `INSERT INTO shopping_list_items (list_id, item_memory_id, display_name, normalized_name, created_by_user_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, display_name, created_at`,
      [targetListId, memoryId, item, normalized, userId, newSort],
    );

    await app.pg.query(
      `INSERT INTO shopping_item_events (item_id, list_id, item_memory_id, event_type, actor_user_id, item_name)
       VALUES ($1, $2, $3, 'added', $4, $5)`,
      [result.rows[0].id, targetListId, memoryId, userId, item],
    );
    await app.pg.query('UPDATE shopping_lists SET updated_at = now() WHERE id = $1', [targetListId]);

    return reply.status(201).send({
      ok: true,
      item: {
        id: result.rows[0].id,
        displayName: result.rows[0].display_name,
        createdAt: result.rows[0].created_at,
      },
    });
  });
}

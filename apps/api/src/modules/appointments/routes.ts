import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../lib/errors.js';

const appointmentStatusEnum = z.enum(['scheduled', 'cancelled', 'completed']);

const createAppointmentSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  location: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  status: appointmentStatusEnum.default('scheduled'),
  color: z.string().max(30).optional(),
  linkedTaskId: z.string().uuid().optional(),
});

const updateAppointmentSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional().nullable(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional().nullable(),
  location: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  status: appointmentStatusEnum.optional(),
  color: z.string().max(30).optional().nullable(),
  linkedTaskId: z.string().uuid().optional().nullable(),
});

const listQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  workspaceId: z.string().uuid().optional(),
  status: appointmentStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

function formatAppointment(row: any) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    notes: row.notes,
    status: row.status,
    color: row.color,
    linkedTaskId: row.linked_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default async function appointmentRoutes(app: FastifyInstance) {
  // List appointments
  app.get('/appointments', { preHandler: [app.authenticate] }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const userId = request.user.sub;
    const conditions: string[] = ['a.owner_user_id = $1'];
    const params: any[] = [userId];
    let idx = 2;

    if (query.workspaceId) {
      conditions.push(`a.workspace_id = $${idx++}`);
      params.push(query.workspaceId);
    }

    if (query.status) {
      conditions.push(`a.status = $${idx++}`);
      params.push(query.status);
    }

    // Date filter: exact day
    if (query.date) {
      conditions.push(`a.starts_at::date = $${idx++}`);
      params.push(query.date);
    }

    // Range filter
    if (query.start) {
      conditions.push(`a.starts_at >= $${idx++}`);
      params.push(query.start);
    }
    if (query.end) {
      conditions.push(`a.starts_at < $${idx++}`);
      params.push(query.end);
    }

    const where = conditions.join(' AND ');
    const offset = (query.page - 1) * query.pageSize;

    const countResult = await app.pg.query(
      `SELECT count(*) FROM appointments a WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await app.pg.query(
      `SELECT a.* FROM appointments a
       WHERE ${where}
       ORDER BY a.starts_at ASC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, query.pageSize, offset],
    );

    return {
      items: result.rows.map(formatAppointment),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  });

  // Create appointment
  app.post('/appointments', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createAppointmentSchema.parse(request.body);
    const userId = request.user.sub;

    // If workspace-scoped, verify membership
    if (body.workspaceId) {
      const mem = await app.pg.query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [body.workspaceId, userId],
      );
      if (mem.rows.length === 0) throw new ForbiddenError();
    }

    // Validate ends_at >= starts_at
    if (body.endsAt && new Date(body.endsAt) < new Date(body.startsAt)) {
      throw new BadRequestError('End time must not be before start time');
    }

    const result = await app.pg.query(
      `INSERT INTO appointments
        (workspace_id, owner_user_id, title, description, starts_at, ends_at, location, notes, status, color, linked_task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        body.workspaceId || null, userId, body.title, body.description || null,
        body.startsAt, body.endsAt || null, body.location || null,
        body.notes || null, body.status, body.color || null, body.linkedTaskId || null,
      ],
    );

    return reply.status(201).send(formatAppointment(result.rows[0]));
  });

  // Get single appointment
  app.get('/appointments/:appointmentId', { preHandler: [app.authenticate] }, async (request) => {
    const { appointmentId } = request.params as { appointmentId: string };
    const userId = request.user.sub;

    const result = await app.pg.query('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
    if (result.rows.length === 0) throw new NotFoundError('Appointment not found');

    const appt = result.rows[0];
    if (appt.owner_user_id !== userId) throw new ForbiddenError();

    return formatAppointment(appt);
  });

  // Update appointment
  app.patch('/appointments/:appointmentId', { preHandler: [app.authenticate] }, async (request) => {
    const { appointmentId } = request.params as { appointmentId: string };
    const body = updateAppointmentSchema.parse(request.body);
    const userId = request.user.sub;

    const existing = await app.pg.query('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
    if (existing.rows.length === 0) throw new NotFoundError('Appointment not found');
    if (existing.rows[0].owner_user_id !== userId) throw new ForbiddenError();

    const row = existing.rows[0];
    const newStartsAt = body.startsAt ?? row.starts_at;
    const newEndsAt = body.endsAt !== undefined ? body.endsAt : row.ends_at;

    if (newEndsAt && new Date(newEndsAt) < new Date(newStartsAt)) {
      throw new BadRequestError('End time must not be before start time');
    }

    const result = await app.pg.query(
      `UPDATE appointments SET
        title = COALESCE($1, title),
        description = CASE WHEN $2::boolean THEN $3 ELSE description END,
        starts_at = COALESCE($4, starts_at),
        ends_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE ends_at END,
        location = CASE WHEN $7::boolean THEN $8 ELSE location END,
        notes = CASE WHEN $9::boolean THEN $10 ELSE notes END,
        status = COALESCE($11, status),
        color = CASE WHEN $12::boolean THEN $13 ELSE color END,
        linked_task_id = CASE WHEN $14::boolean THEN $15::uuid ELSE linked_task_id END
       WHERE id = $16 RETURNING *`,
      [
        body.title ?? null,
        body.description !== undefined, body.description ?? null,
        body.startsAt ?? null,
        body.endsAt !== undefined, body.endsAt ?? null,
        body.location !== undefined, body.location ?? null,
        body.notes !== undefined, body.notes ?? null,
        body.status ?? null,
        body.color !== undefined, body.color ?? null,
        body.linkedTaskId !== undefined, body.linkedTaskId ?? null,
        appointmentId,
      ],
    );

    return formatAppointment(result.rows[0]);
  });

  // Delete appointment
  app.delete('/appointments/:appointmentId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { appointmentId } = request.params as { appointmentId: string };
    const userId = request.user.sub;

    const existing = await app.pg.query('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
    if (existing.rows.length === 0) throw new NotFoundError('Appointment not found');
    if (existing.rows[0].owner_user_id !== userId) throw new ForbiddenError();

    await app.pg.query('DELETE FROM appointments WHERE id = $1', [appointmentId]);
    return reply.status(204).send();
  });
}

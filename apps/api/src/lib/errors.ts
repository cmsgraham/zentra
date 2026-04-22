export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public error: string = 'Error',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message, 'BadRequest');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, message, 'Unauthorized');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'Forbidden');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message, 'NotFound');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'Conflict');
  }
}

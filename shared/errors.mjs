export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT', details) {
    super(message); Object.assign(this, { status, code, details });
  }
}

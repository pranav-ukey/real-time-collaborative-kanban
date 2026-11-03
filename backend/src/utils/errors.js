export class AppError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

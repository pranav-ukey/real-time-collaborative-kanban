import { AppError } from '../utils/errors.js';
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
  if (!result.success) return next(new AppError(400, result.error.issues.map(x => x.message).join('; ')));
  req.validated = result.data;
  next();
};

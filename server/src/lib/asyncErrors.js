/**
 * Express 4 only catches errors thrown synchronously. When an `async`
 * handler rejects (a pg error on a malformed UUID, a TypeError on a body
 * field of the wrong type), the rejection is unhandled and Node exits the
 * whole process. That made a single request, authenticated or not, enough
 * to take the server down (e.g. POST /auth/refresh {"refreshToken":123}).
 *
 * This patches Express's Layer so a rejected promise from any handler or
 * middleware is passed to next(err), where the final error handler in
 * index.js turns it into a JSON 4xx/5xx. Must be imported before any
 * router is created. Express 5 does this natively; remove this file when
 * upgrading.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Layer = require('express/lib/router/layer');

Layer.prototype.handle_request = function handleRequest(req, res, next) {
  const fn = this.handle;
  // Same as Express: four-argument functions are error handlers, skipped here.
  if (fn.length > 3) return next();
  try {
    const result = fn(req, res, next);
    if (result && typeof result.catch === 'function') result.catch(next);
  } catch (err) {
    next(err);
  }
};

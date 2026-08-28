const { z } = require('zod');

/**
 * Body/query/params validation.
 *
 * zod v4 exposes issues on `error.issues` (`error.errors` was the v3 name), so
 * the old handler produced `undefined` details on every failure.
 */
function formatIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: formatIssues(result.error),
    });
  }

  // Query and params are read-only getters on newer Express; assign only where
  // it is safe, and always expose the parsed value on req.validated.
  if (source === 'body') {
    req.body = result.data;
  }
  req.validated = result.data;
  next();
};

module.exports = validate;
module.exports.validate = validate;
module.exports.formatIssues = formatIssues;
module.exports.z = z;

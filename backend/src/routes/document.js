const express = require('express');
const multer = require('multer');

const controller = require('../controllers/document');
const validate = require('../middlewares/validate');
const schemas = require('../schemas');
const { requireAuth, requireRole, requirePasswordChanged } = require('../middlewares/auth');

const router = express.Router();
const ADMIN = schemas.ADMIN_ROLES;

const MAX_FILE_BYTES = Number(process.env.MAX_DOCUMENT_BYTES || 10 * 1024 * 1024);

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * Uploads were previously unbounded and untyped: memoryStorage with no limits
 * accepted a file of any size and any content type straight into process memory.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

// The first-login password change was enforced only by a redirect in the
// SPA, so calling the API directly bypassed it entirely. Every route behind
// auth now refuses until the password has actually been changed; /auth keeps
// its own handling so the change endpoint itself stays reachable.
router.use(requireAuth);
router.use(requirePasswordChanged);

router.get('/', controller.getDocuments);
router.get('/:id/download', controller.getDocumentDownloadUrl);

router.post(
  '/',
  requireRole(ADMIN),
  upload.single('file'),
  validate(schemas.document.upload),
  controller.uploadDocument
);

router.delete('/:id', requireRole(ADMIN), controller.deleteDocument);

module.exports = router;

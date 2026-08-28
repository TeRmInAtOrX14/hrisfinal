const prisma = require('../lib/prisma');
const supabase = require('../config/supabase');
const { logAudit } = require('../utils/audit');
const { resolveEmployeeFilter, canAccessEmployee } = require('../utils/scope');

const BUCKET = 'employee-documents';
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Employee documents.
 *
 * Storage is a private bucket. Uploads previously went to a public bucket and
 * the resulting public URL was stored on the row and rendered straight into the
 * UI, which meant contracts, ID scans and medical records were readable by
 * anyone who ever saw the link, with no authentication at all. We now store the
 * object *path* and mint a short-lived signed URL through an authenticated,
 * RBAC-checked endpoint.
 */

const EMPLOYEE_SELECT = { select: { id: true, fullName: true, employeeCode: true } };

/** Accept the legacy public-URL format so pre-existing rows still resolve. */
function toStoragePath(fileUrl) {
  if (!fileUrl) return null;
  if (!fileUrl.startsWith('http')) return fileUrl;
  const marker = `${BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  return idx === -1 ? null : fileUrl.slice(idx + marker.length);
}

exports.uploadDocument = async (req, res, next) => {
  try {
    const { employeeId, name, type } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'A file is required.' });
    }

    if (!supabase) {
      return res.status(503).json({ error: 'Document storage is not configured on this server.' });
    }

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const safeExt = (file.originalname.split('.').pop() || 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8);
    const storagePath = `${employeeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) {
      return res.status(502).json({ error: `Upload failed: ${error.message}` });
    }

    const doc = await prisma.document.create({
      data: { employeeId, name, type, fileUrl: storagePath, uploadedById: req.user.id },
    });

    await logAudit(req.user.id, 'UPLOAD_DOCUMENT', 'Document', doc.id, { name, type, employeeId });
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
};

exports.getDocuments = async (req, res, next) => {
  try {
    const { employeeId } = req.query;

    const scope = await resolveEmployeeFilter(req.user, employeeId);
    if (!scope.ok) {
      return res.status(scope.status).json({ error: scope.error });
    }

    const where = {};
    if (scope.filter !== undefined) where.employeeId = scope.filter;

    const docs = await prisma.document.findMany({
      where,
      include: { employee: EMPLOYEE_SELECT },
      orderBy: { createdAt: 'desc' },
    });

    // Never hand the raw storage path to the client; it downloads via :id.
    res.json(docs.map(({ fileUrl, ...doc }) => doc));
  } catch (err) {
    next(err);
  }
};

/** Mint a short-lived signed URL for one document, after an access check. */
exports.getDocumentDownloadUrl = async (req, res, next) => {
  try {
    const { id } = req.params;

    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (!(await canAccessEmployee(req.user, doc.employeeId))) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (!supabase) {
      return res.status(503).json({ error: 'Document storage is not configured on this server.' });
    }

    const storagePath = toStoragePath(doc.fileUrl);
    if (!storagePath) {
      return res.status(500).json({ error: 'This document has no readable storage path.' });
    }

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: doc.name });

    if (error) {
      return res.status(502).json({ error: `Could not prepare download: ${error.message}` });
    }

    await logAudit(req.user.id, 'DOWNLOAD_DOCUMENT', 'Document', id, { name: doc.name });
    res.json({ url: data.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    next(err);
  }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const { id } = req.params;

    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Remove the DB row first: an orphaned storage object is recoverable, a row
    // pointing at a deleted object is a broken download for the user.
    await prisma.document.delete({ where: { id } });

    if (supabase) {
      const storagePath = toStoragePath(doc.fileUrl);
      if (storagePath) {
        const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
        if (error) console.error('[Storage Delete Error]:', error.message);
      }
    }

    await logAudit(req.user.id, 'DELETE_DOCUMENT', 'Document', id, { name: doc.name });
    res.json({ message: 'Document deleted successfully' });
  } catch (err) {
    next(err);
  }
};

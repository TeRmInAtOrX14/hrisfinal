const { createClient } = require('@supabase/supabase-js');
const config = require('./env');

/**
 * Supabase Storage client (service role).
 *
 * Buckets are created out-of-band and are PRIVATE. The previous version created
 * them at boot with `{ public: true }`, which made every payslip and every
 * uploaded contract, ID scan and medical record readable by anyone holding the
 * URL, with no authentication. Both buckets are now served through signed URLs
 * or an authenticated streaming endpoint, so this module no longer creates or
 * modifies buckets — it only verifies they exist and warns if they do not.
 */

let supabase = null;

if (config.supabase.url && config.supabase.serviceKey) {
  supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  (async () => {
    for (const bucket of ['payslips', 'employee-documents']) {
      try {
        const { data, error } = await supabase.storage.getBucket(bucket);
        if (error) {
          console.warn(
            `[Supabase] Bucket "${bucket}" is not reachable (${error.message}). ` +
              'Create it as a PRIVATE bucket before uploading.'
          );
        } else if (data?.public) {
          console.warn(
            `[Supabase] SECURITY: bucket "${bucket}" is PUBLIC. ` +
              'It holds payroll and HR documents and should be private.'
          );
        }
      } catch (err) {
        console.warn(`[Supabase] Could not verify bucket "${bucket}":`, err.message);
      }
    }
  })();
} else {
  console.warn(
    '[Supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY not set. ' +
      'Payslip archival and document uploads are disabled.'
  );
}

module.exports = supabase;

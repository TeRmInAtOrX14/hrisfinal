import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Loader2, Filter } from 'lucide-react';
import toast from 'react-hot-toast';

import api, { apiError } from '../utils/api';
import { dateTime } from '../utils/format';

/**
 * Audit trail.
 *
 * `details` is a Json column and now arrives as a real object. The old page
 * called `JSON.parse(log.details)` on it — which only worked because logAudit
 * double-encoded the value on write, and threw (taking the whole page down with
 * it, since there is no error boundary) for any row written any other way.
 */
function Details({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-brand-text-mute">—</span>;
  }

  let text;
  try {
    // Tolerate legacy rows that hold a JSON string rather than an object.
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    text = JSON.stringify(parsed, null, 2);
  } catch {
    text = String(value);
  }

  return (
    <details className="group">
      <summary className="cursor-pointer text-[10px] font-bold text-brand-blue hover:underline list-none">
        {text.length > 60 ? 'View details' : text}
      </summary>
      <pre className="mt-2 p-2 rounded-xl bg-brand-bg border border-brand-border font-mono text-[9px] text-brand-text-soft overflow-x-auto max-w-md whitespace-pre-wrap break-all">
        {text}
      </pre>
    </details>
  );
}

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [actionFilter, setActionFilter] = useState('');
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (nextCursor = null, action = '') => {
      const params = new URLSearchParams({ limit: '100' });
      if (nextCursor) params.set('cursor', nextCursor);
      if (action) params.set('action', action);

      const res = await api.get(`/system/audit-logs?${params}`);
      return res.data;
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const [page, actionList] = await Promise.all([
          load(null, actionFilter),
          api.get('/system/audit-actions').then((r) => r.data).catch(() => []),
        ]);
        if (cancelled) return;
        setLogs(page.logs);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setActions(actionList);
      } catch (err) {
        if (!cancelled) toast.error(apiError(err, 'Failed to load the audit trail.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load, actionFilter]);

  const loadMore = async () => {
    try {
      setLoadingMore(true);
      const page = await load(cursor, actionFilter);
      setLogs((prev) => [...prev, ...page.logs]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      toast.error(apiError(err, 'Could not load more entries.'));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="space-y-6 text-left">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase flex items-center gap-2">
            <Shield className="w-5 h-5 text-brand-cyan" />
            System Audit Trail
          </h2>
          <p className="text-xs text-brand-text-soft mt-1">
            Every administrative action, newest first.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Filter className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-text-mute pointer-events-none" />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-brand-border bg-brand-bg-soft text-xs text-brand-text focus:outline-none focus:border-brand-blue cursor-pointer appearance-none"
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
        </div>
      ) : logs.length === 0 ? (
        <div className="p-10 text-center border border-dashed border-brand-border rounded-2xl">
          <p className="text-sm text-brand-text-soft">No audit entries recorded yet.</p>
        </div>
      ) : (
        <>
          <div className="border border-brand-border rounded-2xl bg-brand-bg-soft/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-brand-border bg-brand-bg-elevated/40 text-[9px] uppercase font-extrabold tracking-widest text-brand-text-soft">
                    <th scope="col" className="p-4">Timestamp</th>
                    <th scope="col" className="p-4">User</th>
                    <th scope="col" className="p-4">Action</th>
                    <th scope="col" className="p-4">Resource</th>
                    <th scope="col" className="p-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border text-xs text-brand-text-soft">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-brand-bg-elevated/20 transition-colors">
                      <td className="p-4 font-mono text-brand-text-mute whitespace-nowrap">
                        {dateTime(log.createdAt)}
                      </td>
                      <td className="p-4">
                        {/* A deleted account leaves its audit rows behind with a
                            null user, which is intentional — the trail outlives
                            the account. */}
                        <div className="font-bold text-brand-text">
                          {log.user?.email || 'Deleted user'}
                        </div>
                        <div className="text-[10px] text-brand-text-mute mt-0.5">
                          {log.user?.role || '—'}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="px-2.5 py-0.5 rounded-full text-[8px] font-extrabold bg-brand-blue/10 text-brand-blue border border-brand-blue/25 uppercase tracking-wider font-display whitespace-nowrap">
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-brand-text-soft">{log.entityType}</div>
                        <div className="text-[10px] text-brand-text-mute font-mono mt-0.5 truncate max-w-[12rem]">
                          {log.entityId || '—'}
                        </div>
                      </td>
                      <td className="p-4 max-w-xs">
                        <Details value={log.details} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* The endpoint used to hard-cap at 200 rows with no way to reach
              anything older. */}
          {hasMore && (
            <div className="flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-2.5 rounded-full border border-brand-border text-xs font-bold uppercase tracking-wider text-brand-text-soft hover:text-brand-text hover:border-brand-border-strong transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
              >
                {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Load older entries
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Network, Loader2, ChevronRight, ChevronDown, User } from 'lucide-react';
import toast from 'react-hot-toast';

import api, { apiError } from '../utils/api';

/**
 * Org chart.
 *
 * The README has advertised a "hierarchical org chart built automatically from
 * manager-subordinate relations" since the first commit and the schema has
 * always carried the manager relation, but no screen ever rendered it.
 */

const ROLE_STYLES = {
  Admin: 'text-brand-violet border-brand-violet/25 bg-brand-violet/10',
  CEO: 'text-brand-violet border-brand-violet/25 bg-brand-violet/10',
  COO: 'text-brand-violet border-brand-violet/25 bg-brand-violet/10',
  'Team Lead': 'text-brand-cyan border-brand-cyan/25 bg-brand-cyan/10',
  SDR: 'text-brand-blue border-brand-blue/25 bg-brand-blue/10',
  Employee: 'text-brand-text-soft border-brand-border bg-brand-bg-elevated',
};

function Node({ person, depth }) {
  const [open, setOpen] = useState(depth < 2);
  const hasReports = person.reports.length > 0;

  return (
    <li className="relative">
      <div
        className={`flex items-center gap-3 p-3 rounded-xl border border-brand-border bg-brand-bg-soft/50 transition-colors ${
          hasReports ? 'hover:border-brand-border-strong' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => hasReports && setOpen((o) => !o)}
          disabled={!hasReports}
          aria-label={hasReports ? (open ? 'Collapse' : 'Expand') : undefined}
          className={`p-1 rounded-lg shrink-0 transition-colors ${
            hasReports
              ? 'text-brand-text-soft hover:text-brand-text cursor-pointer'
              : 'text-transparent cursor-default'
          }`}
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="w-9 h-9 rounded-full bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center shrink-0 overflow-hidden">
          {person.photoUrl ? (
            <img src={person.photoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <User className="w-4 h-4 text-brand-blue" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-brand-text truncate">{person.fullName}</span>
            <span className="text-[9px] font-mono text-brand-text-mute">{person.employeeCode}</span>
          </div>
          <p className="text-[11px] text-brand-text-soft truncate mt-0.5">{person.designation}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {person.campaigns.slice(0, 2).map((name) => (
            <span
              key={name}
              className="hidden md:inline px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wide border border-brand-border text-brand-text-soft"
            >
              {name}
            </span>
          ))}
          <span
            className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${
              ROLE_STYLES[person.role] || ROLE_STYLES.Employee
            }`}
          >
            {person.role}
          </span>
          {hasReports && (
            <span className="text-[10px] font-mono text-brand-text-mute tabular-nums">
              {person.reports.length}
            </span>
          )}
        </div>
      </div>

      {hasReports && open && (
        <ul className="mt-2 ml-5 pl-5 border-l border-brand-border space-y-2">
          {person.reports.map((child) => (
            <Node key={child.id} person={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChart() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.get('/employees/org-chart');
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) toast.error(apiError(err, 'Could not load the org chart.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 text-left">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase flex items-center gap-2">
          <Network className="w-5 h-5 text-brand-cyan" />
          Organisation Chart
        </h2>
        <p className="text-xs text-brand-text-soft mt-1">
          Reporting lines, built from each employee&apos;s assigned manager.
        </p>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
        </div>
      ) : !data || data.roots.length === 0 ? (
        <div className="p-10 text-center border border-dashed border-brand-border rounded-2xl">
          <p className="text-sm text-brand-text-soft">No reporting structure yet.</p>
          <p className="text-xs text-brand-text-mute mt-2">
            Set a manager on an employee profile and they will appear here.
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-brand-text-mute font-mono">
            {data.total} active {data.total === 1 ? 'employee' : 'employees'} · {data.roots.length} top-level
          </p>
          <div className="p-5 rounded-2xl glass-panel border border-brand-border/40">
            <ul className="space-y-2">
              {data.roots.map((person) => (
                <Node key={person.id} person={person} depth={0} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

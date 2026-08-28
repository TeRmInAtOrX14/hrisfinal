import React from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

/**
 * A real 404.
 *
 * The catch-all route used to redirect every unknown path straight to
 * /dashboard, which silently swallowed typos and broken links.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-4 relative overflow-hidden">
      <div className="glow-field opacity-40">
        <span className="g1" />
        <span className="g2" />
      </div>

      <div className="relative z-10 text-center max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-brand-blue/10 border border-brand-blue/25 flex items-center justify-center mx-auto mb-5">
          <Compass className="w-7 h-7 text-brand-blue" />
        </div>
        <p className="text-5xl font-extrabold font-display brandigade-gradient-text">404</p>
        <h1 className="text-lg font-extrabold text-brand-text font-display uppercase tracking-tight mt-3">
          Page not found
        </h1>
        <p className="text-xs text-brand-text-soft mt-2 leading-relaxed">
          That page does not exist, or you may not have access to it.
        </p>
        <Link
          to="/dashboard"
          className="inline-block mt-6 px-6 py-2.5 rounded-full brandigade-gradient text-white font-bold font-display text-xs uppercase tracking-wider hover:scale-[1.02] transition-transform shadow-lg shadow-brand-blue/25"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

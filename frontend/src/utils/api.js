import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:4000/api`;

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

export const session = {
  get accessToken() {
    return localStorage.getItem('accessToken');
  },
  get refreshToken() {
    return localStorage.getItem('refreshToken');
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem('user')) || null;
    } catch {
      // A corrupted blob used to throw on every page that read it.
      return null;
    }
  },
  save({ accessToken, refreshToken, user }) {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
  },
  setUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
  },
  clear() {
    // Targeted removal: logout used to call localStorage.clear(), which also
    // wiped the user's saved theme so the app snapped back to dark every time.
    ['accessToken', 'refreshToken', 'user'].forEach((k) => localStorage.removeItem(k));
  },
};

api.interceptors.request.use((config) => {
  const token = session.accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Single-flight refresh.
 *
 * Every page fires several requests at once. When the access token expired, each
 * 401 previously started its own refresh call; because the server rotates the
 * refresh token on every use, the first call invalidated the token the others
 * were still holding, and the user was logged out at random. All concurrent 401s
 * now await one shared refresh promise.
 */
let refreshPromise = null;

function logout(reason) {
  session.clear();
  if (!window.location.pathname.startsWith('/login')) {
    const target = reason ? `/login?reason=${encodeURIComponent(reason)}` : '/login';
    window.location.replace(target);
  }
}

async function refreshAccessToken() {
  const refreshToken = session.refreshToken;
  if (!refreshToken) throw new Error('No refresh token available');

  // Bare axios so this call cannot re-enter the interceptor.
  const { data } = await axios.post(`${API_URL}/auth/refresh`, { token: refreshToken });
  session.save(data);
  return data.accessToken;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // Never try to refresh the refresh call itself, or the login request.
    const isAuthCall = original?.url?.includes('/auth/refresh') || original?.url?.includes('/auth/login');

    if (status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;

      try {
        refreshPromise = refreshPromise || refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const token = await refreshPromise;
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        logout('session-expired');
        return Promise.reject(error);
      }
    }

    // The API tells us when a first-login password must be changed.
    if (status === 403 && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      const user = session.user;
      if (user) session.setUser({ ...user, mustChangePassword: true });
    }

    return Promise.reject(error);
  }
);

/** Human-readable message from an axios error, for toasts. */
export function apiError(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data;
  if (!data) {
    return error?.code === 'ERR_NETWORK'
      ? 'Cannot reach the server. Check your connection.'
      : fallback;
  }
  if (Array.isArray(data.details) && data.details.length > 0) {
    return data.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('\n');
  }
  return data.error || fallback;
}

/**
 * Download a file from an authenticated endpoint.
 *
 * Payslips used to be opened as `?token=<JWT>` in a new tab, which put a live
 * access token into browser history, the server's access log and any referrer.
 * The token now travels in the Authorization header and the response is turned
 * into a blob URL.
 */
export async function openAuthedFile(endpoint, { filename } = {}) {
  const { data } = await api.get(endpoint, { responseType: 'blob' });
  const url = URL.createObjectURL(data);

  if (filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Give the tab time to load before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export { logout };
export default api;

import { create } from 'zustand';

const KEY = 'cryptoinsight.token';

// Storage can be unavailable (private mode, blocked site data): fall back to an in-memory session.
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

interface AuthState {
  token: string | null;
  setToken: (token: string | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: read(),
  setToken: (token) => {
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    set({ token });
  },
}));

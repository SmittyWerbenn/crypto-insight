import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { Button, Card, CardBody, Field, Input } from '@/components/ui/primitives';
import { api, ApiError } from '@/services/api';
import { useAuth } from '@/stores/auth';

export default function Login() {
  const qc = useQueryClient();
  const setToken = useAuth((s) => s.setToken);
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: (pw: string) => api<{ token: string; expiresAt: string }>('/api/auth/login', { method: 'POST', json: { password: pw } }),
    onSuccess: ({ token }) => {
      qc.clear();
      setToken(token);
    },
  });
  const error = login.error instanceof ApiError ? (login.error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : login.error.message) : login.error ? 'Could not reach the server.' : null;

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardBody className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Lock className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-semibold text-ink">CryptoInsight</h1>
              <p className="text-xs text-ink-3">Enter the password to continue</p>
            </div>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) login.mutate(password);
            }}
          >
            <Field label="Password">
              <Input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="text-xs font-medium text-down">{error}</p>}
            <Button type="submit" className="w-full" loading={login.isPending} disabled={!password || login.isPending}>
              Log in
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

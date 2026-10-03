import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function LoginPage() {
  const { user, loading, error, loginWithGoogle } = useAuth();

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>SevaRath Admin</CardTitle>
          <p className="text-sm text-slate-500">Sign in with your organization Google account.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={loginWithGoogle} disabled={loading}>
            Sign in with Google
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

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
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>SevaRath Admin</CardTitle>
          <p className="text-sm text-muted-foreground">Sign in with your organization Google account.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={loginWithGoogle} disabled={loading}>
            Sign in with Google
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

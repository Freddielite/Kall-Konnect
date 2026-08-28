import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

interface AuthorizationDetails {
  client: { name: string };
  scope: string;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const { session, loading: sessionLoading } = useAuth();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionLoading) return;
    if (!authorizationId) { setError("Missing authorization_id"); return; }

    if (!session) {
      const next = window.location.pathname + window.location.search;
      window.location.href = "/auth?next=" + encodeURIComponent(next);
      return;
    }

    let active = true;
    (async () => {
      try {
        const data = await api.get<AuthorizationDetails>(
          `/oauth/authorize/details?authorization_id=${encodeURIComponent(authorizationId)}`
        );
        if (active) setDetails(data);
      } catch (err: unknown) {
        if (active) setError(errorMessage(err));
      }
    })();
    return () => { active = false; };
  }, [authorizationId, session, sessionLoading]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const data = await api.post<{ redirect_url: string }>(
        approve ? "/oauth/authorize/approve" : "/oauth/authorize/deny",
        { authorization_id: authorizationId }
      );
      window.location.href = data.redirect_url;
    } catch (err: unknown) {
      setBusy(false);
      setError(errorMessage(err));
    }
  }

  return (
    <div className="min-h-screen pt-safe flex items-center justify-center gradient-soft p-4">
      <Card className="w-full max-w-md p-8 shadow-soft border-2">
        {error ? (
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-foreground">Authorization failed</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : !details ? (
          <p className="text-muted-foreground animate-pulse text-center">Loading…</p>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <h1 className="text-xl font-bold text-foreground">
                Connect {details.client?.name ?? "an app"} to your account
              </h1>
              <p className="text-sm text-muted-foreground">
                This lets {details.client?.name ?? "the client"} read and update your contacts and
                call notes as you.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 rounded-full"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Deny
              </Button>
              <Button className="flex-1 rounded-full" disabled={busy} onClick={() => decide(true)}>
                Approve
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

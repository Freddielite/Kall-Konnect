import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import Dashboard from "./pages/Dashboard";
import Contacts from "./pages/Contacts";
import Stats from "./pages/Stats";
import Settings from "./pages/Settings";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";

import { BottomNav } from "./components/BottomNav";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SplashScreen } from "./components/SplashScreen";
import { safeNext } from "./lib/next-redirect";

/**
 * Cached data is what makes tab switches instant. The defaults below are
 * tuned for this app specifically:
 *
 * staleTime — how long fetched data is reused without a background refetch.
 *   Five minutes is safe here because the server pushes a WebSocket ping on
 *   every change and useContacts invalidates on it, so edits show up
 *   immediately regardless. Without that push this would need to be much
 *   shorter.
 * gcTime — how long an unused entry survives before being dropped. Longer
 *   than staleTime so navigating away and back reuses the data instead of
 *   refetching from scratch.
 * retry — one retry, not the default three. The API client already waits up
 *   to 60s for a sleeping Render instance, so three retries could leave a
 *   spinner up for minutes before showing the user an error.
 * refetchOnWindowFocus — returning to the app is exactly when data is most
 *   likely to have gone stale, and this refetches in the background without
 *   clearing what's on screen.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function AppRoutes() {
  const { session, loading } = useAuth();

  // Keep the splash on screen for a minimum stretch so it's actually seen,
  // then fade it out before swapping in the real app.
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [showApp, setShowApp] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), 2200);
    return () => clearTimeout(timer);
  }, []);

  const readyToLeave = !loading && minTimeElapsed;

  useEffect(() => {
    if (readyToLeave) {
      const timer = setTimeout(() => setShowApp(true), 500);
      return () => clearTimeout(timer);
    }
  }, [readyToLeave]);

  if (!showApp) {
    return <SplashScreen fadeOut={readyToLeave} />;
  }

  return (
    <BrowserRouter>
      <AnimatedRoutes session={session} />
    </BrowserRouter>
  );
}

// Split out so useLocation() has a Router ancestor to read from - AppRoutes
// itself renders the BrowserRouter, so it can't call the hook.
function AnimatedRoutes({ session }: { session: unknown }) {
  const location = useLocation();

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          <Route
            path="/auth"
            element={session ? <Navigate to={safeNext(window.location.search)} replace /> : <Auth />}
          />

          <Route path="/oauth/consent" element={<OAuthConsent />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/contacts"
            element={
              <ProtectedRoute>
                <Contacts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stats"
            element={
              <ProtectedRoute>
                <Stats />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AnimatePresence>
      {session && <BottomNav />}
    </>
  );
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <AppRoutes />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;

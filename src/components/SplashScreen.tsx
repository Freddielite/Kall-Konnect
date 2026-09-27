import { useEffect, useState } from 'react';

interface SplashScreenProps {
  /** When true, plays a fade-out transition (used right before handing off
   * to whatever screen comes next: the app, the login page, etc). */
  fadeOut?: boolean;
}

const SPLASH_TEXT = 'kall konnect';
// Finishes typing in ~540ms (12 chars * 45ms) - comfortably inside the
// shortest fadeOut delay any caller uses (Auth.tsx starts fading at 700ms),
// so the cursor is left blinking on the finished word rather than getting
// cut off mid-type.
const TYPE_INTERVAL_MS = 45;

/**
 * Reused in three places: the initial app load (App.tsx), the sign-out
 * transition (Settings.tsx), and the post-login transition (Auth.tsx).
 * Each caller controls its own timing and passes `fadeOut` once it's ready
 * to move on.
 *
 * Shows the animated logo (public/splash.svg) - two figures on a call,
 * blinking, taking turns talking, with an alternating chat bubble; the SVG
 * carries its own looping animation, this component only handles mount/
 * fade for it - plus a typewriter reveal of "kall konnect" underneath, in
 * a gradient text style with a blinking cursor.
 */
export function SplashScreen({ fadeOut = false }: SplashScreenProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
    const interval = setInterval(() => {
      setVisibleCount((count) => {
        if (count >= SPLASH_TEXT.length) {
          clearInterval(interval);
          return count;
        }
        return count + 1;
      });
    }, TYPE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 overflow-hidden bg-background transition-opacity duration-500 ease-out ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <img
        src="/splash.svg"
        alt="Kall Konnect"
        className="h-56 w-56 sm:h-64 sm:w-64"
      />
      <p className="flex items-baseline text-2xl font-bold tracking-tight sm:text-3xl" aria-label="Kall Konnect">
        <span
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage: 'linear-gradient(90deg, #ff8a3d 0%, #ff5a7a 35%, #b45cf0 70%, #5a7dff 100%)',
          }}
        >
          {SPLASH_TEXT.slice(0, visibleCount)}
        </span>
        <span
          className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-[#5a7dff]"
          aria-hidden="true"
        />
      </p>
    </div>
  );
}

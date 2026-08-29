interface SplashScreenProps {
  /** When true, plays a fade-out transition (used right before handing off
   * to whatever screen comes next: the app, the login page, etc). */
  fadeOut?: boolean;
}

/**
 * Reused in three places: the initial app load (App.tsx), the sign-out
 * transition (Settings.tsx), and the post-login transition (Auth.tsx).
 * Each caller controls its own timing and passes `fadeOut` once it's ready
 * to move on.
 *
 * Shows the animated logo (public/splash.svg): two figures on a call,
 * blinking, taking turns talking, with an alternating chat bubble. The SVG
 * carries its own looping animation, so this component only handles mount/
 * fade — no JS-driven animation here.
 */
export function SplashScreen({ fadeOut = false }: SplashScreenProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-background transition-opacity duration-500 ease-out ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      <img
        src="/splash.svg"
        alt="Kall Konnect"
        className="h-56 w-56 sm:h-64 sm:w-64"
      />
    </div>
  );
}

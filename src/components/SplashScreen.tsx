import { useEffect, useRef, useState } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import logo from "@/assets/logo.png";

const FULL_TEXT = "kall konnect";
const TYPE_SPEED_MS = 90;

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
 * The logo plays a one-time "lock-in" sequence on mount - it converges in
 * from slightly oversized and blurred with a springy overshoot, and the
 * instant it settles a thin ring flashes outward from behind it (the
 * "connected" beat). After that it settles into a slow, continuous idle
 * breathing pulse for as long as the screen is up. An ambient glow, pulled
 * from the logo's own gradient, breathes in sync behind it so the launch
 * moment reads as one deliberate scene rather than an icon floating on a
 * blank background. Motion is skipped/stilled for reduced-motion users;
 * everything still resolves to its settled end state.
 */
export function SplashScreen({ fadeOut = false }: SplashScreenProps) {
  const [typed, setTyped] = useState("");
  const controls = useAnimationControls();
  const glowControls = useAnimationControls();
  const hasAnimated = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      setTyped(FULL_TEXT);
      return;
    }
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setTyped(FULL_TEXT.slice(0, i));
      if (i >= FULL_TEXT.length) clearInterval(interval);
    }, TYPE_SPEED_MS);
    return () => clearInterval(interval);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (hasAnimated.current) return;
    hasAnimated.current = true;

    if (prefersReducedMotion) {
      controls.set({ scale: 1, opacity: 1, filter: "blur(0px)" });
      glowControls.set({ opacity: 0.55, scale: 1 });
      return;
    }

    (async () => {
      await controls.start({
        scale: 1,
        opacity: 1,
        filter: "blur(0px)",
        transition: { type: "spring", stiffness: 170, damping: 14 },
      });
      controls.start({
        scale: [1, 1.06, 1],
        transition: { duration: 1.8, repeat: Infinity, ease: "easeInOut" },
      });
      glowControls.start({
        opacity: [0.35, 0.6, 0.35],
        scale: [0.94, 1.04, 0.94],
        transition: { duration: 3.6, repeat: Infinity, ease: "easeInOut" },
      });
    })();
  }, [controls, glowControls, prefersReducedMotion]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 overflow-hidden bg-background transition-opacity duration-500 ease-out ${
        fadeOut ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* Ambient glow pulled from the logo's own gradient, so the scene
          feels lit by the mark rather than the mark sitting on a blank
          page. Kept soft and low-opacity to stay inside the app's light,
          cream-and-coral identity rather than fighting it. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute h-[26rem] w-[26rem] rounded-full blur-[80px] sm:h-[32rem] sm:w-[32rem]"
        style={{
          background:
            "radial-gradient(circle, hsl(var(--gradient-warm-start)/0.55) 0%, hsl(var(--gradient-warm-end)/0.4) 45%, transparent 72%)",
        }}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={glowControls}
      />

      <div className="relative flex items-center justify-center">
        {/* One-shot "connection locked" flash, timed to fire the instant
            the logo's entrance spring settles. */}
        {!prefersReducedMotion && (
          <motion.span
            className="absolute h-28 w-28 sm:h-32 sm:w-32 rounded-full border-2 border-primary"
            initial={{ opacity: 0.7, scale: 0.85 }}
            animate={{ opacity: 0, scale: 1.7 }}
            transition={{ delay: 0.6, duration: 0.55, ease: "easeOut" }}
          />
        )}
        <motion.img
          src={logo}
          alt=""
          className="relative h-28 w-28 sm:h-32 sm:w-32 drop-shadow-2xl"
          initial={{ scale: 1.5, opacity: 0, filter: "blur(6px)" }}
          animate={controls}
        />
      </div>

      <p className="min-h-[2.75rem] bg-gradient-to-r from-[#ff8a3d] via-[#f0397a] to-[#8c7eea] bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
        {typed}
        <span
          className={`inline-block w-[3px] h-8 sm:h-10 align-middle ml-1 bg-[#8c7eea] ${
            prefersReducedMotion ? "" : "animate-pulse"
          }`}
        />
      </p>
    </div>
  );
}

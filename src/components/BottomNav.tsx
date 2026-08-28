import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Home, Users, BarChart3, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const navItems = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: Users, label: 'Contacts', path: '/contacts' },
  { icon: BarChart3, label: 'Stats', path: '/stats' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export function BottomNav() {
  const location = useLocation();
  const navRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // Measured off offsetLeft/offsetWidth (relative to the nav itself) rather
  // than getBoundingClientRect (viewport-relative), so the sliding pill
  // can't drift if the page happens to be scrolled between measurements.
  useLayoutEffect(() => {
    function measure() {
      const active = navItems.find((item) => item.path === location.pathname) ?? navItems[0];
      const el = itemRefs.current[active.path];
      if (!el) return;
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    if (navRef.current) ro.observe(navRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [location.pathname]);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-card border-t-2 border-border shadow-lg z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-lg mx-auto px-4">
        <div className="relative flex justify-around items-center h-20" ref={navRef}>
          {indicator && (
            <motion.div
              className="absolute top-2 h-16 rounded-2xl bg-primary/10"
              initial={false}
              animate={{ left: indicator.left, width: indicator.width }}
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            />
          )}
          {navItems.map(({ icon: Icon, label, path }) => {
            const isActive = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                ref={(el) => (itemRefs.current[path] = el)}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 px-4 py-2 min-w-[70px]',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <motion.span
                  animate={{ scale: isActive ? 1.12 : 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                  whileTap={{ scale: 0.88 }}
                >
                  <Icon className="h-6 w-6" />
                </motion.span>
                <span className="text-xs font-medium">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

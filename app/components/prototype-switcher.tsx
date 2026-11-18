// PROTOTYPE — throwaway variant switcher. Hidden in production builds.
import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const VARIANT_COOKIE = "prototype-variant";

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: { key: string; name: string }[];
  current: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );

  function go(step: number) {
    const next = variants[(index + step + variants.length) % variants.length];
    // Cookie keeps the variant across in-app navigation; the URL keeps it shareable.
    document.cookie = `${VARIANT_COOKIE}=${next.key}; path=/; samesite=lax`;
    const params = new URLSearchParams(location.search);
    params.set("variant", next.key);
    navigate(`${location.pathname}?${params}`, { replace: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  const v = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fuchsia-700 px-2 py-1 text-sm font-medium text-white shadow-xl ring-2 ring-white/40">
      <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-white/20">
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-1">
        PROTOTYPE {v.key} ({v.name})
      </span>
      <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-white/20">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { usePrefsStore } from "@/lib/prefs";

/** Apply autoplay prefs to videos marked with data-media-video. */
export function useMediaAutoplay(rootRef?: React.RefObject<HTMLElement | null>) {
  const autoplay = usePrefsStore((s) => s.autoplay);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const root = rootRef?.current ?? document.body;
    const videos = root.querySelectorAll<HTMLVideoElement>("video[data-media-video]");

    const prep = (video: HTMLVideoElement) => {
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      if (autoplay) {
        video.loop = true;
        video.removeAttribute("controls");
      } else {
        video.loop = false;
        video.pause();
        if (video.dataset.forceControls === "1") video.controls = true;
      }
    };

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (autoplay && typeof IntersectionObserver !== "undefined") {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const video = entry.target as HTMLVideoElement;
            prep(video);
            if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
              void video.play().catch(() => {});
            } else {
              video.pause();
            }
          }
        },
        { threshold: [0, 0.45, 0.75], rootMargin: "40px 0px" },
      );
    }

    for (const video of videos) {
      prep(video);
      observerRef.current?.observe(video);
    }

    return () => observerRef.current?.disconnect();
  }, [autoplay, rootRef]);
}

import { useEffect, useRef } from "react";
import { usePrefsStore } from "@/lib/prefs";

function prepVideo(video: HTMLVideoElement, autoplay: boolean) {
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  if (autoplay) {
    video.loop = true;
    video.removeAttribute("controls");
    return;
  }
  video.loop = false;
  video.pause();
  if (video.dataset.forceControls === "1") video.controls = true;
}

/** Apply autoplay prefs to videos marked with data-media-video. */
export function useMediaAutoplay(rootRef?: React.RefObject<HTMLElement | null>) {
  const autoplay = usePrefsStore((s) => s.autoplay);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const root = rootRef?.current ?? document.body;

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (autoplay && typeof IntersectionObserver !== "undefined") {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const video = entry.target as HTMLVideoElement;
            prepVideo(video, true);
            if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
              void video.play().catch(() => {
                video.controls = true;
              });
            } else {
              video.pause();
            }
          }
        },
        { threshold: [0, 0.45, 0.75], rootMargin: "40px 0px" },
      );
    }

    const bind = (video: HTMLVideoElement) => {
      prepVideo(video, autoplay);
      if (autoplay) observerRef.current?.observe(video);
    };

    const scan = (node: ParentNode) => {
      if (node instanceof HTMLVideoElement && node.matches("[data-media-video]")) {
        bind(node);
      }
      if (!(node instanceof Element || node instanceof Document)) return;
      for (const video of node.querySelectorAll<HTMLVideoElement>(
        "video[data-media-video]",
      )) {
        bind(video);
      }
    };

    scan(root);

    // Scraps renders videos after the feed request resolves, and "Load more"
    // adds more later. The preference effect alone runs before those nodes exist.
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) scan(node);
        }
      }
    });
    mutations.observe(root, { childList: true, subtree: true });

    return () => {
      mutations.disconnect();
      observerRef.current?.disconnect();
    };
  }, [autoplay, rootRef]);
}

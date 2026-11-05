"use client";

import { useEffect } from "react";

// Sections rise in once as they scroll into view. Without motion they simply stay visible.
export function Reveal() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined")
      return;
    const root = document.querySelector(".tl");
    if (!root) return;
    root.classList.add("js");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    root.querySelectorAll(".rv, .grow").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return null;
}

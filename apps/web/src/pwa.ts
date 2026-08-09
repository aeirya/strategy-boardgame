if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.warn("PWA service worker registration failed:", error);
    });
  }, { once: true });
}

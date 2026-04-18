export function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

    if (import.meta.env.DEV) {
        navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => {
                const reloadKey = "fit-analyzer-sw-dev-reloaded-v2";
                if (sessionStorage.getItem(reloadKey) === "1") return;

                sessionStorage.setItem(reloadKey, "1");
                window.location.reload();
            },
            { once: true }
        );
    }

    const register = () => {
        navigator.serviceWorker
            .register("/service-worker.js", { scope: "/" })
            .then((registration) => {
                registration.update().catch(() => undefined);
            })
            .catch((error) => {
                console.error("Service worker registration failed:", error);
            });
    };

    if (document.readyState === "complete") {
        register();
    } else {
        window.addEventListener("load", register, { once: true });
    }
}

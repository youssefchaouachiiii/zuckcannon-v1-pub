import { useEffect } from "react";
import useStore from "../store/useStore";

/**
 * Custom hook to protect against accidental navigation during uploads
 *
 * This hook:
 * 1. Prevents browser page unload during uploads
 * 2. Can be used with React Router to prevent route changes
 *
 * Usage:
 * ```jsx
 * function UploadComponent() {
 *   useUploadProtection();
 *   // ... component logic
 * }
 * ```
 */
export function useUploadProtection() {
  const uploadInProgress = useStore((state) => state.uploadInProgress);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (uploadInProgress) {
        e.preventDefault();
        e.returnValue = "Upload in progress. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [uploadInProgress]);

  return uploadInProgress;
}

/**
 * Hook to check if navigation should be blocked
 * Use with React Router's blocker or custom navigation logic
 */
export function useNavigationGuard() {
  const navigationGuard = useStore((state) => state.navigationGuard);
  const uploadInProgress = useStore((state) => state.uploadInProgress);

  return {
    shouldBlock: uploadInProgress,
    checkNavigation: navigationGuard,
  };
}

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiRequestError, UNAUTHENTICATED_EVENT } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            // Never retry auth/validation failures; retry transient ones briefly.
            retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const onUnauthenticated = () => {
      client.clear();
      if (pathname !== "/login") router.replace("/login");
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [client, pathname, router]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

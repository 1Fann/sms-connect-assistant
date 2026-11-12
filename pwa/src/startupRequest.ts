declare global {
  interface Window {
    __commlinkStartup?: {path: string; response: Promise<Response>};
  }
}

export function takeStartupResponse(path: string): Promise<Response> | undefined {
  if (typeof window === 'undefined' || window.__commlinkStartup?.path !== path) return;
  const {response} = window.__commlinkStartup;
  delete window.__commlinkStartup;
  return response;
}

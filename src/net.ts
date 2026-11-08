// fetch that gives up after `ms` milliseconds instead of hanging when the server is unreachable
export async function fetchT(url: string, init?: RequestInit, ms = 3000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

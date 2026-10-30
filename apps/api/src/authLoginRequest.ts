/** Convert the form login to Better Auth JSON without losing ingress IP headers. */
export function authLoginRequest(request: Request, input: {
  mode: "signin" | "signup";
  email: string;
  password: string;
  name: string;
  fallbackOrigin: string;
}): Request {
  const url = new URL(request.url);
  url.pathname = input.mode === "signup" ? "/auth/sign-up/email" : "/auth/sign-in/email";
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.set("origin", request.headers.get("origin") ?? input.fallbackOrigin);
  headers.delete("content-length");
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: input.email, password: input.password, name: input.name }),
    redirect: "manual",
  });
}

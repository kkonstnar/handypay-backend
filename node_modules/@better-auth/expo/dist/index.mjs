import { createAuthMiddleware } from 'better-auth/api';

const expo = (options) => {
  return {
    id: "expo",
    init: (ctx) => {
      const trustedOrigins = process.env.NODE_ENV === "development" ? ["exp://"] : [];
      return {
        options: {
          trustedOrigins
        }
      };
    },
    async onRequest(request, ctx) {
      if (!options?.overrideOrigin || request.headers.get("origin")) {
        return;
      }
      const expoOrigin = request.headers.get("expo-origin");
      if (!expoOrigin) {
        return;
      }
      const req = request.clone();
      req.headers.set("origin", expoOrigin);
      return {
        request: req
      };
    },
    hooks: {
      after: [
        {
          matcher(context) {
            return context.path?.startsWith("/callback") || context.path?.startsWith("/oauth2/callback");
          },
          handler: createAuthMiddleware(async (ctx) => {
            const headers = ctx.context.responseHeaders;
            const location = headers?.get("location");
            if (!location) {
              return;
            }
            const isProxyURL = location.includes("/oauth-proxy-callback");
            if (isProxyURL) {
              return;
            }
            const trustedOrigins = ctx.context.trustedOrigins.filter(
              (origin) => !origin.startsWith("http")
            );
            const isTrustedOrigin = trustedOrigins.some(
              (origin) => location?.startsWith(origin)
            );
            if (!isTrustedOrigin) {
              return;
            }
            const cookie = headers?.get("set-cookie");
            if (!cookie) {
              return;
            }
            const url = new URL(location);
            url.searchParams.set("cookie", cookie);
            ctx.setHeader("location", url.toString());
          })
        }
      ]
    }
  };
};

export { expo };

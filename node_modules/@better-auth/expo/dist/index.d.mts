import * as better_call from 'better-call';
import * as better_auth_types from 'better-auth/types';

interface ExpoOptions {
    /**
     * Override origin header for expo API routes
     */
    overrideOrigin?: boolean;
}
declare const expo: (options?: ExpoOptions) => {
    id: "expo";
    init: (ctx: better_auth_types.AuthContext) => {
        options: {
            trustedOrigins: string[];
        };
    };
    onRequest(request: Request, ctx: better_auth_types.AuthContext): Promise<{
        request: Request;
    } | undefined>;
    hooks: {
        after: {
            matcher(context: better_auth_types.HookEndpointContext): boolean;
            handler: (inputContext: better_call.MiddlewareInputContext<better_call.MiddlewareOptions>) => Promise<void>;
        }[];
    };
};

export { expo };
export type { ExpoOptions };

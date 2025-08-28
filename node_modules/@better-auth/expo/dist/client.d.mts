import * as _better_fetch_fetch from '@better-fetch/fetch';
import { BetterFetchOption } from '@better-fetch/fetch';
import { Store } from 'better-auth/types';

interface CookieAttributes {
    value: string;
    expires?: Date;
    "max-age"?: number;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
}
declare function parseSetCookieHeader(header: string): Map<string, CookieAttributes>;
interface ExpoClientOptions {
    scheme?: string;
    storage: {
        setItem: (key: string, value: string) => any;
        getItem: (key: string) => string | null;
    };
    storagePrefix?: string;
    disableCache?: boolean;
}
declare function getSetCookie(header: string, prevCookie?: string): string;
declare function getCookie(cookie: string): string;
declare const expoClient: (opts: ExpoClientOptions) => {
    id: "expo";
    getActions(_: _better_fetch_fetch.BetterFetch, $store: Store): {
        /**
         * Get the stored cookie.
         *
         * You can use this to get the cookie stored in the device and use it in your fetch
         * requests.
         *
         * @example
         * ```ts
         * const cookie = client.getCookie();
         * fetch("https://api.example.com", {
         * 	headers: {
         * 		cookie,
         * 	},
         * });
         */
        getCookie: () => string;
    };
    fetchPlugins: {
        id: string;
        name: string;
        hooks: {
            onSuccess(context: _better_fetch_fetch.SuccessContext<any>): Promise<void>;
        };
        init(url: string, options: {
            cache?: RequestCache | undefined;
            credentials?: RequestCredentials | undefined;
            headers?: (HeadersInit & (HeadersInit | {
                accept: "application/json" | "text/plain" | "application/octet-stream";
                "content-type": "application/json" | "text/plain" | "application/x-www-form-urlencoded" | "multipart/form-data" | "application/octet-stream";
                authorization: "Bearer" | "Basic";
            })) | undefined;
            integrity?: string | undefined;
            keepalive?: boolean | undefined;
            method?: string | undefined;
            mode?: RequestMode | undefined;
            priority?: RequestPriority | undefined;
            redirect?: RequestRedirect | undefined;
            referrer?: string | undefined;
            referrerPolicy?: ReferrerPolicy | undefined;
            signal?: (AbortSignal | null) | undefined;
            window?: null | undefined;
            onRequest?: (<T extends Record<string, any>>(context: _better_fetch_fetch.RequestContext<T>) => Promise<_better_fetch_fetch.RequestContext | void> | _better_fetch_fetch.RequestContext | void) | undefined;
            onResponse?: ((context: _better_fetch_fetch.ResponseContext) => Promise<Response | void | _better_fetch_fetch.ResponseContext> | Response | _better_fetch_fetch.ResponseContext | void) | undefined;
            onSuccess?: ((context: _better_fetch_fetch.SuccessContext<any>) => Promise<void> | void) | undefined;
            onError?: ((context: _better_fetch_fetch.ErrorContext) => Promise<void> | void) | undefined;
            onRetry?: ((response: _better_fetch_fetch.ResponseContext) => Promise<void> | void) | undefined;
            hookOptions?: {
                cloneResponse?: boolean;
            } | undefined;
            timeout?: number | undefined;
            customFetchImpl?: _better_fetch_fetch.FetchEsque | undefined;
            plugins?: _better_fetch_fetch.BetterFetchPlugin[] | undefined;
            baseURL?: string | undefined;
            throw?: boolean | undefined;
            auth?: ({
                type: "Bearer";
                token: string | Promise<string | undefined> | (() => string | Promise<string | undefined> | undefined) | undefined;
            } | {
                type: "Basic";
                username: string | (() => string | undefined) | undefined;
                password: string | (() => string | undefined) | undefined;
            } | {
                type: "Custom";
                prefix: string | (() => string | undefined) | undefined;
                value: string | (() => string | undefined) | undefined;
            }) | undefined;
            body?: any;
            query?: any;
            params?: any;
            duplex?: "full" | "half" | undefined;
            jsonParser?: ((text: string) => Promise<any> | any) | undefined;
            retry?: _better_fetch_fetch.RetryOptions | undefined;
            retryAttempt?: number | undefined;
            output?: (_better_fetch_fetch.StandardSchemaV1 | typeof Blob | typeof File) | undefined;
            errorSchema?: _better_fetch_fetch.StandardSchemaV1 | undefined;
            disableValidation?: boolean | undefined;
        } | undefined): Promise<{
            url: string;
            options: BetterFetchOption;
        }>;
    }[];
};

export { expoClient, getCookie, getSetCookie, parseSetCookieHeader };

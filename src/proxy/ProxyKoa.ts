import * as http from 'http';
import { ClientRequest, IncomingMessage, ServerResponse } from 'http';
import Koa from 'koa';
import * as url from 'url';
import { FakeServerFactory } from './FakeServerFactory';
import { ProxyServer } from './ProxyServer';

export namespace InterceptMiddleware {
    export interface Options {
        onRequest?(req: IncomingMessage, res: ServerResponse, secure: boolean): void | Promise<void>;

        onResponse?(req: IncomingMessage, res: ServerResponse,
                    proxyReq: ClientRequest, proxyRes: IncomingMessage,
                    secure: boolean): void | Promise<void>;
    }
}

export function InterceptMiddleware(options: InterceptMiddleware.Options = {}): Koa.Middleware {
    return async function interceptor(ctx, next) {
        if (ctx.headers.connection === 'close') {
            ctx.socket.setKeepAlive(false);
        } else {
            ctx.socket.setKeepAlive(true, 30000);
        }

        if (options.onRequest) {
            console.log('onRequest');
            await options.onRequest.call(null, ctx.req, ctx.res, ctx.secure);
        }

        if (ctx.res.finished) {
            return next();
        }

        const [proxyReq, proxyRes] = await ProxyServer.createProxyRequest(ctx.req, ctx.secure);

        if (options.onResponse) {
            console.log('onResponse');
            await options.onResponse.call(null, ctx.req, ctx.res, proxyReq, proxyRes, ctx.secure);
        }

        if (ctx.res.finished) {
            return next();
        }

        if (!ctx.headerSent) {
            ctx.response.set(proxyRes.headers as any);
        }

        ctx.status = proxyRes.statusCode;
        ctx.message = proxyRes.statusMessage;

        proxyRes.pipe(ctx.res);

        return next();
    };
}

export const proxy = new Koa()
    .use((ctx, next) => {
        ctx.respond = false;
        console.log('handled by koa');

        return next();
    })
    .use(InterceptMiddleware());

http
    .createServer(proxy.callback())
    .on('connect', async (req, socket, head) => {
        const urlObject = url.parse(`https://${req.url}`);

        if (/(^|.+\.)gu3\.jp$/.test(urlObject.hostname) || true) {
            const fakeServer = await FakeServerFactory.getServer(urlObject.hostname);

            ProxyServer.createProxyConnection(req, socket, head,
                '127.0.0.1', fakeServer.port);
        } else {
            ProxyServer.createProxyConnection(req, socket, head,
                urlObject.hostname, parseInt(urlObject.port, 10));
        }
    })
    .listen(9001);

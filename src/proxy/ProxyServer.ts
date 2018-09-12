import * as http from 'http';
import { ClientRequest, IncomingMessage, ServerResponse } from 'http';
import * as https from 'https';
import { omit } from 'lodash';
import * as net from 'net';
import { Socket } from 'net';
import * as url from 'url';
import { FakeServerFactory } from './FakeServerFactory';

export class ProxyServer extends http.Server {
    constructor(requestListener?: (req: IncomingMessage, res: ServerResponse) => void) {
        super(requestListener);

        this
            .on('connect', async (req, socket, head) => {
                await this.handleConnect(req, socket, head);
            })
            .on('request', async (req, res) => {
                await this.handleRequest(req, res, false);
            })
            .on('error', (err) => {
                console.error(err);
            });
    }

    protected static createProxyRequest(req: IncomingMessage, isHttps: boolean): Promise<[ClientRequest, IncomingMessage]> {
        return new Promise((resolve, reject) => {
            const urlObject = url.parse(req.url);

            const options = {
                protocol: isHttps ? 'https:' : 'http:',
                host: req.headers.host,
                hostname: req.headers.host.split(':')[0],
                port: req.headers.host.split(':')[1] || (isHttps ? 443 : 80),
                method: req.method,
                path: urlObject.path,
                headers: omit(req.headers, 'proxy-connection', 'accept-encoding'),
            };

            const module: { request(...args: any[]): ClientRequest } = options.protocol === 'https:' ? https : http;
            const proxyReq = module.request(options, (proxyRes) => {
                resolve([proxyReq, proxyRes]);
            });

            proxyReq.on('error', reject);

            req.on('abort', () => {
                proxyReq.abort();
            });

            req.pipe(proxyReq);
        });
    }

    protected static createProxyConnection(req: IncomingMessage, socket: Socket, head: Buffer,
                                           hostname: string, port: number): Socket {
        const proxySocket = net.connect(port, hostname, () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n' +
                '\r\n');

            proxySocket.write(head);

            proxySocket.pipe(socket).pipe(proxySocket);

        });

        proxySocket.on('error', (err) => {
            console.error(err);
        });

        return proxySocket;
    }

    async handleConnect(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
        await this.onConnect(req, socket, head);

        const urlObject = url.parse(`https://${req.url}`);

        if (/(^|.+\.)google\.cn$/.test(urlObject.hostname) || true) {
            const fakeServer = await FakeServerFactory.getServer(urlObject.hostname, parseInt(urlObject.port, 10));

            fakeServer.once('request', async (req, res) => {
                await this.handleRequest(req, res, true);
            });

            ProxyServer.createProxyConnection(req, socket, head,
                '127.0.0.1', fakeServer.port);
        } else {
            ProxyServer.createProxyConnection(req, socket, head,
                urlObject.hostname, parseInt(urlObject.port, 10));
        }
    }

    async handleRequest(req: IncomingMessage, res: ServerResponse, isHttps: boolean): Promise<void> {
        console.log('handleRequest request', req.url);

        if (req.headers.connection === 'close') {
            req.socket.setKeepAlive(false);
        } else {
            req.socket.setKeepAlive(true, 30000);
        }

        await this.onRequest(req, res, isHttps);

        if (res.finished) {
            return;
        }

        const [proxyReq, proxyRes] = await ProxyServer.createProxyRequest(req, isHttps);

        await this.onResponse(req, res, proxyReq, proxyRes, isHttps);

        if (res.finished) {
            return;
        }

        if (res.headersSent) {
            res.writeHead(proxyRes.statusCode);
        } else {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
        }

        proxyRes.pipe(res);
    }

    async onConnect(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
        console.log('onConnect', head.toString('hex'));
    }

    async onRequest(req: IncomingMessage, res: ServerResponse, isHttps: boolean): Promise<void> {
        console.log('onRequest', isHttps);
    }

    async onResponse(req: IncomingMessage, res: ServerResponse,
                     proxyReq: ClientRequest, proxyRes: IncomingMessage,
                     isHttps: boolean): Promise<void> {
        if (typeof proxyRes.headers['content-encoding'] === 'undefined') {
            let content = '';
            proxyRes.on('data', (buf: Buffer) => {
                content += buf.toString('utf8');
            });
            proxyRes.on('end', () => {
                console.log('read response data:', content);
            });
        }
        console.log('onResponse', isHttps);
    }
}

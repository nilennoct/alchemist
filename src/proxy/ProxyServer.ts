import * as http from 'http';
import { ClientRequest, IncomingMessage, ServerResponse } from 'http';
import * as https from 'https';
import { omit } from 'lodash';
import * as net from 'net';
import { Socket } from 'net';
import * as url from 'url';
import * as zlib from 'zlib';
import { FakeServerFactory } from './FakeServerFactory';
import ReadableStream = NodeJS.ReadableStream;

export class ProxyServer extends http.Server {
    protected static httpAgent = new http.Agent({
        keepAlive: true,
        timeout: 60000,
    });

    protected static httpsAgent = new https.Agent({
        keepAlive: true,
        timeout: 6000,
        rejectUnauthorized: false,
    });

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

    protected static getRequestOptions(req: IncomingMessage, isHttps: boolean): http.RequestOptions | https.RequestOptions {
        const urlObject = url.parse(req.url);

        const options: http.RequestOptions | https.RequestOptions = {
            protocol: isHttps ? 'https:' : 'http:',
            host: req.headers.host,
            hostname: req.headers.host.split(':')[0],
            port: req.headers.host.split(':')[1] || (isHttps ? 443 : 80),
            method: req.method,
            path: urlObject.path,
            headers: omit(req.headers, 'proxy-connection'),
        };

        if (options.headers.connection !== 'close') {
            if (isHttps) {
                options.agent = this.httpsAgent;
            } else {
                options.agent = this.httpAgent;
            }

            options.headers.connection = 'keep-alive';
        }

        return options;
    }

    static createProxyRequest(req: IncomingMessage, isHttps: boolean): Promise<[ClientRequest, IncomingMessage]> {
        return new Promise((resolve, reject) => {
            const options = this.getRequestOptions(req, isHttps);
            const module: { request(...args: any[]): ClientRequest } = isHttps ? https : http;
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

    static createProxyConnection(req: IncomingMessage, socket: Socket, head: Buffer,
                                 hostname: string, port: number): Socket {
        const proxySocket = net.connect(port, hostname, () => {
            socket.write('HTTP/1.0 200 Connection Established\r\n' +
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

        if (/(^|.+\.)gu3\.jp$/.test(urlObject.hostname)) {
            const fakeServer = await FakeServerFactory.getServer(urlObject.hostname);

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
    }

    async onRequest(req: IncomingMessage, res: ServerResponse, isHttps: boolean): Promise<void> {
    }

    async onResponse(req: IncomingMessage, res: ServerResponse,
                     proxyReq: ClientRequest, proxyRes: IncomingMessage,
                     isHttps: boolean): Promise<void> {
        console.log('onResponse', isHttps);
        const encoding = proxyRes.headers['content-encoding'];
        switch (encoding) {
            case 'gzip':
                getStringFromStream(proxyRes.pipe(zlib.createGunzip())).then(console.log);
                break;

            case 'deflate':
                getStringFromStream(proxyRes.pipe(zlib.createInflate())).then(console.log);
                break;

            case undefined:
                getStringFromStream(proxyRes).then(console.log);
                break;

            default:
                console.warn('Unsupported encoding:', encoding);
                break;
        }
    }
}

function getStringFromStream(stream: ReadableStream): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let content = '';

        stream
            .on('data', (buf: Buffer) => {
                content += buf.toString('utf8');
            })
            .on('error', reject)
            .on('end', () => {
                resolve(content);
            });
    });
}
import { EventEmitter } from 'events';
import * as https from 'https';
import { pki } from 'node-forge';
import * as tls from 'tls';
import { CertificateManager } from '../tls/CertificateManager';

export class FakeServer extends EventEmitter {
    port: number = 0;
    protected server: https.Server;

    constructor(readonly commonName: string) {
        super();
    }

    async run(): Promise<FakeServer> {
        const { key, cert } = await CertificateManager.getKeyCertificatePair(this.commonName);

        this.server = https.createServer({
            key: pki.privateKeyToPem(key),
            cert: pki.certificateToPem(cert),
            SNICallback: async (domain, callback) => {
                const pair = await CertificateManager.getKeyCertificatePairByDomain(domain);

                callback(null, tls.createSecureContext({
                    key: pki.privateKeyToPem(pair.key),
                    cert: pki.certificateToPem(pair.cert),
                }));
            },
        });

        return new Promise<FakeServer>((resolve, reject) => {
            this.server.listen(0, () => {
                const address = this.server.address();

                if (typeof address !== 'string') {
                    this.port = address.port;
                }

                resolve(this);
            });

            this.server.on('error', reject);

            this.server.on('request', this.emit.bind(this, 'request'));
        });
    }
}

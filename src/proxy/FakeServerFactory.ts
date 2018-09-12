import LRU from 'lru-cache';
import { CertificateManager } from '../tls/CertificateManager';
import { FakeServer } from './FakeServer';

export namespace FakeServerFactory {
    const servers = new LRU<string, FakeServer>();

    export async function getServer(hostname: string, port: number): Promise<FakeServer> {
        const commonName = CertificateManager.getCommonNameByDomain(hostname);

        if (servers.has(commonName)) {
            return servers.get(commonName);
        }

        const server = await new FakeServer(commonName).run();

        servers.set(commonName, server);

        return server;
    }
}

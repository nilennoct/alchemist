import { outputFile, readFile } from 'fs-extra';
import LRU from 'lru-cache';
import { pki } from 'node-forge';
import * as path from 'path';
import { generateCA, generateCertificate, KeyCertificatePair } from './ca';

export namespace CertificateManager {
    const CA_CACHE_KEY = 'ca';
    const CA_ROOT = path.resolve('.ca');

    const cache = new LRU<string, KeyCertificatePair>();

    export function getCommonNameByDomain(domain: string): string {
        const parts = domain.split('.');

        if (parts.length <= 2) {
            return domain;
        }

        return ['*'].concat(parts.slice(-2)).join('.');
    }

    export async function getKeyCertificatePair(name: string): Promise<KeyCertificatePair> {
        if (cache.has(name)) {
            return cache.get(name);
        }

        let pair: KeyCertificatePair;

        try {
            pair = await readKeyCertificatePair(name);
        } catch (err) {
            if (name === CA_CACHE_KEY) {
                pair = generateCA('Alchemist CA');
            } else {
                const ca = await getKeyCertificatePair(CA_CACHE_KEY);

                pair = generateCertificate(ca.key, ca.cert, name);
            }
        }

        await writeKeyCertificatePair(name, pair);

        cache.set(name, pair);

        return pair;
    }

    export async function getKeyCertificatePairByDomain(domain: string): Promise<KeyCertificatePair> {
        return getKeyCertificatePair(getCommonNameByDomain(domain));
    }

    async function readKeyCertificatePair(name: string): Promise<KeyCertificatePair> {
        return {
            key: pki.privateKeyFromPem(await readFile(getKeyPath(name), 'utf8')),
            cert: pki.certificateFromPem(await readFile(getCertificatePath(name), 'utf8')),
        };
    }

    async function writeKeyCertificatePair(name: string, pair: KeyCertificatePair): Promise<void> {
        await Promise.all([
            outputFile(getKeyPath(name), pki.privateKeyToPem(pair.key), 'utf8'),
            outputFile(getCertificatePath(name), pki.certificateToPem(pair.cert), 'utf8'),
        ]);
    }

    function getKeyPath(name: string): string {
        return path.join(CA_ROOT, `${name}.private.pem`);
    }

    function getCertificatePath(name: string): string {
        return path.join(CA_ROOT, `${name}.pem`);
    }
}

import { outputFile, readFile } from 'fs-extra';
import LRU from 'lru-cache';
import { md, pki } from 'node-forge';
import * as path from 'path';

export interface KeyCertificatePair {
    key: pki.Key;
    cert: pki.Certificate;
}

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

    function generateCA(commonName: string): KeyCertificatePair {
        const keys = pki.rsa.generateKeyPair(2048);
        const cert = pki.createCertificate();

        cert.publicKey = keys.publicKey;

        const date = new Date();
        cert.serialNumber = String(date.getTime());
        cert.validity.notBefore = date;
        cert.validity.notAfter = new Date(date);
        cert.validity.notAfter.setFullYear(date.getFullYear() + 10);

        const attributes = getCertificateAttributes(commonName);
        cert.setIssuer(attributes);
        cert.setSubject(attributes);

        cert.setExtensions([
            {
                name: 'basicConstraints',
                critical: true,
                cA: true,
            },
            {
                name: 'keyUsage',
                critical: true,
                keyCertSign: true,
            },
            {
                name: 'subjectKeyIdentifier',
            },
        ]);

        cert.sign(keys.privateKey, md.sha256.create());

        return {
            key: keys.privateKey,
            cert,
        };
    }

    function generateCertificate(caKey: pki.Key, caCert: pki.Certificate, commonName: string): KeyCertificatePair {
        const keys = pki.rsa.generateKeyPair(2048);
        const cert = pki.createCertificate();

        cert.publicKey = keys.publicKey;

        const date = new Date();
        cert.serialNumber = String(date.getTime());
        cert.validity.notBefore = date;
        cert.validity.notAfter = new Date(date);
        cert.validity.notAfter.setFullYear(date.getFullYear() + 1);

        cert.setIssuer(caCert.issuer.attributes);
        cert.setSubject(getCertificateAttributes(commonName));

        cert.setExtensions([
            {
                name: 'basicConstraints',
                critical: true,
                cA: false,
            },
            {
                name: 'keyUsage',
                critical: true,
                keyCertSign: true,
            },
            {
                name: 'extKeyUsage',
                serverAuth: true,
            },
            {
                name: 'subjectAltName',
                altNames: [
                    {
                        type: 2,
                        value: commonName,
                    },
                ],
            },
            {
                name: 'subjectKeyIdentifier',
            },
            {
                name: 'authorityKeyIdentifier',
            },
        ]);

        cert.sign(caKey, md.sha256.create());

        return {
            key: keys.privateKey,
            cert,
        };
    }

    function getCertificateAttributes(commonName: string): pki.CertificateField[] {
        return [
            {
                name: 'commonName',
                value: commonName,
            },
            {
                name: 'countryName',
                value: 'CN',
            },
            {
                shortName: 'ST',
                value: 'ZJ',
            },
            {
                name: 'localityName',
                value: 'HZ',
            },
            {
                name: 'organizationName',
                value: 'Alchemist',
            },
            {
                shortName: 'OU',
                value: 'https://github.com/nilennoct/alchemist',
            },
        ];
    }
}

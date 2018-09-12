import { md, pki } from 'node-forge';

export interface KeyCertificatePair {
    key: pki.Key;
    cert: pki.Certificate;
}

export function generateCA(commonName: string): KeyCertificatePair {
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

export function generateCertificate(caKey: pki.Key, caCert: pki.Certificate, commonName: string): KeyCertificatePair {
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
            value: 'Zhejiang',
        },
        {
            name: 'localityName',
            value: 'Hangzhou',
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

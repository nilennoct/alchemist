import { ProxyServer } from './proxy/ProxyServer';

const port = parseInt(process.env.PORT, 10) || 9000;

new ProxyServer().listen(port, () => {
    console.log(`Proxy server listens on ${port}`);
});

import { GatewayServer } from './server';

if (require.main === module) {
  const server = new GatewayServer();
  server.start();

  // 
}

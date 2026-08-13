import { buildApp } from './app';
import { loadConfig } from './config/env';

const start = async (): Promise<void> => {
  const config = loadConfig();
  const app = await buildApp(config);

  const close = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down server');
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void close('SIGINT'));
  process.once('SIGTERM', () => void close('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error, 'Failed to start server');
    await app.close();
    process.exit(1);
  }
};

void start();

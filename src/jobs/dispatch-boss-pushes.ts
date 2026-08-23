import { loadConfig } from '../config/env';
import { openDatabase } from '../infrastructure/db/client';
import {
  FcmHttpV1Client,
  loadFirebaseServiceAccount,
} from '../infrastructure/push/fcm-http-v1.client';
import { PushNotificationsRepository } from '../modules/push-notifications/push-notifications.repository';
import { BossPushDispatchService } from '../modules/push-notifications/push-notifications.service';

const run = async (): Promise<void> => {
  const config = loadConfig();
  const database = openDatabase(config);
  try {
    const sender = new FcmHttpV1Client(loadFirebaseServiceAccount(config));
    const service = new BossPushDispatchService(
      new PushNotificationsRepository(database.db),
      sender,
      config.fcmDispatchWindowSeconds * 1000,
    );
    const result = await service.run();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    database.db.close();
  }
};

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown push dispatch error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

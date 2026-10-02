import { decryptFile, parseKey } from '../lib/backupCrypto';

/**
 * Decrypts an encrypted backup for restore:
 *   BACKUP_ENCRYPTION_KEY=... node dist/backup-decrypt.js dawa-20260101-020000.dump.enc restored.dump
 *   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" restored.dump
 * Needs only the key, not the rest of the application's configuration.
 */
const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: BACKUP_ENCRYPTION_KEY=<base64 key> node dist/backup-decrypt.js <backup.dump.enc> <output.dump>');
  process.exit(2);
}
if (!process.env.BACKUP_ENCRYPTION_KEY) {
  console.error('Set BACKUP_ENCRYPTION_KEY to the key the backup was made with.');
  process.exit(2);
}
decryptFile(input, output, parseKey(process.env.BACKUP_ENCRYPTION_KEY))
  .then(() => console.log(`Decrypted to ${output}. Restore it with pg_restore, then delete the plain file.`))
  .catch((err) => {
    console.error(`Could not decrypt: ${err.message.includes('authenticate') ? 'wrong key, or the file was changed or is incomplete' : err.message}`);
    process.exit(1);
  });

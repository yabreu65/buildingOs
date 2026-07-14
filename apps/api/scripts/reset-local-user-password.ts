import { main } from '../src/local-seed/reset-local-user-password';

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Local password reset failed: ${message}`);
  process.exit(1);
});

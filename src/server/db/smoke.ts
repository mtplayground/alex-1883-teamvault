import { closePool, smokeTestDatabase } from './pool.js';

try {
  const result = await smokeTestDatabase();

  console.log('PostgreSQL smoke test passed', result);
} catch (error) {
  console.error('PostgreSQL smoke test failed', {
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
} finally {
  await closePool();
}

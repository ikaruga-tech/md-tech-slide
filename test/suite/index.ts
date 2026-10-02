import { runExtensionSmokeTests } from './extension.test.js';

export async function run(): Promise<void> {
  try {
    await runExtensionSmokeTests();
    console.log('All Extension Host smoke tests passed successfully!');
  } catch (err) {
    console.error('Extension Host smoke test failed:', err);
    throw err;
  }
}

import type { BrainEngine } from '../core/engine.ts';

export async function runConfig(engine: BrainEngine, args: string[]) {
  const action = args[0];
  const key = args[1];
  const value = args[2];

  if (action === 'get' && key) {
    const val = await engine.getConfig(key);
    if (val !== null) {
      console.log(val);
    } else {
      console.error(`Config key not found: ${key}`);
      process.exit(1);
    }
  } else if (action === 'set' && key && value) {
    await engine.setConfig(key, value);
    console.log(`Set ${key} = ${value}`);
  } else {
    console.error('Usage: gbrain config [get|set] <key> [value]');
    process.exit(1);
  }
}

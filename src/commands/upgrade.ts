import { execSync } from 'child_process';

export async function runUpgrade(_args: string[]) {
  // Detect installation method
  const method = detectInstallMethod();

  console.log(`Detected install method: ${method}`);

  switch (method) {
    case 'npm':
      console.log('Upgrading via npm...');
      try {
        execSync('bun update gbrain', { stdio: 'inherit' });
        console.log('Upgrade complete.');
      } catch {
        console.error('npm upgrade failed. Try: bun update gbrain');
      }
      break;

    case 'binary':
      console.log('Binary self-update not yet implemented.');
      console.log('Download the latest binary from GitHub Releases:');
      console.log('  https://github.com/garrytan/gbrain/releases');
      break;

    case 'clawhub':
      console.log('Upgrading via ClawHub...');
      try {
        execSync('clawhub update gbrain', { stdio: 'inherit' });
        console.log('Upgrade complete.');
      } catch {
        console.error('ClawHub upgrade failed. Try: clawhub update gbrain');
      }
      break;

    default:
      console.error('Could not detect installation method.');
      console.log('Try one of:');
      console.log('  bun update gbrain');
      console.log('  clawhub update gbrain');
      console.log('  Download from https://github.com/garrytan/gbrain/releases');
  }
}

function detectInstallMethod(): 'npm' | 'binary' | 'clawhub' | 'unknown' {
  const execPath = process.execPath || '';

  // Check if running from node_modules (npm install)
  if (execPath.includes('node_modules') || process.argv[1]?.includes('node_modules')) {
    return 'npm';
  }

  // Check if clawhub is available
  try {
    execSync('which clawhub', { stdio: 'pipe' });
    return 'clawhub';
  } catch {
    // not available
  }

  // Check if running as compiled binary
  if (execPath.endsWith('/gbrain') || execPath.endsWith('\\gbrain.exe')) {
    return 'binary';
  }

  return 'unknown';
}

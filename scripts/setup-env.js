const fs = require('fs');
const path = require('path');

// Basic env parser (very simple, handles KEY=VALUE)
function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      env[match[1]] = value.trim();
    }
  });
  return env;
}

const envFile = path.join(__dirname, '../.env');
const targetFile = path.join(__dirname, '../src/environments/environment.ts');

if (!fs.existsSync(envFile)) {
  console.error('Error: .env file not found. Please create one using .env.example as a template.');
  process.exit(1);
}

const env = parseEnv(envFile);

const pkgPath = path.join(__dirname, '../package.json');
let appVersion = '1.0.0';
if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version) appVersion = pkg.version;
  } catch (e) {
    console.warn('Could not read version from package.json:', e);
  }
}

const config = {
  production: false,
  appVersion: appVersion,
  firebase: {
    apiKey: env.FIREBASE_API_KEY || 'local-key',
    authDomain: env.FIREBASE_AUTH_DOMAIN || 'local-domain',
    projectId: env.FIREBASE_PROJECT_ID || 'local-project',
    storageBucket: env.FIREBASE_STORAGE_BUCKET || 'local-bucket',
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || 'local-id',
    appId: env.FIREBASE_APP_ID || 'local-app',
    measurementId: env.FIREBASE_MEASUREMENT_ID || 'local-measure'
  },
};

const content = `export const environment = ${JSON.stringify(config, null, 2)};
`;

fs.writeFileSync(targetFile, content);
console.log(`Successfully updated src/environments/environment.ts from .env (version: ${appVersion})`);

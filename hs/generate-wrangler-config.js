const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env');
const templatePath = path.resolve(__dirname, 'wrangler.template.jsonc');
const outputPath = path.resolve(__dirname, 'wrangler.jsonc');

if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found.');
  process.exit(1);
}

if (!fs.existsSync(templatePath)) {
  console.error('❌ wrangler.template.jsonc not found.');
  process.exit(1);
}

// Load env variables into an object
const envVars = {};
const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const [key, ...rest] = trimmed.split('=');
  envVars[key] = rest.join('=').trim();
}

// Read the template file
let template = fs.readFileSync(templatePath, 'utf-8');

// Replace ${VAR} in template with actual values
for (const [key, value] of Object.entries(envVars)) {
  const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');
  template = template.replace(pattern, value);
}

// Write the filled-in config to wrangler.jsonc
fs.writeFileSync(outputPath, template, 'utf-8');
console.log('✅ Generated wrangler.jsonc from template.');

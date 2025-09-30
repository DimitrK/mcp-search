#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = packageJson.version;
const branchName = `v${version.replace(/\./g, '_')}`;

console.log(`🚀 Pushing release branch ${branchName} with tag v${version}...`);

try {
  execSync(`git push origin ${branchName} --tags`, { stdio: 'inherit' });
  console.log('✅ Release pushed to GitHub successfully!');
  console.log('💡 Next: Create a Pull Request in GitHub UI');
  console.log(`   ${branchName} → main`);
} catch (error) {
  console.error('❌ Failed to push release:', error.message);
  process.exit(1);
}

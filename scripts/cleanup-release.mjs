#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = packageJson.version;
const branchName = `v${version.replace(/\./g, '_')}`;

console.log(`🧹 Cleaning up release branch ${branchName}...`);

try {
  // Check if branch exists
  try {
    execSync(`git show-branch ${branchName}`, { stdio: 'pipe' });
    console.log(`✅ Found branch ${branchName}`);

    // Delete the branch
    execSync(`git branch -d ${branchName}`, { stdio: 'inherit' });
    console.log(`✅ Deleted local branch ${branchName}`);

    // Also delete remote branch if it exists
    try {
      execSync(`git push origin --delete ${branchName}`, { stdio: 'inherit' });
      console.log(`✅ Deleted remote branch ${branchName}`);
    } catch (remoteError) {
      console.log(`ℹ️  Remote branch ${branchName} already deleted or doesn't exist`);
    }
  } catch (branchError) {
    console.log(`ℹ️  Branch ${branchName} doesn't exist locally`);
  }

  console.log('🎉 Release cleanup complete!');
} catch (error) {
  console.error('❌ Failed to cleanup release:', error.message);

  if (error.message.includes('not fully merged')) {
    console.log('💡 Branch has unmerged changes. Use:');
    console.log(`   git branch -D ${branchName}  # Force delete`);
  }

  process.exit(1);
}

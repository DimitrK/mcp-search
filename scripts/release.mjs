#!/usr/bin/env node

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = packageJson.version;
const branchName = `v${version.replace(/\./g, '_')}`;

console.log(`🚀 Starting release process for version ${version}`);
console.log(`📦 Branch: ${branchName}`);

try {
  // Check if we're already on the release branch
  const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

  if (currentBranch !== branchName) {
    console.log(`🔄 Switching to branch ${branchName}...`);
    try {
      execSync(`git checkout ${branchName}`, { stdio: 'inherit' });
      console.log(`✅ Switched to branch ${branchName}`);
    } catch (error) {
      console.log(`🔄 Creating new branch ${branchName}...`);
      execSync(`git checkout -b ${branchName}`, { stdio: 'inherit' });
      console.log(`✅ Created and switched to branch ${branchName}`);
    }
  } else {
    console.log(`✅ Already on branch ${branchName}`);
  }

  // Add and commit package.json
  console.log('💾 Committing version changes...');
  execSync('git add package.json', { stdio: 'inherit' });
  execSync('git add package-lock.json', { stdio: 'inherit' });
  execSync(`git commit -m "chore: bump version to v${version}"`, { stdio: 'inherit' });
  console.log(`✅ Committed version bump to v${version}`);

  // Create tag
  console.log('🏷️  Creating version tag...');
  execSync(`git tag v${version}`, { stdio: 'inherit' });
  console.log(`✅ Created tag v${version}`);

  console.log('🎉 Release preparation complete!');
  console.log('💡 Next steps:');
  console.log(`   1. Review changes: git log --oneline -5`);
  console.log(`   2. Push branch: npm run release:push`);
  console.log(`   3. Create PR: ${branchName} → main`);
  console.log(`   4. After merge: git checkout main && git merge ${branchName}`);
} catch (error) {
  console.error('❌ Release preparation failed:', error.message);
  process.exit(1);
}

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Get package version from package.json
 * Works in both development and production builds
 */
function getPackageVersion(): string {
  try {
    // Try to find package.json relative to this file
    const currentDir = process.cwd();
    const packagePath = join(currentDir, 'package.json');

    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));

    if (!packageJson.version) {
      throw new Error('Version not found in package.json');
    }

    return packageJson.version;
  } catch (error) {
    // Fallback for edge cases
    console.warn(
      'Could not read version from package.json, using fallback:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return '0.1.0';
  }
}

// Export as constant so it's only read once
export const PACKAGE_VERSION = getPackageVersion();

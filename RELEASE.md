# Release Management Guide

This guide explains how to create releases with automatic version bumping and tagging.

## 🚀 Quick Release Workflow

### Patch Release (Bug fixes)

```bash
# Test everything first
npm test && npm run lint && npm run build

# Bump version and create tag
npm run release:patch

# Push to trigger CI/CD
npm run release:push
```

### Minor Release (New features)

```bash
# Test everything first
npm test && npm run lint && npm run build

# Bump version and create tag
npm run release:minor

# Push to trigger CI/CD
npm run release:push
```

### Major Release (Breaking changes)

```bash
# Test everything first
npm test && npm run lint && npm run build

# Bump version and create tag
npm run release:major

# Push to trigger CI/CD
npm run release:push
```

## 🔧 What Happens Automatically

### Local (npm run release:\*)

1. **Version Bump**: Updates `package.json` version
2. **Git Commit**: Creates commit with version message
3. **Git Tag**: Creates tag like `v1.2.3`

### CI/CD Pipeline (npm run release:push)

1. **Security Scan**: CodeQL + npm audit
2. **Multi-Platform Tests**: Node 20.x + 22.x on Ubuntu, Windows, macOS
3. **Docker Build**: Multi-platform container images
4. **NPM Publish**: Package published to npm registry
5. **Docker Push**: Images pushed to Docker Hub
6. **GitHub Release**: Auto-generated with changelog

## 📋 Version Strategy

- **Patch (0.1.0 → 0.1.1)**: Bug fixes, security updates, documentation
- **Minor (0.1.0 → 0.2.0)**: New features, performance improvements
- **Major (0.1.0 → 1.0.0)**: Breaking changes, API changes

## 🛡️ Quality Gates

All releases automatically trigger:

- ✅ **223 Unit Tests** across all components
- ✅ **Integration Tests** with real APIs
- ✅ **Performance Tests** (P50 < 300ms)
- ✅ **Security Scanning** (CodeQL + npm audit)
- ✅ **Multi-Platform** compatibility testing
- ✅ **Docker Image** security scanning

## 📦 Release Artifacts

Each release creates:

- 📦 **NPM Package**: `npm install @dimitrk/mcp-search@latest`
- 🐳 **Docker Image**: `docker pull dimitrisk/mcp-search:latest`
- 📝 **GitHub Release**: With auto-generated changelog
- 📊 **Coverage Report**: Test coverage metrics

## 🔄 Rollback Process

If something goes wrong:

```bash
# Rollback local changes
git reset --hard HEAD~1
git tag -d v1.2.3

# Rollback remote (if already pushed)
git push origin :refs/tags/v1.2.3
git push origin +HEAD~1:main

# Manual NPM unpublish (if needed, within 24h)
npm unpublish mcp-search@1.2.3
```

## 🧪 Pre-Release Testing

Before any release:

```bash
# Full test suite
npm test

# Performance validation
npm run test:performance

# Health check
npm run health

# Integration test with real environment
npm run test:integration

# Build verification
npm run build

# CLI testing
node dist/cli.js health
```

## 📈 Release Checklist

- [ ] All tests passing (`npm test`)
- [ ] No linting errors (`npm run lint`)
- [ ] Build successful (`npm run build`)
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (optional - auto-generated)
- [ ] Version type chosen (patch/minor/major)
- [ ] CI/CD pipeline ready

## 🔍 Monitoring Releases

After release:

- Check **GitHub Actions** for build status
- Verify **NPM package** availability
- Test **Docker image** pull
- Monitor **error rates** in production
- Check **test coverage** reports

---

**🎯 The goal is zero-friction, automated releases with maximum quality assurance!**

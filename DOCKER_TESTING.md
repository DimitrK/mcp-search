# 🐳 Docker Testing Guide

This guide helps you test the MCP Search Docker setup comprehensively.

## 📋 Prerequisites

1. **Docker Desktop** running (check with `docker info`)
2. **Environment variables** (for real testing)
3. **Terminal** with bash support

## 🚀 Testing Options

### Option 1: Automated Test Script (Recommended)

```bash
# Start Docker Desktop first, then:
./test-docker.sh
```

This script will:

- ✅ Check Docker status
- 🏗️ Build the image
- 🔍 Test health checks
- 📊 Show image size and optimization
- 🎯 Verify CLI functionality

### Option 2: Manual Step-by-Step Testing

#### Step 1: Build the Image

```bash
docker build -t mcp-search:test .
```

#### Step 2: Test Health Check

```bash
docker run --rm \
  -e GOOGLE_API_KEY=test \
  -e GOOGLE_SEARCH_ENGINE_ID=test \
  -e EMBEDDING_SERVER_URL=http://test \
  -e EMBEDDING_SERVER_API_KEY=test \
  -e EMBEDDING_MODEL_NAME=test \
  mcp-search:test node dist/cli.js health
```

#### Step 3: Test CLI Commands

```bash
# Version
docker run --rm mcp-search:test node dist/cli.js version

# Help
docker run --rm mcp-search:test node dist/cli.js help

# Database inspection (will show empty DB)
docker run --rm mcp-search:test node dist/cli.js inspect
```

#### Step 4: Test Interactive Mode

```bash
docker run -it --rm mcp-search:test /bin/sh
# Inside container:
node dist/cli.js health
exit
```

### Option 3: Docker Compose Testing

#### Test with Real Environment (requires API keys)

```bash
# Copy your real .env file, then:
docker-compose up --build

# Test MCP connectivity
# (This would require MCP inspector setup)
```

## 🔍 Testing Checklist

- [ ] **Docker builds successfully** (no errors)
- [ ] **Health check passes** (returns "System ready")
- [ ] **CLI commands work** (version, help, inspect)
- [ ] **Container starts cleanly** (no crash loops)
- [ ] **Image size reasonable** (< 500MB ideally)
- [ ] **Health check endpoint** responds
- [ ] **Data persistence** (volumes mount correctly)
- [ ] **Resource limits** respected
- [ ] **Non-root user** security
- [ ] **Signal handling** (graceful shutdown)

## 🐛 Common Issues & Solutions

### Issue: "Docker daemon not running"

**Solution**: Start Docker Desktop and wait for it to fully initialize.

### Issue: Build fails with "EACCES" or permission errors

**Solution**: Check Dockerfile permissions and non-root user setup.

### Issue: Health check fails

**Solution**: Verify all required environment variables are set, even if mock values.

### Issue: Container exits immediately

**Solution**: Check logs with `docker logs <container-id>` and verify entry point.

### Issue: "Module not found" errors

**Solution**: Ensure build stage copies all necessary files and runs `npm run build`.

## 📊 Performance Expectations

- **Build time**: 2-5 minutes (first time), < 1 minute (cached)
- **Image size**: 200-400MB (optimized multi-stage)
- **Startup time**: < 10 seconds
- **Memory usage**: 256-512MB (depending on workload)
- **Health check**: < 2 seconds response

## 🚀 Production Deployment Testing

```bash
# Test production configuration
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up --build

# Monitor resource usage
docker stats mcp-search

# Check logs for issues
docker logs -f mcp-search

# Test under load (if applicable)
# ... your load testing commands
```

## 🔧 Advanced Testing

### Test Multi-Platform Build

```bash
# Test ARM64 compatibility (for Apple Silicon/ARM servers)
docker buildx build --platform linux/amd64,linux/arm64 -t mcp-search:multi .
```

### Test Security

```bash
# Verify non-root user
docker run --rm mcp-search:test whoami
# Should output: mcp-search

# Check for vulnerabilities
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image mcp-search:test
```

### Test Networking

```bash
# Test port exposure and health endpoint
docker run -d -p 3000:3000 --name mcp-test mcp-search:test
sleep 10
docker exec mcp-test node dist/cli.js health
docker rm -f mcp-test
```

## 📝 Test Results Template

```
🐳 Docker Test Results - $(date)
================================
✅ Build Status: [PASS/FAIL]
✅ Health Check: [PASS/FAIL]
✅ CLI Commands: [PASS/FAIL]
✅ Resource Usage: [ACCEPTABLE/HIGH]
✅ Security Check: [PASS/FAIL]
✅ Image Size: [SIZE] MB

Notes:
-
-
```

---

**🎯 After all tests pass, your Docker setup is production-ready!**

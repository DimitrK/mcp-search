#!/bin/bash
set -e

echo "🐳 Testing MCP Search Docker Setup"
echo "=================================="

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
echo -e "${YELLOW}📋 Step 1: Checking Docker status...${NC}"
if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker Desktop first.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker is running${NC}"

# Build the Docker image (minimal dependencies)
echo -e "${YELLOW}📋 Step 2: Building Docker image (minimal setup)...${NC}"
docker build -t mcp-search:test .
echo -e "${GREEN}✅ Docker image built successfully${NC}"

# Test basic health check
echo -e "${YELLOW}📋 Step 3: Testing health check...${NC}"
docker run --rm \
    -e NODE_ENV=production \
    -e GOOGLE_API_KEY=test \
    -e GOOGLE_SEARCH_ENGINE_ID=test \
    -e EMBEDDING_SERVER_URL=http://test \
    -e EMBEDDING_SERVER_API_KEY=test \
    -e EMBEDDING_MODEL_NAME=test \
    mcp-search:test node dist/cli.js health

echo -e "${GREEN}✅ Health check passed${NC}"

# Test version command
echo -e "${YELLOW}📋 Step 4: Testing version command...${NC}"
DOCKER_VERSION=$(docker run --rm mcp-search:test node dist/cli.js version)
echo "Docker version output: $DOCKER_VERSION"
echo -e "${GREEN}✅ Version command works${NC}"

# Test CLI help
echo -e "${YELLOW}📋 Step 5: Testing CLI help...${NC}"
docker run --rm mcp-search:test node dist/cli.js help | head -10
echo -e "${GREEN}✅ CLI help works${NC}"

# Test image size
echo -e "${YELLOW}📋 Step 6: Checking image size...${NC}"
IMAGE_SIZE=$(docker images mcp-search:test --format "{{.Size}}")
echo "Docker image size: $IMAGE_SIZE"

# List layers for optimization insights
echo -e "${YELLOW}📋 Step 7: Image layers analysis...${NC}"
docker history mcp-search:test --format "table {{.CreatedBy}}{{.Size}}" | head -10

# Test docker-compose configuration
echo -e "${YELLOW}📋 Step 8: Testing docker-compose configuration...${NC}"
if docker-compose config >/dev/null 2>&1; then
    echo -e "${GREEN}✅ docker-compose.yml is valid${NC}"
else
    echo -e "${YELLOW}⚠️  docker-compose.yml validation failed (might need .env file)${NC}"
fi

echo -e "${GREEN}🎉 All Docker tests passed!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Copy .env file for real testing: cp .env.example .env"
echo "2. Test with real environment: docker-compose up --build"
echo "3. Test MCP connectivity: npx @modelcontextprotocol/inspector"
echo "4. Test CLI in container: docker exec mcp-search node dist/cli.js inspect"

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const LMSTUDIO_URL = 'http://127.0.0.1:2020/v1';
const MCP_SERVER_COMMAND = 'npm';
const MCP_SERVER_ARGS = ['run', 'dev'];

// --- Main Agent Logic ---
async function main() {
  console.log('🚀 Starting agent...');

  // 1. Initialize OpenAI client for LM Studio
  const openai = new OpenAI({
    baseURL: LMSTUDIO_URL,
    apiKey: 'not-needed-for-lm-studio',
  });
  console.log('✅ Connected to LM Studio model.');

  // 2. Initialize the MCP transport, which will spawn the server
  const mcpTransport = new StdioClientTransport({
    command: MCP_SERVER_COMMAND,
    args: MCP_SERVER_ARGS,
    env: {
      ...process.env,
    },
  });

  const mcpClient = new Client({
    name: 'mcp-search-agent',
    version: '1.0.0',
  });

  // Log MCP server errors for debugging
  // mcpProcess.stderr.on('data', data => {
  //   console.error(`MCP Server stderr: ${data}`);
  // });

  // Connect to the MCP server and wait for handshake
  await mcpClient.connect(mcpTransport);
  console.log('✅ Connected to MCP server.');

  // 3. Get the list of available tools from the MCP server
  const { tools } = await mcpClient.listTools();
  const openAITools = tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
  console.log(
    '✅ Fetched and formatted tools for OpenAI:',
    openAITools.map(t => t.function.name)
  );

  const messages = [
    {
      role: 'user',
      content:
        "Search the web for 'what is the model context protocol?' and echo back the primary goal.",
    },
  ];

  // 4. Send the initial prompt and tool definitions to the LLM
  console.log('\n💬 Sending prompt to LLM...');
  let response = await openai.chat.completions.create({
    model: 'local-model', // Model name doesn't matter for LM Studio
    messages: messages,
    tools: openAITools,
    tool_choice: 'auto',
  });

  let responseMessage = response.choices[0].message;

  // 5. Loop to handle tool calls until the LLM provides a final response
  while (responseMessage.tool_calls) {
    console.log('🛠️ LLM requested a tool call...');
    messages.push(responseMessage); // Add LLM's response to message history

    for (const toolCall of responseMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);

      console.log(`📞 Calling tool: ${toolName} with args:`, toolArgs);

      // 6. Execute the tool call on the MCP server
      const { content } = await mcpClient.callTool(toolName, toolArgs);
      const toolResultText = content[0].text; // Assuming text output

      console.log('📄 Got tool result.');

      // 7. Add the tool's result to the message history
      messages.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        name: toolName,
        content: toolResultText,
      });
    }

    // 8. Send the updated message history (including tool results) back to the LLM
    console.log('💬 Sending tool results back to LLM for final answer...');
    response = await openai.chat.completions.create({
      model: 'local-model',
      messages: messages,
    });
    responseMessage = response.choices[0].message;
  }

  // 9. Print the final response from the LLM
  console.log('\n🎉 Final Response:\n', responseMessage.content);

  // 10. Clean up
  await mcpClient.close();
  console.log('\n👋 Agent finished.');
}

main().catch(console.error);
